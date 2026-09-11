import {
  test,
  expect,
  chromium,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import type { Annotation } from '../../src/types';

let context: BrowserContext;
let profile: string;
const extensionPath = resolve('dist');
async function launch() {
  return chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
    args: [
      '--enable-unsafe-extension-debugging',
      '--disable-extensions-except=' + extensionPath,
      '--load-extension=' + extensionPath,
    ],
  });
}
async function activate(page: Page) {
  const sw =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent('serviceworker'));
  await expect
    .poll(() => sw.evaluate(() => chrome.action.onClicked.hasListeners()))
    .toBe(true);
  await page.bringToFront();
  const id = sw.url().split('/')[2];
  const browserCdp = await context.browser()!.newBrowserCDPSession();
  const { targetInfos } = await browserCdp.send('Target.getTargets', {
    filter: [{ type: 'tab', exclude: false }, { exclude: true }],
  });
  const targetInfo = targetInfos.find((t) => t.url === page.url())!;
  await browserCdp.send('Extensions.triggerAction', {
    id,
    targetId: targetInfo.targetId,
  });
  await browserCdp.detach();

  await expect(
    page.getByRole('complementary', { name: 'Pointnote review' }),
  ).toBeVisible();
}
async function select(page: Page, selector: string) {
  await page
    .locator(selector)
    .evaluate((el) =>
      el.scrollIntoView({ block: 'center', behavior: 'instant' }),
    );
  const r = await page.locator(selector).boundingBox();
  expect(r).toBeTruthy();
  await page.mouse.click(r!.x + 8, r!.y + 8);
  await expect(page.locator('[data-pointnote-root] .target')).toBeVisible();
}
async function save(page: Page, comment: string, count: number) {
  await page.getByRole('textbox', { name: 'Your feedback' }).fill(comment);
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(page.locator('.card')).toHaveCount(count);
  await expect(page.getByRole('status')).toContainText(
    'Saved locally, with a screenshot.',
  );
}
async function simulateSpeech(page: Page) {
  const cdp = await context.newCDPSession(page);
  const worlds: { id: number; origin: string }[] = [];
  cdp.on('Runtime.executionContextCreated', ({ context: world }) =>
    worlds.push(world),
  );
  await cdp.send('Runtime.enable');
  const world = worlds.find((w) => w.origin.startsWith('chrome-extension://'))!;
  const evaluate = (expression: string) =>
    cdp.send('Runtime.evaluate', { contextId: world.id, expression });
  await evaluate(`
    globalThis.speechStarts = 0;
    globalThis.speechDenied = false;
    globalThis.speechPending = false;
    globalThis.SpeechRecognition = class {
      static available() {
        return globalThis.speechPending
          ? new Promise(resolve => { globalThis.resolveSpeech = resolve; })
          : Promise.resolve('available');
      }
      processLocally = true;
      start() {
        globalThis.speechStarts++;
        if (globalThis.speechDenied) this.onerror?.({ error: 'not-allowed' });
        else this.onresult?.({ results: [{ isFinal: true, 0: { transcript: 'Add supporting evidence.' } }] });
      }
      stop() { this.onend?.(); }
      abort() { this.onend?.(); }
    };
  `);
  return { evaluate, close: () => cdp.detach() };
}
test.beforeEach(async () => {
  profile = await mkdtemp(join(tmpdir(), 'pointnote-test-'));
  context = await launch();
});
test.afterEach(async ({}, info) => {
  if (context) {
    if (info.status !== info.expectedStatus)
      for (const page of context.pages())
        await page
          .screenshot({ path: info.outputPath('failure.png'), fullPage: false })
          .catch(() => {});
    await context.close();
  }
});
test('three report comments persist across reload and browser restart, export, and reject changed targets', async ({}, info) => {
  let page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/report.html');
  await activate(page);
  await select(page, '#evidence-claim');
  await save(
    page,
    'This argument needs more evidence. Cite the study behind the 38% claim.',
    1,
  );
  await select(page, '#retention-chart');
  await save(
    page,
    'Show the sample size beside the chart so I can judge the comparison.',
    2,
  );
  await select(page, '#recommendation-cards article:first-child');
  await page.getByRole('button', { name: '↑ Parent' }).click();
  await save(
    page,
    'This feels cluttered. Simplify these three recommendation cards.',
    3,
  );
  await page.reload();
  await expect(page.locator('.card')).toHaveCount(3);
  await page.getByRole('button', { name: 'Open note 1', exact: true }).click();
  await expect(page.locator('.target-name')).toContainText('evidence-claim');
  await page.screenshot({ path: info.outputPath('review.png') });
  await context.close();
  context = await launch();
  page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/report.html');
  await activate(page);
  await expect(page.locator('.card')).toHaveCount(3);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export feedback' }).click();
  const saved = await download;
  const exportPath = info.outputPath('feedback.zip');
  await saved.saveAs(exportPath);
  const files = unzipSync(new Uint8Array(await readFile(exportPath)));
  const data = JSON.parse(strFromU8(files['feedback.json'])) as {
    annotations: Annotation[];
    schemaVersion: string;
  };
  expect(data.schemaVersion).toBe('1.0.0');
  expect(data.annotations).toHaveLength(3);
  expect(data.annotations.map((a) => a.targets[0].locator.id)).toEqual([
    'evidence-claim',
    'retention-chart',
    'recommendation-cards',
  ]);
  for (const a of data.annotations) {
    expect(a.screenshot.status).toBe('available');
    if (a.screenshot.status === 'available') {
      expect(files[a.screenshot.path].length).toBeGreaterThan(10000);
      expect(a.screenshot.width).toBeGreaterThan(1000);
      await info.attach(a.id, {
        body: Buffer.from(files[a.screenshot.path]),
        contentType: 'image/png',
      });
    }
  }
  expect(strFromU8(files['feedback.md'])).toContain('This feels cluttered.');
  await page.locator('#evidence-claim').evaluate((el) => {
    el.textContent = 'An unrelated replacement claim.';
  });
  await page.locator('#retention-chart').evaluate((el) => el.remove());
  await expect(page.locator('.status.missing')).toHaveCount(2);
  await page
    .locator('.card')
    .first()
    .getByRole('button', { name: 'Reattach', exact: true })
    .click();
  await select(page, '#evidence-claim');
  await page.getByRole('button', { name: 'Attach here' }).click();
  await expect(page.locator('.status.missing')).toHaveCount(1);
  await expect(page.locator('.card').first().locator('.comment')).toHaveText(
    'This argument needs more evidence. Cite the study behind the 38% claim.',
  );
});
test('localhost controls are blocked during review, normal when paused, with sanitized screenshots and route isolation', async () => {
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/frontend.html');
  await activate(page);
  await select(page, '#complete-task');
  await expect(page.locator('#project-status')).toHaveText('No actions yet');
  await page.locator('#complete-task').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#project-status')).toHaveText('No actions yet');
  await save(page, 'Make this button more prominent.', 1);
  await page.getByRole('button', { name: 'Pause selection' }).click();
  await page.locator('#complete-task').click();
  await expect(page.locator('#project-status')).toHaveText('1 task completed');
  await page.getByRole('button', { name: 'Resume selection' }).click();
  await select(page, 'textarea[aria-label="Private draft"]');
  await save(page, 'Give the note field more breathing room.', 2);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export feedback' }).click();
  const files = unzipSync(
    new Uint8Array(await readFile((await (await download).path())!)),
  );
  expect(strFromU8(files['feedback.json'])).not.toContain('PRIVATE-DRAFT-789');
  const data = JSON.parse(strFromU8(files['feedback.json']));
  expect(data.annotations[1].screenshot.redactedRegions).toBeGreaterThan(0);
  const privateNote = data.annotations[1];
  const r = privateNote.targets[0].bounds;
  const pixel = await page.evaluate(
    async ({ imageUrl, x, y }) => {
      const img = new Image();
      img.src = imageUrl;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      return [...ctx.getImageData(x, y, 1, 1).data];
    },
    {
      imageUrl:
        'data:image/png;base64,' +
        Buffer.from(files[privateNote.screenshot.path]).toString('base64'),
      x: Math.round(
        ((r.x + r.width / 2) * privateNote.screenshot.width) /
          privateNote.page.viewport.width,
      ),
      y: Math.round(
        ((r.y + r.height / 2) * privateNote.screenshot.height) /
          privateNote.page.viewport.height,
      ),
    },
  );
  expect(pixel).toEqual([220, 225, 223, 255]);
  await page.getByRole('button', { name: 'Pause selection' }).click();
  await page.locator('#route-change').click();
  await expect(page.locator('.card')).toHaveCount(0);
  await page.goBack();
  await expect(page.locator('.card')).toHaveCount(2);
  await page.getByRole('button', { name: 'Close Pointnote' }).click();
  await page.locator('#complete-task').click();
  await expect(page.locator('#project-status')).toHaveText('2 task completed');
});

test('multiple selection, precise text ranges, and editable voice transcripts', async () => {
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/report.html');
  await activate(page);
  await page.getByRole('button', { name: 'Multiple', exact: true }).click();
  await select(page, '#evidence-claim');
  await select(page, '#summary > p:nth-of-type(2)');
  await save(page, 'Connect these two paragraphs more clearly.', 1);
  await page.getByRole('button', { name: 'Text range', exact: true }).click();
  await page
    .locator('#evidence-claim')
    .evaluate((el) =>
      el.scrollIntoView({ block: 'center', behavior: 'instant' }),
    );
  const rect = await page.locator('#evidence-claim').evaluate((el) => {
    const range = document.createRange();
    const text = el.firstChild!.textContent!;
    range.setStart(el.firstChild!, text.indexOf('Teams'));
    range.setEnd(
      el.firstChild!,
      text.indexOf('workspace') + 'workspace'.length,
    );
    const r = range.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  await page.mouse.move(rect.x + 1, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width - 1, rect.y + rect.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(page.locator('.target')).toBeVisible();
  await expect(page.locator('.excerpt')).toContainText('focused workspace');
  await save(page, 'Define what you mean by a focused workspace.', 2);
  await page.getByRole('button', { name: 'Element', exact: true }).click();
  await select(page, '#evidence-claim');
  // Inject a deterministic recognizer into the extension's isolated world.
  // This tests the real voice UI and storage without claiming microphone/service coverage.
  const cdp = await context.newCDPSession(page);
  const worlds: { id: number; name: string; origin: string }[] = [];
  cdp.on('Runtime.executionContextCreated', ({ context: world }) =>
    worlds.push(world),
  );
  await cdp.send('Runtime.enable');
  const world = worlds.find((w) => w.origin.startsWith('chrome-extension://'));
  expect(world, JSON.stringify(worlds)).toBeTruthy();
  await cdp.send('Runtime.evaluate', {
    contextId: world!.id,
    expression: `globalThis.SpeechRecognition = class {
    static async available() { return 'available'; }
    processLocally = true;
    start() { this.onresult({ results: [{ isFinal: true, 0: { transcript: 'this needs more proof' } }] }); }
    stop() { this.onend?.(); } abort() { this.onend?.(); }
  }`,
  });
  const talk = page.getByRole('button', { name: 'Hold to talk', exact: true });
  await talk.focus();
  await page.keyboard.down('Space');
  await expect(
    page.getByRole('textbox', { name: 'Your feedback' }),
  ).toHaveValue('this needs more proof');
  await page.keyboard.up('Space');
  await save(page, 'This needs more proof. Add a citation.', 3);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export feedback' }).click();
  const files = unzipSync(
    new Uint8Array(await readFile((await (await download).path())!)),
  );
  const data = JSON.parse(strFromU8(files['feedback.json']));
  expect(data.annotations[0].selectionKind).toBe('multiple');
  expect(data.annotations[0].targets).toHaveLength(2);
  expect(data.annotations[1].selectionKind).toBe('text-range');
  expect(data.annotations[1].targets[0].range.exact).toContain(
    'focused workspace',
  );
  expect(data.annotations[2].originalComment).toBe(
    'This needs more proof. Add a citation.',
  );
  expect(data.annotations[2].input.transcript).toBe('this needs more proof');
  await cdp.detach();
});
test('ambiguous targets remain explicit and screenshot opt-out is exported', async () => {
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/report.html');
  await activate(page);
  await select(page, '#evidence-claim');
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.locator('.include-screenshot').uncheck();
  await page.getByRole('button', { name: 'Back to notes' }).click();
  await page
    .getByRole('textbox', { name: 'Your feedback' })
    .fill('Keep this exact note.');
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(page.getByRole('status')).toContainText(
    'Screenshot capture disabled by the user.',
  );
  await page
    .locator('.card')
    .getByRole('button', { name: 'Mark addressed' })
    .click();
  await expect(page.locator('.card .status')).toHaveText('addressed');
  await page.locator('#evidence-claim').evaluate((el) => {
    el.removeAttribute('id');
    el.after(el.cloneNode(true));
  });
  await expect(page.locator('.status.missing')).toHaveCount(1);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export feedback' }).click();
  const files = unzipSync(
    new Uint8Array(await readFile((await (await download).path())!)),
  );
  const data = JSON.parse(strFromU8(files['feedback.json']));
  expect(data.annotations[0].attachment.state).toBe('ambiguous');
  expect(data.annotations[0].resolution).toBe('addressed');
  expect(data.annotations[0].screenshot.status).toBe('unavailable');
  expect(data.annotations[0].originalComment).toBe('Keep this exact note.');
});

test('panel can move, resize, minimize and restore with layout and settings persisted', async ({}, info) => {
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/frontend.html');
  await activate(page);
  const panel = page.getByRole('complementary', { name: 'Pointnote review' });
  const original = (await panel.boundingBox())!;
  await select(page, '#complete-task');
  await page
    .getByRole('textbox', { name: 'Your feedback' })
    .fill('Keep this draft while adjusting the workspace.');
  await page.getByRole('button', { name: 'Open settings' }).click();
  await expect(
    page.getByRole('region', { name: 'Settings', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('textbox', { name: 'Your feedback' }),
  ).toBeHidden();
  await page.locator('#complete-task').click();
  await expect(page.locator('#project-status')).toHaveText('1 task completed');
  await page.locator('.include-screenshot').uncheck();
  await page.getByRole('textbox', { name: 'Speech language' }).fill('en-GB');
  await page.getByRole('heading', { name: 'Voice', exact: true }).click();
  await page.screenshot({ path: info.outputPath('settings.png') });
  await panel.screenshot({ path: info.outputPath('settings-panel.png') });
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('textbox', { name: 'Your feedback' }),
  ).toHaveValue('Keep this draft while adjusting the workspace.');
  const handle = (await page
    .getByRole('button', { name: 'Move panel', exact: true })
    .boundingBox())!;
  await page.mouse.move(handle.x + 45, handle.y + 16);
  await page.mouse.down();
  await page.mouse.move(handle.x - 115, handle.y + 80, { steps: 12 });
  await page.mouse.up();
  const moved = (await panel.boundingBox())!;
  expect(moved.x).toBeCloseTo(original.x - 160, 0);
  expect(moved.y).toBeCloseTo(original.y + 64, 0);
  const resize = (await page
    .getByRole('button', { name: 'Resize panel', exact: true })
    .boundingBox())!;
  await page.mouse.move(resize.x + 8, resize.y + 8);
  await page.mouse.down();
  await page.mouse.move(resize.x + 68, resize.y - 52, { steps: 8 });
  await page.mouse.up();
  const resized = (await panel.boundingBox())!;
  expect(resized.width).toBeCloseTo(moved.width + 60, 0);
  expect(resized.height).toBeCloseTo(moved.height - 60, 0);
  await page.getByRole('button', { name: 'Minimize Pointnote' }).click();
  expect((await panel.boundingBox())!.height).toBe(56);
  await page.locator('#complete-task').click();
  await expect(page.locator('#project-status')).toHaveText('2 task completed');
  await page.getByRole('button', { name: 'Restore Pointnote' }).click();
  await expect(
    page.getByRole('textbox', { name: 'Your feedback' }),
  ).toHaveValue('Keep this draft while adjusting the workspace.');
  expect((await panel.boundingBox())!.height).toBeCloseTo(resized.height, 0);
  await page.reload();
  await expect(panel).toBeVisible();
  expect(await panel.boundingBox()).toEqual(resized);
  await page.getByRole('button', { name: 'Open settings' }).click();
  await expect(page.locator('.include-screenshot')).not.toBeChecked();
  await expect(
    page.getByRole('textbox', { name: 'Speech language' }),
  ).toHaveValue('en-GB');
  await page.getByRole('button', { name: 'Reset layout' }).click();
  expect(await panel.boundingBox()).toEqual(original);
  await page.getByRole('button', { name: 'Back to notes' }).click();
  await page.getByRole('button', { name: 'Move panel', exact: true }).focus();
  await page.keyboard.press('ArrowLeft');
  expect((await panel.boundingBox())!.x).toBeCloseTo(original.x - 8, 0);
  await page.getByRole('button', { name: 'Resize panel', exact: true }).focus();
  await page.keyboard.press('ArrowUp');
  expect((await panel.boundingBox())!.height).toBeCloseTo(
    original.height - 8,
    0,
  );
  await page.setViewportSize({ width: 360, height: 600 });
  await expect
    .poll(async () => {
      const bounds = (await panel.boundingBox())!;
      return (
        bounds.x >= 8 &&
        bounds.y >= 8 &&
        bounds.x + bounds.width <= 352 &&
        bounds.y + bounds.height <= 592
      );
    })
    .toBe(true);
  const small = (await panel.boundingBox())!;
  expect(small.x).toBeGreaterThanOrEqual(8);
  expect(small.y).toBeGreaterThanOrEqual(8);
  expect(small.x + small.width).toBeLessThanOrEqual(352);
  expect(small.y + small.height).toBeLessThanOrEqual(592);
  await page.screenshot({ path: info.outputPath('compact.png') });
});

test('notes can be searched and filtered without changing the export, and keyboard save is single-submit', async ({}, info) => {
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/report.html');
  await activate(page);
  await page.screenshot({ path: info.outputPath('empty-workspace.png') });
  await page
    .locator('.panel')
    .screenshot({ path: info.outputPath('review-panel.png') });
  await select(page, '#evidence-claim');
  await save(page, 'Add a source for the retention claim.', 1);
  await select(page, '#retention-chart');
  await page
    .getByRole('textbox', { name: 'Your feedback' })
    .fill('Label the chart axes.');
  await page.keyboard.press('Control+Enter');
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('.card')).toHaveCount(2);
  await expect(page.getByRole('status')).toContainText('Saved locally');
  await page
    .locator('.card')
    .first()
    .getByRole('button', { name: 'Mark addressed' })
    .click();
  await page
    .getByRole('combobox', { name: 'Filter notes' })
    .selectOption('open');
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(page.locator('.comment')).toHaveText('Label the chart axes.');
  await page
    .getByRole('combobox', { name: 'Filter notes' })
    .selectOption('all');
  await page.getByRole('searchbox', { name: 'Search notes' }).fill('source');
  await expect(page.locator('.card')).toHaveCount(1);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export feedback' }).click();
  const files = unzipSync(
    new Uint8Array(await readFile((await (await download).path())!)),
  );
  expect(
    JSON.parse(strFromU8(files['feedback.json'])).annotations,
  ).toHaveLength(2);
  await page.getByRole('searchbox', { name: 'Search notes' }).fill('no-match');
  await expect(
    page.getByText('No matching notes', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Clear filters', exact: true })
    .click();
  await expect(page.locator('.card')).toHaveCount(2);
  await expect(
    page.getByRole('searchbox', { name: 'Search notes' }),
  ).toBeFocused();
  await page.screenshot({ path: info.outputPath('notes-workspace.png') });
});

test('hands-free recording toggles and stops when leaving the workspace', async () => {
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/report.html');
  await activate(page);
  await select(page, '#evidence-claim');
  const cdp = await context.newCDPSession(page);
  const worlds: { id: number; origin: string }[] = [];
  cdp.on('Runtime.executionContextCreated', ({ context: world }) =>
    worlds.push(world),
  );
  await cdp.send('Runtime.enable');
  const world = worlds.find((w) => w.origin.startsWith('chrome-extension://'))!;
  await cdp.send('Runtime.evaluate', {
    contextId: world.id,
    expression: `globalThis.SpeechRecognition = class {
      static async available() { return 'available'; }
      processLocally = true;
      start() { this.onresult({ results: [{ isFinal: true, 0: { transcript: 'Add supporting evidence.' } }] }); }
      stop() { this.onend?.(); } abort() { this.onend?.(); }
    }`,
  });
  await page
    .getByRole('button', { name: 'Start hands-free recording' })
    .click();
  await expect(
    page.getByRole('button', { name: 'Stop recording', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Save note' })).toBeDisabled();
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(
    page.getByRole('button', { name: 'Stop recording', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByRole('textbox', { name: 'Your feedback' }),
  ).toHaveValue('Add supporting evidence.');
  await page
    .getByRole('button', { name: 'Stop recording', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Save note' })).toBeEnabled();
  await page
    .getByRole('button', { name: 'Start hands-free recording' })
    .click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Back to notes' }).click();
  await expect(
    page.getByRole('button', { name: 'Start hands-free recording' }),
  ).toBeVisible();
  const talk = page.getByRole('button', { name: 'Hold to talk', exact: true });
  const talkBounds = (await talk.boundingBox())!;
  await page.mouse.move(talkBounds.x + 50, talkBounds.y + 20);
  await page.mouse.down();
  await expect(
    page.getByRole('button', { name: 'Stop recording', exact: true }),
  ).toBeVisible();
  await page.mouse.move(talkBounds.x - 80, talkBounds.y + 20);
  await page.mouse.up();
  await expect(
    page.getByRole('button', { name: 'Start hands-free recording' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(page.locator('.card')).toHaveCount(1);
  await cdp.detach();
});

test('middle mouse records the selected target from anywhere and keeps an editable draft', async ({}, info) => {
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/report.html');
  await activate(page);
  const speech = await simulateSpeech(page);
  await page.mouse.click(100, 160, { button: 'middle' });
  await expect(page.getByRole('status')).toContainText('Select a target');
  expect((await speech.evaluate('speechStarts')).result.value).toBe(0);
  await select(page, '#evidence-claim');
  const feedback = page.getByRole('textbox', { name: 'Your feedback' });
  await feedback.fill('My written context.');
  await page.mouse.move(90, 250);
  await page.mouse.down({ button: 'middle' });
  await expect(feedback).toHaveValue(
    'My written context.\nAdd supporting evidence.',
  );
  await expect(feedback).toBeDisabled();
  await expect(page.locator('.recording-toast')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save note' })).toBeDisabled();
  await expect(page.locator('.target-name')).toHaveText('p#evidence-claim');
  await page.screenshot({ path: info.outputPath('middle-recording.png') });
  await page
    .locator('.panel')
    .screenshot({ path: info.outputPath('recording-panel.png') });
  // Release over the panel after starting on the page, without moving the target.
  const panel = (await page.locator('.panel').boundingBox())!;
  await page.mouse.move(panel.x + 30, panel.y + 100);
  await page.mouse.up({ button: 'middle' });
  await expect(feedback).toBeEnabled();
  await expect(page.locator('.recording-toast')).toBeHidden();
  await expect(page.locator('.card')).toHaveCount(0);
  await page.mouse.down({ button: 'middle' });
  await expect(feedback).toHaveValue(
    'My written context.\nAdd supporting evidence.\nAdd supporting evidence.',
  );
  await page.mouse.up({ button: 'middle' });
  await save(page, 'Please cite the study supporting this claim.', 1);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export feedback' }).click();
  const files = unzipSync(
    new Uint8Array(await readFile((await (await download).path())!)),
  );
  const note = JSON.parse(strFromU8(files['feedback.json'])).annotations[0];
  expect(note.targets[0].locator.id).toBe('evidence-claim');
  expect(note.originalComment).toBe(
    'Please cite the study supporting this claim.',
  );
  expect(note.input.transcript).toBe(
    'Add supporting evidence. Add supporting evidence.',
  );
  await speech.close();
});

test('middle mouse respects text selections and preserves normal links when selection is paused', async () => {
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/report.html');
  await activate(page);
  const speech = await simulateSpeech(page);
  await page.getByRole('button', { name: 'Text range', exact: true }).click();
  const rect = await page.locator('#evidence-claim').evaluate((el) => {
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const range = document.createRange();
    range.setStart(
      el.firstChild!,
      el.firstChild!.textContent!.indexOf('Teams'),
    );
    range.setEnd(
      el.firstChild!,
      el.firstChild!.textContent!.indexOf('workspace') + 9,
    );
    const r = range.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  await page.mouse.move(rect.x + 1, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width - 1, rect.y + rect.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(page.locator('.excerpt')).toContainText('focused workspace');
  const quote = await page.locator('.excerpt').textContent();
  await page.evaluate(() => window.scrollTo(0, 0));
  const link = page.locator('a.wordmark');
  const box = (await link.boundingBox())!;
  // In text mode the real link receives hit-testing; the shortcut must suppress
  // both autoscroll and the auxiliary click without replacing the text range.
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down({ button: 'middle' });
  await expect(page.locator('.recording-toast')).toBeVisible();
  await page.mouse.up({ button: 'middle' });
  await expect(
    page.getByRole('textbox', { name: 'Your feedback' }),
  ).toBeEnabled();
  await expect(page.locator('.excerpt')).toHaveText(quote!);
  expect(context.pages()).toHaveLength(2);
  await page.getByRole('button', { name: 'Pause selection' }).click();
  const newTab = context.waitForEvent('page');
  await link.click({ button: 'middle' });
  await (await newTab).close();
  expect((await speech.evaluate('speechStarts')).result.value).toBe(1);
  await page.getByRole('button', { name: 'Resume selection' }).click();
  await page
    .getByRole('button', { name: 'Start hands-free recording' })
    .click();
  await page.mouse.click(100, 160, { button: 'middle' });
  await expect(
    page.getByRole('button', { name: 'Stop recording', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('textbox', { name: 'Your feedback' }),
  ).toBeEnabled();
  await speech.close();
});

test('middle recording cancels safely and recovers from delayed startup and microphone denial', async () => {
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/report.html');
  await activate(page);
  await select(page, '#evidence-claim');
  const speech = await simulateSpeech(page);
  const feedback = page.getByRole('textbox', { name: 'Your feedback' });
  await feedback.fill('Keep this draft.');
  await speech.evaluate('speechPending = true');
  await page.mouse.move(90, 250);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.up({ button: 'middle' });
  await expect(feedback).toBeEnabled();
  await speech.evaluate("resolveSpeech('available'); speechPending = false");
  await expect(feedback).toBeEnabled();
  expect((await speech.evaluate('speechStarts')).result.value).toBe(0);
  await expect(feedback).toHaveValue('Keep this draft.');
  await speech.evaluate('speechDenied = true');
  await page.mouse.down({ button: 'middle' });
  await expect(page.getByRole('status')).toContainText(
    'Microphone access was denied',
  );
  await page.mouse.up({ button: 'middle' });
  await expect(feedback).toBeEnabled();
  await expect(feedback).toHaveValue('Keep this draft.');
  await speech.evaluate('speechDenied = false');
  for (const action of [
    'escape',
    'blur',
    'settings',
    'minimize',
    'pause',
    'close',
  ]) {
    await page.mouse.move(90, 250);
    await page.mouse.down({ button: 'middle' });
    await expect(page.locator('.recording-toast')).toBeVisible();
    if (action === 'escape') await page.keyboard.press('Escape');
    else if (action === 'blur')
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    else await page.locator(`[data-action="${action}"]`).click();
    await page.mouse.up({ button: 'middle' });
    await expect(page.locator('.recording-toast')).toBeHidden();
    if (action === 'settings')
      await page.getByRole('button', { name: 'Back to notes' }).click();
    if (action === 'minimize')
      await page.getByRole('button', { name: 'Restore Pointnote' }).click();
    if (action === 'pause')
      await page.getByRole('button', { name: 'Resume selection' }).click();
  }
  const starts = (await speech.evaluate('speechStarts')).result.value;
  await page.mouse.click(100, 160, { button: 'middle' });
  expect((await speech.evaluate('speechStarts')).result.value).toBe(starts);
  await speech.close();
});
