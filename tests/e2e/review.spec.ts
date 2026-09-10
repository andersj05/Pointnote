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
  await page.getByRole('button', { name: 'Pause selection' }).click();
  await page.locator('#route-change').click();
  await expect(page.locator('.card')).toHaveCount(0);
  await page.goBack();
  await expect(page.locator('.card')).toHaveCount(2);
  await page.getByRole('button', { name: 'Close Pointnote' }).click();
  await page.locator('#complete-task').click();
  await expect(page.locator('#project-status')).toHaveText('2 task completed');
});
