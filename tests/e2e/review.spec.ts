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
    permissions: ['microphone'],
    args: [
      '--use-fake-device-for-media-stream',
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
  const sw = context.serviceWorkers()[0];
  await sw.evaluate(async () => {
    const { preferences = {} } = await chrome.storage.local.get('preferences');
    await chrome.storage.local.set({
      preferences: {
        ...(preferences as object),
        voiceReady: true,
        voiceOnboardingSeen: true,
      },
    });
  });
  const pageCdp = await context.newCDPSession(page);
  const worlds: { id: number; origin: string }[] = [];
  pageCdp.on('Runtime.executionContextCreated', ({ context: world }) =>
    worlds.push(world),
  );
  await pageCdp.send('Runtime.enable');
  const world = worlds.find((w) => w.origin.startsWith('chrome-extension://'))!;
  await pageCdp.send('Runtime.evaluate', {
    contextId: world.id,
    expression:
      'chrome.runtime.sendMessage({ target: "pointnote-voice", action: "prepare" })',
    awaitPromise: true,
  });
  await pageCdp.detach();
  const cdp = await context.browser()!.newBrowserCDPSession();
  const { targetInfos } = await cdp.send('Target.getTargets');
  const target = targetInfos.find((t) => t.url.endsWith('/recorder.html'))!;
  expect(target).toBeTruthy();
  const { sessionId } = await cdp.send('Target.attachToTarget', {
    targetId: target.targetId,
    flatten: false,
  });
  let serial = 0;
  const evaluate = (
    expression: string,
  ): Promise<{ result: { value?: unknown } }> =>
    new Promise((resolve, reject) => {
      const id = ++serial;
      const listener = (event: { sessionId: string; message: string }) => {
        if (event.sessionId !== sessionId) return;
        const response = JSON.parse(event.message);
        if (response.id !== id) return;
        cdp.off('Target.receivedMessageFromTarget', listener);
        if (response.error || response.result?.exceptionDetails)
          reject(new Error(JSON.stringify(response)));
        else resolve(response.result);
      };
      cdp.on('Target.receivedMessageFromTarget', listener);
      void cdp
        .send('Target.sendMessageToTarget', {
          sessionId,
          message: JSON.stringify({
            id,
            method: 'Runtime.evaluate',
            params: { expression, returnByValue: true, awaitPromise: true },
          }),
        })
        .catch(reject);
    });
  await evaluate(`
    globalThis.speechStarts = 0;
    globalThis.speechDenied = false;
    globalThis.speechPending = false;
    globalThis.speechDelayAudio = false;
    globalThis.speechOnRelease = false;
    globalThis.SpeechRecognition = class {
      static available() {
        return globalThis.speechPending
          ? new Promise(resolve => { globalThis.resolveSpeech = resolve; })
          : Promise.resolve('available');
      }
      processLocally = true;
      start() {
        globalThis.activeSpeech = this;
        globalThis.speechStarts++;
        if (globalThis.speechDenied) this.onerror?.({ error: 'not-allowed' });
        else if (!globalThis.speechDelayAudio) {
          this.onaudiostart?.();
          this.onspeechstart?.();
          if (!globalThis.speechOnRelease) this.onresult?.({ results: [{ isFinal: true, 0: { transcript: 'Add supporting evidence.' } }] });
        }
      }
      stop() {
        if (globalThis.speechOnRelease) setTimeout(() => {
          this.onresult?.({ results: [{ isFinal: true, 0: { transcript: 'Final words from the microphone.' } }] });
          this.onend?.();
        }, 250);
        else this.onend?.();
      }
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

test('review actions retain keyboard focus and require a session name', async () => {
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/report.html');
  await activate(page);
  await page.getByRole('button', { name: 'Review sessions' }).click();
  const start = page.getByRole('button', {
    name: 'Start session',
    exact: true,
  });
  await expect(start).toBeDisabled();
  await page
    .getByRole('textbox', { name: 'New session name', exact: true })
    .fill('   ');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download backup' }).click();
  await download;
  await expect(start).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Download backup' }),
  ).toBeFocused();
  await page
    .getByRole('textbox', { name: 'New session name', exact: true })
    .fill('Launch review');
  await start.click();
  await expect(
    page.getByRole('combobox', { name: 'Active review session' }),
  ).not.toHaveValue('');
  await expect(start).toBeDisabled();
  await page.getByRole('button', { name: 'Edit session', exact: true }).click();
  await expect(
    page.getByRole('textbox', { name: 'Session name', exact: true }),
  ).toBeFocused();
  await page
    .getByRole('textbox', { name: 'Session name', exact: true })
    .fill('Discard this edit');
  await page.getByRole('button', { name: 'Cancel edit' }).click();
  await expect(
    page.getByRole('button', { name: 'Edit session', exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole('combobox', { name: 'Active review session' }),
  ).toContainText('Launch review');
  await page.getByRole('button', { name: 'Back to page notes' }).click();
  await page.getByRole('button', { name: 'Page note', exact: true }).click();
  await save(page, 'A keyboard review note.', 1);
  await page
    .getByRole('button', { name: 'Prepare handoff', exact: true })
    .click();
  await expect(page.locator('.review-scope')).toHaveText('Launch review');
  const clear = page.getByRole('button', {
    name: 'Clear selection',
    exact: true,
  });
  await clear.click();
  await expect(clear).toBeFocused();
  await expect(
    page.getByRole('button', { name: 'Copy Markdown to clipboard' }),
  ).toBeDisabled();
  const all = page.getByRole('button', { name: 'Select all', exact: true });
  await all.press('Enter');
  await expect(all).toBeFocused();
  await expect(
    page.getByRole('button', { name: 'Copy Markdown to clipboard' }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Back to page notes' }).click();
  await page
    .getByRole('button', { name: 'Check changes', exact: true })
    .click();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(
    page.getByRole('heading', { name: 'Check changes', exact: true }),
  ).toBeFocused();
  await expect(page.locator('.review-summary')).toContainText('every note');
});

test('screenshot studio keeps small-window controls and keyboard recovery reachable', async ({}, info) => {
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/report.html');
  await activate(page);
  await page.getByRole('button', { name: 'Page note', exact: true }).click();
  await save(page, 'Check the small-window screenshot workflow.', 1);
  await page
    .getByRole('button', { name: 'View screenshot for note 1' })
    .click();
  const studio = page.getByRole('dialog', { name: 'Screenshot studio' });
  for (const size of [
    { width: 600, height: 400 },
    { width: 320, height: 480 },
  ]) {
    await page.setViewportSize(size);
    const original = studio.getByRole('button', {
      name: 'Show original',
      exact: true,
    });
    await original.scrollIntoViewIfNeeded();
    await expect(original).toBeInViewport();
    await original.click();
    await studio
      .getByRole('button', { name: 'Show my marks', exact: true })
      .click();
    await expect(
      studio.getByRole('button', { name: 'Save changes', exact: true }),
    ).toBeInViewport();
  }
  await studio.getByRole('button', { name: 'Callout', exact: true }).click();
  const canvas = studio.getByRole('group', { name: 'Screenshot canvas' });
  await canvas.focus();
  await page.keyboard.press('Enter');
  const field = studio.getByRole('textbox', { name: 'Callout 1 text' });
  await expect(field).toBeFocused();
  await expect(field).toBeInViewport();
  await field.fill('Keep the controls reachable.');
  await page.screenshot({ path: info.outputPath('studio-compact.png') });
  await studio
    .getByRole('button', { name: 'Remove callout 1', exact: true })
    .click();
  await expect(canvas).toBeFocused();
  await page.keyboard.press('Enter');
  await field.fill('Retain this edit.');
  await page.keyboard.press('Escape');
  await expect(
    studio.getByRole('button', { name: 'Keep editing', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(
    studio.getByRole('button', { name: 'Keep editing', exact: true }),
  ).toBeHidden();
  await expect(
    studio.getByRole('button', { name: 'Save changes', exact: true }),
  ).toBeFocused();
  await studio
    .getByRole('button', { name: 'Save changes', exact: true })
    .click();
  await expect(studio).toBeHidden();
});

test('screenshot studio preserves masked close-ups, edits and original image files', async ({}, info) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 2200, height: 1000 });
  await page.goto('http://127.0.0.1:4173/report.html');
  await page.evaluate(() => {
    document.body.innerHTML =
      '<section id="crop-proof" style="position:relative;margin:80px;width:800px;height:400px;background:white;border:1px solid #ccc"><h1 style="margin:30px">A clear visual reference</h1><p style="margin:30px;font-size:14px">Keep this small label readable.</p><input aria-label="Private field" value="NEVER-EXPORT-THIS" style="position:absolute;left:80px;top:180px;width:240px;height:40px"></section>';
  });
  await activate(page);
  await select(page, '#crop-proof');
  await save(page, 'Align the label with this edge.', 1);
  await page
    .getByRole('button', { name: 'View screenshot for note 1' })
    .click();
  const studio = page.getByRole('dialog', { name: 'Screenshot studio' });
  await expect(studio).toBeVisible();
  await studio.locator('[data-view="1"]').click();
  await expect(studio.locator('.evidence-detail')).toContainText(
    'target and its surroundings',
  );
  await studio.getByRole('button', { name: 'Arrow', exact: true }).click();
  const stage = studio.getByRole('group', { name: 'Screenshot canvas' });
  const r = (await stage.boundingBox())!;
  await page.mouse.move(r.x + r.width * 0.25, r.y + r.height * 0.75);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width * 0.6, r.y + r.height * 0.65, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(studio.locator('.evidence-marks path')).toHaveCount(2);
  await studio.getByRole('button', { name: 'Callout', exact: true }).click();
  await stage.focus();
  await stage.press('ArrowRight');
  await stage.press('Enter');
  await studio
    .getByRole('textbox', { name: 'Callout 1 text' })
    .fill('  Align to this edge.\nKeep this wording.  ');
  await studio
    .getByRole('button', { name: 'Show original', exact: true })
    .click();
  await expect(studio.locator('.evidence-marks path')).toHaveCount(0);
  await studio
    .getByRole('button', { name: 'Show my marks', exact: true })
    .click();
  await expect(studio.locator('.evidence-marks path')).toHaveCount(2);
  await studio.getByRole('button', { name: '100%', exact: true }).click();
  await studio.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(studio.locator('.zoom-value')).toHaveText('125%');
  await studio.getByRole('button', { name: 'Fit', exact: true }).click();
  await page.screenshot({ path: info.outputPath('screenshot-studio.png') });
  await page.setViewportSize({ width: 600, height: 800 });
  await expect(
    studio.getByRole('button', { name: 'Save changes', exact: true }),
  ).toBeInViewport();
  await page.screenshot({
    path: info.outputPath('screenshot-studio-narrow.png'),
  });
  await studio.getByRole('button', { name: 'Close screenshot editor' }).click();
  await expect(studio.locator('.evidence-discard')).toBeVisible();
  await studio.getByRole('button', { name: 'Keep editing' }).click();
  await studio
    .getByRole('button', { name: 'Save changes', exact: true })
    .click();
  await expect(studio).toBeHidden();
  await page.setViewportSize({ width: 2200, height: 1000 });
  await page.reload();
  await expect(page.locator('.card')).toHaveCount(1);
  await page
    .getByRole('button', { name: 'View screenshot for note 1' })
    .click();
  await studio.locator('[data-view="1"]').click();
  await expect(
    studio.getByRole('textbox', { name: 'Callout 1 text' }),
  ).toHaveValue('  Align to this edge.\nKeep this wording.  ');
  await studio.getByRole('button', { name: 'Back to notes' }).click();
  await page.getByRole('button', { name: 'Prepare handoff' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save ZIP file' }).click();
  const files = unzipSync(await readFile((await (await download).path())!));
  const json = strFromU8(files['feedback.json']);
  const exported = JSON.parse(json).annotations[0] as Annotation;
  expect(json).not.toContain('NEVER-EXPORT-THIS');
  expect(json).not.toContain('data:image');
  expect(exported.screenshot.status).toBe('available');
  if (exported.screenshot.status !== 'available')
    throw new Error('Capture missing.');
  const crop = exported.screenshot.crops![0];
  if (crop.status !== 'available') throw new Error('Close-up missing.');
  expect(exported.screenshot.width).toBe(1600);
  expect(crop.width).toBeGreaterThan(
    (exported.targets[0].bounds.width * 1600) / 2200 + 100,
  );
  expect(crop.marks).toHaveLength(2);
  expect(crop.marked).toBeTruthy();
  expect(files[crop.path]).not.toEqual(files[crop.marked!.path]);
  expect(strFromU8(files['feedback.md'])).toContain(
    '  Align to this edge.\nKeep this wording.  ',
  );
  const maskedPixel = await page.evaluate(
    async ({ data, cropBounds }) => {
      const image = new Image();
      image.src = data;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      // The field center was x=80 margin + 80 inset + 120 half-width, y=80+180+20.
      return [
        ...ctx.getImageData(
          Math.round(280 - cropBounds.x),
          Math.round(280 - cropBounds.y),
          1,
          1,
        ).data,
      ];
    },
    {
      data:
        'data:image/png;base64,' +
        Buffer.from(files[crop.path]).toString('base64'),
      cropBounds: crop.bounds,
    },
  );
  expect(maskedPixel).toEqual([220, 225, 223, 255]);
});

test('comparison roles can swap, survive reload and remain explicit in a handoff', async ({}, info) => {
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/report.html');
  await activate(page);
  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  await select(page, '#evidence-claim');
  await page
    .getByRole('textbox', { name: 'Your feedback' })
    .fill('Make the chart typography match this claim.');
  await expect(
    page.getByRole('button', { name: 'Save note', exact: true }),
  ).toBeDisabled();
  await select(page, '#retention-chart');
  await page.getByRole('button', { name: 'Swap change and reference' }).click();
  await page
    .getByRole('combobox', { name: 'What to match' })
    .selectOption('typography');
  await expect(page.locator('[data-compare-slot="1"]')).toContainText('38%');
  await page.screenshot({ path: info.outputPath('comparison-picker.png') });
  await save(page, 'Make the chart typography match this claim.', 1);
  await page.reload();
  await expect(page.locator('.comparison-summary')).toContainText('typography');
  await page.getByRole('button', { name: 'Prepare handoff' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save ZIP file' }).click();
  const files = unzipSync(await readFile((await (await download).path())!));
  const exported = JSON.parse(strFromU8(files['feedback.json']))
    .annotations[0] as Annotation;
  expect(exported.targets[0].locator.id).toBe('retention-chart');
  expect(exported.targets[1].locator.id).toBe('evidence-claim');
  expect(exported.comparison).toEqual({
    changeTarget: 0,
    referenceTarget: 1,
    dimension: 'typography',
  });
  expect(strFromU8(files['feedback.md'])).toContain(
    'Keep the reference unchanged.',
  );
});

test('comparison refinement and reattachment preserve the draft and its relationship', async () => {
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/report.html');
  await activate(page);
  await page.getByRole('button', { name: 'Multiple', exact: true }).click();
  await select(page, '#evidence-claim');
  await select(page, '#retention-chart');
  await page
    .getByRole('textbox', { name: 'Your feedback' })
    .fill('Keep my precise comparison wording.');
  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  await expect(page.locator('.card')).toHaveCount(0);
  await page.getByRole('button', { name: 'Choose element to change' }).click();
  await select(page, '#report-title');
  await expect(
    page.getByRole('textbox', { name: 'Your feedback' }),
  ).toHaveValue('Keep my precise comparison wording.');
  await expect(page.locator('.card')).toHaveCount(0);
  await page
    .getByRole('combobox', { name: 'What to match' })
    .selectOption('alignment');
  await save(page, 'Keep my precise comparison wording.', 1);
  await page.getByLabel('Details for note 1').click();
  await page.getByRole('button', { name: 'Reattach', exact: true }).click();
  await expect(
    page.getByRole('combobox', { name: 'What to match' }),
  ).toHaveValue('alignment');
  await expect(
    page.getByRole('combobox', { name: 'What to match' }),
  ).toBeDisabled();
  await select(page, '#report-title');
  await expect(
    page.getByRole('button', { name: 'Attach here', exact: true }),
  ).toBeDisabled();
  await select(page, '#retention-chart');
  await page.getByRole('button', { name: 'Attach here', exact: true }).click();
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(page.locator('.card .comment')).toHaveText(
    'Keep my precise comparison wording.',
  );
  await page.getByRole('button', { name: 'Prepare handoff' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save ZIP file' }).click();
  const files = unzipSync(await readFile((await (await download).path())!));
  const exported = JSON.parse(strFromU8(files['feedback.json']))
    .annotations[0] as Annotation;
  expect(exported.comparison?.dimension).toBe('alignment');
  expect(exported.reattachments[0].comparison).toEqual(exported.comparison);
  expect(exported.reattachments[0].targets[0].locator.id).toBe('report-title');
});

test('handoff selects open Now notes and preserves exact instructions', async ({}, info) => {
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/report.html');
  await activate(page);
  await select(page, '#evidence-claim');
  await save(page, 'Add evidence.', 1);
  await select(page, '#retention-chart');
  await save(page, 'Polish this later.', 2);
  await page.getByRole('button', { name: 'Prepare handoff' }).click();
  await page
    .getByRole('combobox', { name: 'Priority: Polish this later.' })
    .selectOption('later');
  await expect(page.locator('.handoff-count')).toContainText(
    '1 change selected',
  );
  await expect(
    page.getByRole('checkbox', { name: 'Include: Polish this later.' }),
  ).not.toBeChecked();
  const instruction = '  Keep colors.\nOnly change the requested items.  ';
  await page
    .getByRole('textbox', { name: 'Instructions for this handoff' })
    .fill(instruction);
  await page
    .locator('.panel')
    .screenshot({ path: info.outputPath('handoff-preview.png') });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save ZIP file' }).click();
  const files = unzipSync(
    new Uint8Array(await readFile((await (await download).path())!)),
  );
  const data = JSON.parse(strFromU8(files['feedback.json']));
  expect(data.annotations.map((a: Annotation) => a.originalComment)).toEqual([
    'Add evidence.',
  ]);
  expect(data.handoff.instructions).toBe(instruction);
  await page.reload();
  await page.getByRole('button', { name: 'Prepare handoff' }).click();
  await expect(
    page.getByRole('checkbox', { name: 'Include: Polish this later.' }),
  ).not.toBeChecked();
  await page.getByRole('button', { name: 'Clear selection' }).click();
  await expect(
    page.getByRole('button', { name: 'Save ZIP file' }),
  ).toBeDisabled();
  await page
    .getByRole('checkbox', { name: 'Include: Polish this later.' })
    .check();
  await expect(
    page.getByRole('button', { name: 'Save ZIP file' }),
  ).toBeEnabled();
});

test('page and area notes capture additions without inventing element targets', async ({}, info) => {
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/frontend.html');
  await activate(page);
  await page.getByRole('button', { name: 'Page note', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Your feedback' })
    .fill('Give this page a clearer hierarchy.');
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(page.locator('.card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Select area', exact: true }).click();
  await page.mouse.move(80, 90);
  await page.mouse.down();
  await page.mouse.move(300, 240, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.target-name')).toHaveText('Selected area');
  await page
    .getByRole('textbox', { name: 'Your feedback' })
    .fill('Add a search box here.');
  await page
    .locator('.panel')
    .screenshot({ path: info.outputPath('area-note.png') });
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(page.locator('.card')).toHaveCount(2);
  await page.reload();
  await expect(page.locator('.card')).toHaveCount(2);
  await expect(page.locator('.status.missing')).toHaveCount(0);
  await page.getByRole('button', { name: 'Prepare handoff' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save ZIP file' }).click();
  const files = unzipSync(
    new Uint8Array(await readFile((await (await download).path())!)),
  );
  const data = JSON.parse(strFromU8(files['feedback.json']));
  expect(data.annotations.map((a: Annotation) => a.selectionKind)).toEqual([
    'page',
    'region',
  ]);
  expect(
    data.annotations.every((a: Annotation) => a.targets.length === 0),
  ).toBe(true);
  expect(
    data.annotations.every(
      (a: Annotation) => a.screenshot.status === 'available',
    ),
  ).toBe(true);
  expect(data.annotations[1].region).toEqual({
    x: 80,
    y: 90,
    width: 220,
    height: 150,
  });
  expect(strFromU8(files['feedback.md'])).toContain('not a tracked element');
  expect(strFromU8(files['feedback.json'])).not.toContain('PRIVATE-DRAFT-789');
});

test('moving the viewport clears an area reference but preserves its draft', async () => {
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/report.html');
  await activate(page);
  await page.getByRole('button', { name: 'Select area', exact: true }).click();
  await page.mouse.move(80, 90);
  await page.mouse.down();
  await page.mouse.move(300, 240, { steps: 4 });
  await page.mouse.up();
  await page
    .getByRole('textbox', { name: 'Your feedback' })
    .fill('Add a section here.');
  await page.evaluate(() => window.scrollBy(0, 100));
  await expect(page.getByRole('status')).toContainText('The view moved');
  await expect(
    page.getByRole('textbox', { name: 'Your feedback' }),
  ).toHaveValue('Add a section here.');
  await expect(page.getByRole('button', { name: 'Save note' })).toBeDisabled();
});

test('handoff instruction drafts stay isolated between pages and sessions', async () => {
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/report.html');
  await activate(page);
  await select(page, '#evidence-claim');
  await save(page, 'Review this report.', 1);
  await page.getByRole('button', { name: 'Prepare handoff' }).click();
  await page
    .getByRole('textbox', { name: 'Instructions for this handoff' })
    .fill('REPORT ONLY: keep the original data.');
  await page.getByRole('button', { name: 'Back to page notes' }).click();
  await page
    .getByRole('button', { name: 'Review sessions', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'New session name' })
    .fill('Separate review');
  await page
    .getByRole('button', { name: 'Start session', exact: true })
    .click();
  await page.getByRole('button', { name: 'Back to page notes' }).click();
  await page.getByRole('button', { name: 'Prepare handoff' }).click();
  await expect(
    page.getByRole('textbox', { name: 'Instructions for this handoff' }),
  ).toHaveValue('');
});

test('backup preview restores deleted notes and preserves existing versions', async ({}, info) => {
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/report.html');
  await activate(page);
  await select(page, '#evidence-claim');
  await save(page, 'Back up these exact words.', 1);
  await page
    .getByRole('button', { name: 'Review sessions', exact: true })
    .click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download backup' }).click();
  const file = info.outputPath('backup.json');
  await (await download).saveAs(file);
  await page.getByRole('button', { name: 'Back to page notes' }).click();
  await page
    .getByRole('button', { name: 'Clear all notes for this page' })
    .click();
  await page.getByRole('button', { name: 'Delete notes', exact: true }).click();
  await expect(page.locator('.card')).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Review sessions', exact: true })
    .click();
  await page.getByLabel('Choose a Pointnote backup').setInputFiles(file);
  await expect(
    page.getByText(
      '1 note · 0 sessions. 1 new note; existing notes will be kept.',
    ),
  ).toBeVisible();
  await expect(page.locator('.card')).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Restore backup', exact: true })
    .click();
  await expect(page.getByRole('status')).toContainText('Restored 1 note');
  await page.getByLabel('Choose a Pointnote backup').setInputFiles(file);
  await page
    .getByRole('button', { name: 'Restore backup', exact: true })
    .click();
  await expect(page.getByRole('status')).toContainText('Kept 1 existing note');
  await page.getByRole('button', { name: 'Back to page notes' }).click();
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(page.locator('.comment')).toHaveText(
    'Back up these exact words.',
  );
});

test('review sessions collect pages explicitly and survive navigation', async ({}, info) => {
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/report.html');
  await activate(page);
  await select(page, '#evidence-claim');
  await save(page, 'Existing page note.', 1);
  await page
    .getByRole('button', { name: 'Review sessions', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'New session name' })
    .fill('Before launch');
  await page
    .getByRole('textbox', { name: 'Instructions for this session' })
    .fill('Keep the colors.');
  await page
    .getByRole('button', { name: 'Start session', exact: true })
    .click();
  await expect(page.locator('.review-summary')).toHaveText(
    '0 notes across 0 pages',
  );
  await page
    .getByRole('button', { name: 'Add 1 existing page note to this session' })
    .click();
  await expect(page.locator('.review-summary')).toHaveText(
    '1 note across 1 page',
  );
  await page.getByRole('button', { name: 'Back to page notes' }).click();
  await page.goto('http://127.0.0.1:4173/frontend.html');
  await expect(page.locator('.session-label')).toContainText('Before launch');
  await select(page, '#complete-task');
  await save(page, 'Clarify the action.', 1);
  await page.getByRole('button', { name: 'Prepare handoff' }).click();
  await expect(page.locator('.handoff-count')).toHaveText(
    '2 changes selected · 2 pages',
  );
  await expect(
    page.getByRole('textbox', { name: 'Instructions for this handoff' }),
  ).toHaveValue('Keep the colors.');
  await page
    .locator('.panel')
    .screenshot({ path: info.outputPath('session-handoff.png') });
});

test('check changes preserves original evidence and exports reviewer follow-up', async ({}, info) => {
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/report.html');
  await activate(page);
  await select(page, '#evidence-claim');
  await save(page, 'Original request stays exact.', 1);
  await page
    .getByRole('button', { name: 'Check changes', exact: true })
    .click();
  await expect(
    page.getByRole('img', {
      name: 'Original page with the feedback target outlined',
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Locate current target' }).click();
  await expect(page.locator('.outline')).toHaveCount(1);
  await page
    .getByRole('textbox', { name: 'Follow-up for another pass' })
    .fill('The sample size is still missing.');
  await page
    .locator('.panel')
    .screenshot({ path: info.outputPath('check-changes.png') });
  await page
    .getByRole('button', { name: 'Needs another pass', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Prepare handoff', exact: true })
    .click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save Markdown file' }).click();
  const markdown = await readFile((await (await download).path())!, 'utf8');
  expect(markdown).toContain('Original request stays exact.');
  expect(markdown).toContain('The sample size is still missing.');
  await page
    .getByRole('button', { name: 'Check changes', exact: true })
    .click();
  await page.getByRole('button', { name: 'Looks right', exact: true }).click();
  await page.getByRole('button', { name: 'Back to page notes' }).click();
  await expect(page.locator('.card .status')).toHaveText('Accepted');
  await page.getByRole('button', { name: 'Prepare handoff' }).click();
  await expect(page.locator('.handoff-count')).toContainText(
    '0 changes selected',
  );
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
  await page
    .getByRole('button', { name: 'Locate note 1', exact: true })
    .click();
  await expect(page.locator('.target-name')).toContainText('evidence-claim');
  await page.screenshot({ path: info.outputPath('review.png') });
  await context.close();
  context = await launch();
  page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/report.html');
  await activate(page);
  await expect(page.locator('.card')).toHaveCount(3);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Prepare handoff' }).click();
  await page.getByRole('button', { name: 'Save ZIP file' }).click();
  const saved = await download;
  const exportPath = info.outputPath('feedback.zip');
  await saved.saveAs(exportPath);
  const files = unzipSync(new Uint8Array(await readFile(exportPath)));
  const data = JSON.parse(strFromU8(files['feedback.json'])) as {
    annotations: Annotation[];
    schemaVersion: string;
  };
  expect(data.schemaVersion).toBe('1.2.0');
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
  await page.getByRole('button', { name: 'Prepare handoff' }).click();
  await page.getByRole('button', { name: 'Save ZIP file' }).click();
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
  const speech = await simulateSpeech(page);
  await speech.evaluate(
    `activeSpeech = undefined; SpeechRecognition.prototype.start = function() { this.onaudiostart?.(); this.onresult({ results: [{ isFinal: true, 0: { transcript: 'this needs more proof' } }] }); }`,
  );
  const talk = page.getByRole('button', { name: 'Hold to talk', exact: true });
  await talk.focus();
  await page.keyboard.down('Space');
  await expect(
    page.getByRole('textbox', { name: 'Your feedback' }),
  ).toHaveValue('this needs more proof');
  await page.keyboard.up('Space');
  await save(page, 'This needs more proof. Add a citation.', 3);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Prepare handoff' }).click();
  await page.getByRole('button', { name: 'Save ZIP file' }).click();
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
  await speech.close();
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
  await expect(page.getByRole('status')).toContainText('Saved locally.');
  await page
    .locator('.card')
    .getByRole('button', { name: 'Mark addressed' })
    .click();
  await expect(page.locator('.card .status')).toHaveText('Addressed');
  await page.locator('#evidence-claim').evaluate((el) => {
    el.removeAttribute('id');
    el.after(el.cloneNode(true));
  });
  await expect(page.locator('.status.missing')).toHaveCount(1);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Prepare handoff' }).click();
  await page.getByRole('button', { name: 'Select all', exact: true }).click();
  await page.getByRole('button', { name: 'Save ZIP file' }).click();
  const files = unzipSync(
    new Uint8Array(await readFile((await (await download).path())!)),
  );
  const data = JSON.parse(strFromU8(files['feedback.json']));
  expect(data.annotations[0].attachment.state).toBe('ambiguous');
  expect(data.annotations[0].resolution).toBe('addressed');
  expect(data.annotations[0].screenshot.status).toBe('unavailable');
  expect(data.annotations[0].originalComment).toBe('Keep this exact note.');
});

test('keyboard selection attaches focused controls without activating the page', async () => {
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/frontend.html');
  await activate(page);
  const target = page.locator('#complete-task');
  await target.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#project-status')).toHaveText('No actions yet');
  await expect(page.locator('.target .excerpt')).toContainText(
    'Complete a task',
  );
  await expect(
    page.getByRole('textbox', { name: 'Your feedback' }),
  ).toBeFocused();
  await save(page, 'Make the action easier to find.', 1);
  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  await target.focus();
  await page.keyboard.press('Space');
  await page.locator('#route-change').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-compare-slot="0"]')).toContainText(
    'Complete a task',
  );
  await expect(page.locator('[data-compare-slot="1"]')).toContainText(
    'Open activity view',
  );
  await save(page, 'Match the action button styling.', 2);
  await expect(page.locator('#project-status')).toHaveText('No actions yet');
  await expect(page).toHaveURL('http://127.0.0.1:4173/frontend.html');
  await page
    .getByRole('button', { name: 'Pause selection', exact: true })
    .click();
  await expect(page.locator('.hint')).toContainText('Selection paused');
  await target.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#project-status')).toHaveText('1 task completed');
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
  expect((await panel.boundingBox())!.height).toBe(46);
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
  const beforeLeftResize = (await panel.boundingBox())!;
  await page
    .getByRole('button', { name: 'Resize panel from left', exact: true })
    .focus();
  await page.keyboard.press('ArrowLeft');
  const afterLeftResize = (await panel.boundingBox())!;
  expect(afterLeftResize.x).toBe(beforeLeftResize.x - 8);
  expect(afterLeftResize.width).toBe(beforeLeftResize.width + 8);
  expect(afterLeftResize.x + afterLeftResize.width).toBe(
    beforeLeftResize.x + beforeLeftResize.width,
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
  await expect(
    page.getByRole('searchbox', { name: 'Search notes' }),
  ).toBeHidden();
  await expect(
    page.getByRole('combobox', { name: 'Filter notes' }),
  ).toBeHidden();
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
  await expect(page.locator('.count')).toHaveText('1 of 2');
  await page
    .getByRole('combobox', { name: 'Filter notes' })
    .selectOption('all');
  await page.getByRole('searchbox', { name: 'Search notes' }).fill('source');
  await expect(page.locator('.card')).toHaveCount(1);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Prepare handoff' }).click();
  await page.getByRole('button', { name: 'Select all', exact: true }).click();
  await page.getByRole('button', { name: 'Save ZIP file' }).click();
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
  await expect(page.locator('.count')).toHaveText('0 of 2');
  await page
    .getByRole('button', { name: 'Clear filters', exact: true })
    .click();
  await expect(page.locator('.card')).toHaveCount(2);
  await expect(
    page.getByRole('searchbox', { name: 'Search notes' }),
  ).toBeFocused();
  await page.screenshot({ path: info.outputPath('notes-workspace.png') });
  const first = page.locator('.card').first();
  await expect(
    first.getByRole('button', { name: 'Delete', exact: true }),
  ).toBeHidden();
  await first.locator('summary').click();
  await expect(first.locator('.image-state')).toHaveText('Screenshot attached');
  const priority = first.getByRole('combobox', { name: 'Priority for note 1' });
  await priority.focus();
  await priority.selectOption('later');
  await expect(priority).toBeFocused();
  await expect(priority).toHaveValue('later');
  await expect(first.locator('details')).toHaveAttribute('open', '');
  const cardWidth = (await first.boundingBox())!.width;
  expect((await first.locator('details').boundingBox())!.width).toBeGreaterThan(
    cardWidth - 5,
  );
  await first.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.locator('.card')).toHaveCount(2);
  await first
    .getByRole('button', { name: 'Confirm delete', exact: true })
    .click();
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(page.locator('.comment')).toHaveText('Label the chart axes.');
});

test('hands-free recording toggles and stops when leaving the workspace', async () => {
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/report.html');
  await activate(page);
  await select(page, '#evidence-claim');
  const speech = await simulateSpeech(page);
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
  await speech.close();
});

for (const gesture of ['button', 'middle'] as const) {
  test(`${gesture} hold waits for audio, animates waves, and keeps the final transcript`, async ({}, info) => {
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:4173/report.html');
    await activate(page);
    await select(page, '#evidence-claim');
    const speech = await simulateSpeech(page);
    await speech.evaluate('speechDelayAudio = true; speechOnRelease = true');
    const mouseButton = gesture === 'middle' ? 'middle' : 'left';
    if (gesture === 'button') {
      const box = (await page
        .getByRole('button', { name: 'Hold to talk', exact: true })
        .boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    } else await page.mouse.move(100, 160);
    await page.mouse.down({ button: mouseButton });
    await expect(page.locator('.voice-slot')).toHaveAttribute(
      'data-voice-phase',
      'starting',
    );
    await expect(page.locator('.voice-activity-state')).toHaveText('Starting…');
    await expect
      .poll(async () => (await speech.evaluate('speechStarts')).result.value)
      .toBe(1);
    await speech.evaluate('activeSpeech.onaudiostart()');
    await expect(page.locator('.voice-slot')).toHaveAttribute(
      'data-voice-phase',
      'listening',
    );
    await expect(page.locator('.voice-wave')).toHaveCount(1);
    await expect(page.locator('.recording-toast')).toHaveCount(0);
    const wave = page.locator('.voice-wave');
    const curve = wave.locator('.wave-front');
    await expect(wave).toHaveAttribute('data-motion', 'still');
    await speech.evaluate('activeSpeech.onspeechstart()');
    await expect(wave).toHaveAttribute('data-motion', 'running');
    const firstShape = await curve.getAttribute('d');
    await expect.poll(() => curve.getAttribute('d')).not.toBe(firstShape);
    await expect(wave.locator('path')).toHaveCount(4);
    await page.screenshot({ path: info.outputPath('voice-wave.png') });
    await page
      .locator('.panel')
      .screenshot({ path: info.outputPath('voice-panel.png') });
    await speech.evaluate('activeSpeech.onspeechend()');
    await expect(wave).toHaveAttribute('data-motion', 'still');
    await speech.evaluate('activeSpeech.onspeechstart()');
    await expect(wave).toHaveAttribute('data-motion', 'running');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(wave).toHaveAttribute('data-motion', 'still');
    expect(
      await curve.evaluate(async (el) => {
        const shape = el.getAttribute('d');
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        return el.getAttribute('d') === shape;
      }),
    ).toBe(true);
    await page.setViewportSize({ width: 320, height: 640 });
    const activity = page.locator('.voice-activity');
    expect(
      await activity.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath('compact-voice.png') });
    await page.mouse.up({ button: mouseButton });
    await expect(page.locator('.voice-slot')).toHaveAttribute(
      'data-voice-phase',
      'finishing',
    );
    await expect(
      page.getByRole('textbox', { name: 'Your feedback' }),
    ).toHaveValue('Final words from the microphone.');
    await expect(page.getByRole('button', { name: 'Save note' })).toBeEnabled();
    await expect(page.locator('.voice-activity')).toBeHidden();
    await speech.close();
  });
}

test('voice setup explains recovery when an older background rejects the request', async () => {
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/report.html');
  await activate(page);
  const cdp = await context.newCDPSession(page);
  const worlds: { id: number; origin: string }[] = [];
  cdp.on('Runtime.executionContextCreated', ({ context: world }) =>
    worlds.push(world),
  );
  await cdp.send('Runtime.enable');
  const world = worlds.find((w) => w.origin.startsWith('chrome-extension://'))!;
  // Reproduce the reply from a pre-voice worker left running after a rebuild.
  await cdp.send('Runtime.evaluate', {
    contextId: world.id,
    expression: `
      globalThis.originalVoiceSendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = (message, ...args) =>
        message?.target === 'pointnote-voice'
          ? Promise.resolve({ ok: false, error: 'Unknown request.' })
          : originalVoiceSendMessage(message, ...args);
    `,
  });
  await page.getByRole('button', { name: 'Set up voice', exact: true }).click();
  await expect(page.getByRole('status')).toContainText(
    'click Reload on Pointnote',
  );
  await expect(page.getByRole('status')).toContainText('refresh this page');
  await expect(page.getByRole('status')).not.toContainText('Unknown request');
  expect(
    context.pages().some((p) => p.url().endsWith('/voice-setup.html')),
  ).toBe(false);
  await expect(page.locator('.voice-onboarding')).toBeVisible();
  await expect(page.locator('.voice-activity')).toBeHidden();

  // A successful retry must still open setup; failure must not mark it complete.
  await cdp.send('Runtime.evaluate', {
    contextId: world.id,
    expression: 'chrome.runtime.sendMessage = originalVoiceSendMessage;',
  });
  const newPage = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Set up voice', exact: true }).click();
  const setup = await newPage;
  await setup.waitForLoadState();
  expect(setup.url()).toContain('/voice-setup.html');
  await expect(
    setup.getByRole('button', { name: 'Enable microphone', exact: true }),
  ).toBeVisible();
  await cdp.detach();
});

test('voice onboarding saves extension permission and stays complete across page origins', async () => {
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/report.html');
  await activate(page);
  await expect(
    page.getByRole('button', { name: 'Set up voice', exact: true }),
  ).toBeVisible();
  const newPage = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Set up voice', exact: true }).click();
  const setup = await newPage;
  await setup.waitForLoadState();
  expect(setup.url()).toContain('chrome-extension://');
  await setup.evaluate(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      (window as unknown as { setupTracks: MediaStreamTrack[] }).setupTracks =
        stream.getTracks();
      return stream;
    };
  });
  await setup
    .getByRole('button', { name: 'Enable microphone', exact: true })
    .click();
  await expect(setup.getByRole('status')).toContainText('Microphone ready');
  expect(
    await setup.evaluate(() =>
      (
        window as unknown as { setupTracks: MediaStreamTrack[] }
      ).setupTracks.every((track) => track.readyState === 'ended'),
    ),
  ).toBe(true);
  await setup.getByRole('button', { name: 'Return to your page' }).click();
  await expect(page.locator('.voice-onboarding')).toBeHidden();
  await page.reload();
  await expect(page.locator('.voice-onboarding')).toBeHidden();
  const other = await context.newPage();
  await other.goto('http://localhost:4173/frontend.html');
  await activate(other);
  await expect(other.locator('.voice-onboarding')).toBeHidden();
  const speech = await simulateSpeech(other);
  expect((await speech.evaluate('location.protocol')).result.value).toBe(
    'chrome-extension:',
  );
  await speech.close();
});

test('voice shortcut and browser consent persist while keyboard typing stays normal', async ({}, info) => {
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/report.html');
  await activate(page);
  const speech = await simulateSpeech(page);
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page
    .getByRole('combobox', { name: 'Voice shortcut', exact: true })
    .selectOption('backtick');
  await page
    .getByRole('combobox', { name: 'Transcription provider' })
    .selectOption('browser');
  const consent = page.getByRole('checkbox', {
    name: /I allow the browser speech service/,
  });
  await consent.check();
  await page.reload();
  await expect(
    page.getByRole('complementary', { name: 'Pointnote review' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await expect(consent).toBeChecked();
  await expect(
    page.getByRole('combobox', { name: 'Voice shortcut', exact: true }),
  ).toHaveValue('backtick');
  await page.getByRole('button', { name: 'Back to notes' }).click();
  await select(page, '#evidence-claim');
  await page.keyboard.down('`');
  await expect(page.locator('.voice-slot')).toHaveAttribute(
    'data-voice-phase',
    'listening',
  );
  await page.keyboard.up('`');
  const feedback = page.getByRole('textbox', { name: 'Your feedback' });
  await expect(feedback).toBeEnabled();
  await feedback.fill('Typed ');
  await page.keyboard.type('`');
  await expect(feedback).toHaveValue('Typed `');
  expect((await speech.evaluate('speechStarts')).result.value).toBe(1);
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: /Record shortcut/ }).click();
  await page.keyboard.press('Control+Alt+v');
  await expect(
    page.getByRole('button', { name: /Record shortcut/ }),
  ).toContainText('Ctrl + Alt + V');
  await page
    .locator('.panel')
    .screenshot({ path: info.outputPath('voice-settings.png') });
  await page.reload();
  await expect(
    page.getByRole('complementary', { name: 'Pointnote review' }),
  ).toBeVisible();
  await select(page, '#evidence-claim');
  await page.keyboard.down('Control');
  await page.keyboard.down('Alt');
  await page.keyboard.down('v');
  await expect(page.locator('.voice-slot')).toHaveAttribute(
    'data-voice-phase',
    'listening',
  );
  await page.keyboard.up('v');
  await page.keyboard.up('Alt');
  await page.keyboard.up('Control');
  await expect(feedback).toBeEnabled();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await consent.uncheck();
  await page.reload();
  await expect(
    page.getByRole('complementary', { name: 'Pointnote review' }),
  ).toBeVisible();
  await select(page, '#evidence-claim');
  await page
    .getByRole('button', { name: 'Start hands-free recording' })
    .click();
  await expect(page.getByRole('status')).toContainText(
    'allow browser audio processing',
  );
  expect((await speech.evaluate('speechStarts')).result.value).toBe(2);
  await speech.close();
});

test('offscreen recording releases its owner on reload and stops on consent revocation', async () => {
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/report.html');
  await activate(page);
  const speech = await simulateSpeech(page);
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page
    .getByRole('combobox', { name: 'Transcription provider' })
    .selectOption('browser');
  await page
    .getByRole('checkbox', { name: /I allow the browser speech service/ })
    .check();
  await page.getByRole('button', { name: 'Back to notes' }).click();
  await select(page, '#evidence-claim');
  await page
    .getByRole('button', { name: 'Start hands-free recording' })
    .click();
  await expect(page.locator('.voice-slot')).toHaveAttribute(
    'data-voice-phase',
    'listening',
  );
  await page.reload();
  await expect(
    page.getByRole('complementary', { name: 'Pointnote review' }),
  ).toBeVisible();
  await select(page, '#evidence-claim');
  await page
    .getByRole('button', { name: 'Start hands-free recording' })
    .click();
  await expect(page.locator('.voice-slot')).toHaveAttribute(
    'data-voice-phase',
    'listening',
  );
  expect((await speech.evaluate('speechStarts')).result.value).toBe(2);
  await context.serviceWorkers()[0].evaluate(async () => {
    const { preferences } = await chrome.storage.local.get('preferences');
    await chrome.storage.local.set({
      preferences: { ...(preferences as object), browserConsent: false },
    });
  });
  await expect(page.getByRole('status')).toContainText('consent was revoked');
  await expect(page.locator('.voice-slot')).toHaveAttribute(
    'data-voice-phase',
    'idle',
  );
  await speech.close();
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
  await expect(page.locator('.voice-activity')).toBeVisible();
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
  await expect(page.locator('.voice-activity')).toBeHidden();
  await expect(page.locator('.card')).toHaveCount(0);
  await page.mouse.down({ button: 'middle' });
  await expect(feedback).toHaveValue(
    'My written context.\nAdd supporting evidence.\nAdd supporting evidence.',
  );
  await page.mouse.up({ button: 'middle' });
  await save(page, 'Please cite the study supporting this claim.', 1);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Prepare handoff' }).click();
  await page.getByRole('button', { name: 'Save ZIP file' }).click();
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
  await expect(page.locator('.voice-activity')).toBeVisible();
  await expect(page.locator('.voice-slot')).toHaveAttribute(
    'data-voice-phase',
    'listening',
  );
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
  await expect
    .poll(
      async () => (await speech.evaluate('typeof resolveSpeech')).result.value,
    )
    .toBe('function');
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
    await expect(page.locator('.voice-activity')).toBeVisible();
    if (action === 'escape') await page.keyboard.press('Escape');
    else if (action === 'blur')
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    else await page.locator(`[data-action="${action}"]`).click();
    await page.mouse.up({ button: 'middle' });
    await expect(page.locator('.voice-activity')).toBeHidden();
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

test('switching targets autosaves exact drafts and keeps selection refinements together', async () => {
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/report.html');
  await activate(page);
  const draft = page.getByRole('textbox', { name: 'Your feedback' });
  await select(page, '#evidence-claim');
  const words = '  Keep these exact words.\nAdd the source.  ';
  await draft.fill(words);
  await select(page, '#retention-chart');
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(page.locator('.card .comment')).toHaveText(words);
  await expect(page.locator('.target-name')).toContainText('retention-chart');
  await expect(draft).toHaveValue('');
  await draft.fill('Label the comparison.');
  await page
    .getByRole('button', { name: 'Locate note 1', exact: true })
    .click();
  await expect(page.locator('.card')).toHaveCount(2);
  await expect(page.locator('.target-name')).toContainText('evidence-claim');
  await expect(draft).toHaveValue('');
  await select(page, '#retention-chart');
  await expect(page.locator('.card')).toHaveCount(2);
  await page.getByRole('button', { name: 'Multiple', exact: true }).click();
  await select(page, '#evidence-claim');
  await draft.fill('Compare these together.');
  await select(page, '#retention-chart');
  await expect(page.locator('.card')).toHaveCount(2);
  await expect(draft).toHaveValue('Compare these together.');
  await page.getByRole('button', { name: 'Text range', exact: true }).click();
  await expect(page.locator('.card')).toHaveCount(3);
  await expect(draft).toHaveValue('');
  await page.reload();
  await expect(page.locator('.card')).toHaveCount(3);
  await expect(page.locator('.card .comment').first()).toHaveText(words);
});

test('switching during recording waits for final words and saves to the original target once', async ({}, info) => {
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/report.html');
  await activate(page);
  const speech = await simulateSpeech(page);
  await speech.evaluate('speechOnRelease = true');
  await select(page, '#evidence-claim');
  const draft = page.getByRole('textbox', { name: 'Your feedback' });
  await draft.fill('Written context.');
  const composerHeight = (await page.locator('.composer').boundingBox())!
    .height;
  await page
    .getByRole('button', { name: 'Start hands-free recording' })
    .click();
  await expect(page.locator('.voice-slot')).toHaveAttribute(
    'data-voice-phase',
    'listening',
  );
  expect((await page.locator('.composer').boundingBox())!.height).toBe(
    composerHeight,
  );
  expect(
    (await page.locator('.voice-activity').boundingBox())!.height,
  ).toBeLessThanOrEqual(28);
  await page
    .locator('.panel')
    .screenshot({ path: info.outputPath('compact-recording.png') });
  await select(page, '#retention-chart');
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(page.locator('.card .comment')).toHaveText(
    'Written context.\nFinal words from the microphone.',
  );
  await expect(page.locator('.target-name')).toContainText('retention-chart');
  await expect(draft).toHaveValue('');
  await draft.fill('A separate typed note.');
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(page.locator('.card')).toHaveCount(2);
  await page
    .getByRole('button', { name: 'Locate note 1', exact: true })
    .click();
  await expect(page.locator('.target-name')).toContainText('evidence-claim');
  await page
    .locator('.panel')
    .screenshot({ path: info.outputPath('compact-notes.png') });
  await speech.close();
});

async function inContentWorld(page: Page, expression: string) {
  const cdp = await context.newCDPSession(page);
  const worlds: { id: number; origin: string }[] = [];
  cdp.on('Runtime.executionContextCreated', ({ context: world }) =>
    worlds.push(world),
  );
  await cdp.send('Runtime.enable');
  const world = worlds.find((w) => w.origin.startsWith('chrome-extension://'))!;
  const result = await cdp.send('Runtime.evaluate', {
    contextId: world.id,
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  await cdp.detach();
  expect(result.exceptionDetails).toBeUndefined();
  return result.result.value;
}

test('failed autosave preserves the draft and target, and retry saves only once', async () => {
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/report.html');
  await activate(page);
  await select(page, '#evidence-claim');
  const draft = page.getByRole('textbox', { name: 'Your feedback' });
  await draft.fill('Do not lose this draft.');
  await inContentWorld(
    page,
    `
    globalThis.originalSendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (message, ...args) => message.type === 'PUT'
      ? Promise.resolve({ ok: false, error: 'Simulated storage failure.' })
      : globalThis.originalSendMessage(message, ...args);
  `,
  );
  await select(page, '#retention-chart');
  await expect(page.getByRole('status')).toContainText(
    'Your draft and target have been kept',
  );
  await expect(draft).toHaveValue('Do not lose this draft.');
  await expect(page.locator('.target-name')).toContainText('evidence-claim');
  await expect(page.locator('.card')).toHaveCount(0);
  await inContentWorld(
    page,
    'chrome.runtime.sendMessage = globalThis.originalSendMessage',
  );
  await select(page, '#retention-chart');
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(draft).toHaveValue('');
  await expect(page.locator('.target-name')).toContainText('retention-chart');
});

test('export offers clipboard, standalone Markdown and ZIP, including the unsaved last note', async ({}, info) => {
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/frontend.html');
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: 'http://127.0.0.1:4173',
  });
  await activate(page);
  const exportButton = page.getByRole('button', { name: 'Prepare handoff' });
  await expect(exportButton).toBeDisabled();
  await select(page, 'textarea[aria-label="Private draft"]');
  const words = '  Keep café and 🎯.\n```code\nExplain this field.  ';
  await page.getByRole('textbox', { name: 'Your feedback' }).fill(words);
  await exportButton.click();
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(page.locator('.handoff-count')).toHaveText(
    '1 change selected · 1 page',
  );
  await expect(
    page.getByRole('heading', { name: 'Prepare handoff' }),
  ).toBeFocused();
  await page
    .locator('.panel')
    .screenshot({ path: info.outputPath('export-menu.png') });
  await page.keyboard.press('Escape');
  await expect(page.locator('.review-page')).toBeHidden();
  await expect(exportButton).toBeFocused();
  await exportButton.click();
  await page
    .getByRole('button', { name: 'Copy Markdown to clipboard' })
    .click();
  await expect(page.getByRole('status')).toContainText('Markdown copied');
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard.replaceAll('\r\n', '\n')).toContain(words);
  expect(clipboard).not.toMatch(
    /screenshot|!\[|data:image|feedback\.json|Viewport:|Exported:|Created:/i,
  );
  await exportButton.click();
  const markdownDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save Markdown file' }).click();
  const markdownFile = await markdownDownload;
  expect(markdownFile.suggestedFilename()).toMatch(/\.md$/);
  const markdown = await readFile((await markdownFile.path())!, 'utf8');
  expect(markdown).toContain(words);
  expect(markdown).not.toMatch(
    /screenshot|!\[|data:image|feedback\.json|Viewport:|Exported:|Created:/i,
  );
  expect(markdown).not.toContain('PRIVATE-DRAFT-789');
  await exportButton.click();
  const zipDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save ZIP file' }).click();
  const zipFile = await zipDownload;
  expect(zipFile.suggestedFilename()).toMatch(/\.zip$/);
  const files = unzipSync(
    new Uint8Array(await readFile((await zipFile.path())!)),
  );
  const data = JSON.parse(strFromU8(files['feedback.json']));
  expect(data.annotations).toHaveLength(1);
  expect(data.annotations[0].originalComment).toBe(words);
  expect(data.annotations[0].screenshot.status).toBe('available');
  expect(files[data.annotations[0].screenshot.path]).toBeDefined();
  expect(strFromU8(files['feedback.md'])).toContain('![Target in context]');
});

test('clipboard denial offers Markdown download without claiming success or losing notes', async () => {
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/report.html');
  await activate(page);
  await select(page, '#evidence-claim');
  await page
    .getByRole('textbox', { name: 'Your feedback' })
    .fill('Use the source.');
  await page.getByRole('button', { name: 'Prepare handoff' }).click();
  await inContentWorld(
    page,
    `
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('Denied')) } });
    document.execCommand = () => false;
  `,
  );
  await page
    .getByRole('button', { name: 'Copy Markdown to clipboard' })
    .click();
  await expect(page.getByRole('status')).toContainText(
    'Choose Save Markdown file instead',
  );
  await expect(page.locator('.card')).toHaveCount(1);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save Markdown file' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.md$/);
});

test('clipboard fallback copies Markdown when the page has no Clipboard API', async () => {
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/report.html');
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: 'http://127.0.0.1:4173',
  });
  await activate(page);
  await select(page, '#evidence-claim');
  await page
    .getByRole('textbox', { name: 'Your feedback' })
    .fill('Copy through the fallback.');
  await page.getByRole('button', { name: 'Prepare handoff' }).click();
  await inContentWorld(
    page,
    "Object.defineProperty(navigator, 'clipboard', { value: undefined })",
  );
  await page
    .getByRole('button', { name: 'Copy Markdown to clipboard' })
    .click();
  await expect(page.getByRole('status')).toContainText('Markdown copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    'Copy through the fallback.',
  );
  await expect(
    page.getByRole('button', { name: 'Prepare handoff' }),
  ).toBeFocused();
});

test('clear all notes confirms page scope, preserves drafts, and recovers from failure', async ({}, info) => {
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/report.html');
  await activate(page);
  const clearAll = page.getByRole('button', {
    name: 'Clear all notes for this page',
  });
  await expect(clearAll).toBeDisabled();
  await select(page, '#evidence-claim');
  await save(page, 'Add a source.', 1);
  await select(page, '#retention-chart');
  await save(page, 'Label this chart.', 2);
  const other = await context.newPage();
  await other.goto('http://127.0.0.1:4173/frontend.html');
  await activate(other);
  await select(other, '#complete-task');
  await save(other, 'Keep this other page note.', 1);
  await page.bringToFront();
  await select(page, '#evidence-claim');
  const draft = page.getByRole('textbox', { name: 'Your feedback' });
  await draft.fill('Keep my unsaved draft.');
  await page.getByRole('searchbox', { name: 'Search notes' }).fill('chart');
  await expect(page.locator('.card')).toHaveCount(1);
  await clearAll.click();
  await expect(
    page.getByRole('group', { name: 'Clear page notes', exact: true }),
  ).toContainText('all 2 saved notes on this page');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(draft).toHaveValue('Keep my unsaved draft.');
  await clearAll.click();
  await page
    .locator('.panel')
    .screenshot({ path: info.outputPath('clear-page.png') });
  await inContentWorld(
    page,
    `
    globalThis.originalSendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (message, ...args) => message.type === 'DELETE_PAGE'
      ? Promise.resolve({ ok: false, error: 'Simulated delete failure.' })
      : globalThis.originalSendMessage(message, ...args);
  `,
  );
  await page.getByRole('button', { name: 'Delete notes', exact: true }).click();
  await expect(page.getByRole('status')).toContainText(
    'Simulated delete failure',
  );
  await expect(page.locator('.count')).toHaveText('1 of 2');
  await expect(draft).toHaveValue('Keep my unsaved draft.');
  await inContentWorld(
    page,
    'chrome.runtime.sendMessage = globalThis.originalSendMessage',
  );
  await page.getByRole('button', { name: 'Delete notes', exact: true }).click();
  await expect(page.locator('.card')).toHaveCount(0);
  await expect(page.locator('.marker')).toHaveCount(0);
  await expect(clearAll).toBeDisabled();
  await expect(draft).toHaveValue('Keep my unsaved draft.');
  await page.reload();
  await expect(page.locator('.count')).toHaveText('0');
  await other.bringToFront();
  await other.reload();
  await expect(other.locator('.card')).toHaveCount(1);
  await expect(other.locator('.comment')).toHaveText(
    'Keep this other page note.',
  );
});

test('Parent refines a written draft without submitting the compact composer', async () => {
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/report.html');
  await activate(page);
  await select(page, '#recommendation-cards article:first-child');
  const draft = page.getByRole('textbox', { name: 'Your feedback' });
  await draft.fill('Simplify these cards together.');
  await page.getByRole('button', { name: '↑ Parent' }).click();
  await expect(page.locator('.target-name')).toContainText(
    'recommendation-cards',
  );
  await expect(draft).toHaveValue('Simplify these cards together.');
  await expect(page.locator('.card')).toHaveCount(0);
  await select(page, '#retention-chart');
  await expect(page.locator('.card')).toHaveCount(1);
  await page
    .getByRole('button', { name: 'Locate note 1', exact: true })
    .click();
  await expect(page.locator('.target-name')).toContainText(
    'recommendation-cards',
  );
});
