/**
 * Real-browser E2E for the tri-state sort button.
 *
 * Loads the assembled webview HTML into Chromium and drives real
 * `page.click(...)` events, then asserts both:
 *   (a) the sequence of postMessage payloads sent to the extension host
 *   (b) the visual th.sort-asc / sort-desc class applied to the header
 * after 1st/2nd/3rd/4th clicks.
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import { writeHarnessHtml } from './harness';

const cfg = {
  columns: 3,
  addSerialIndex: true,
  fontSize: 14,
  rowHeightMode: 'firstline' as const,
  header: { absRow: 0, cells: ['Name', 'Age', 'City'] },
  body: [
    { absRow: 1, cells: ['Alice', '30', 'NYC'] },
    { absRow: 2, cells: ['Bob',   '25', 'LA']  },
    { absRow: 3, cells: ['Cindy', '28', 'SF']  },
  ],
};

let harnessDir: string;

test.beforeAll(async () => {
  // expose ahead of page.goto so tests can reuse the same HTML
});

test.afterAll(() => {
  if (harnessDir) {
    try { fs.rmSync(harnessDir, { recursive: true, force: true }); } catch {}
  }
});

test('sort-btn tri-state cycle in a real browser', async ({ page }) => {
  const { url, dir } = writeHarnessHtml(cfg);
  harnessDir = dir;

  const pageErrors: string[] = [];
  page.on('pageerror', err => pageErrors.push(err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') pageErrors.push(`[console.error] ${msg.text()}`);
  });

  await page.goto(url);

  // Sanity: page actually booted webview-main.js with zero errors.
  await expect(page.locator('#csv-root')).toBeVisible();
  expect(pageErrors, `webview-main.js threw during init:\n${pageErrors.join('\n')}`).toEqual([]);

  const nameSortBtn = page.locator('th[data-col="0"] .sort-btn');
  await expect(nameSortBtn).toBeVisible();

  // Snapshot of the initial page so humans can eyeball the harness layout.
  await page.screenshot({
    path: 'e2e-浏览器测试/test-results/sort-tri-state-initial.png',
    fullPage: true,
  });

  // ---- click 1: ascending -------------------------------------------------
  await nameSortBtn.click();
  let posted = await page.evaluate(() => (window as any).__posted);
  expect(posted).toHaveLength(1);
  expect(posted[0]).toEqual({ type: 'sortColumn', index: 0, ascending: true });
  await expect(page.locator('th[data-col="0"]')).toHaveClass(/sort-asc/);
  await expect(page.locator('th[data-col="0"]')).not.toHaveClass(/sort-desc/);

  // ---- click 2: descending ------------------------------------------------
  await nameSortBtn.click();
  posted = await page.evaluate(() => (window as any).__posted);
  expect(posted).toHaveLength(2);
  expect(posted[1]).toEqual({ type: 'sortColumn', index: 0, ascending: false });
  await expect(page.locator('th[data-col="0"]')).toHaveClass(/sort-desc/);
  await expect(page.locator('th[data-col="0"]')).not.toHaveClass(/sort-asc/);

  // ---- click 3: restore original → resetSort, no indicator ----------------
  await nameSortBtn.click();
  posted = await page.evaluate(() => (window as any).__posted);
  expect(posted).toHaveLength(3);
  expect(posted[2]).toEqual({ type: 'resetSort' });
  await expect(page.locator('th[data-col="0"]')).not.toHaveClass(/sort-asc/);
  await expect(page.locator('th[data-col="0"]')).not.toHaveClass(/sort-desc/);

  // ---- click 4: wraps back to ascending -----------------------------------
  await nameSortBtn.click();
  posted = await page.evaluate(() => (window as any).__posted);
  expect(posted).toHaveLength(4);
  expect(posted[3]).toEqual({ type: 'sortColumn', index: 0, ascending: true });

  // ---- switching to a different column starts fresh at ascending ----------
  const citySortBtn = page.locator('th[data-col="2"] .sort-btn');
  await citySortBtn.click();
  posted = await page.evaluate(() => (window as any).__posted);
  expect(posted).toHaveLength(5);
  expect(posted[4]).toEqual({ type: 'sortColumn', index: 2, ascending: true });
  await expect(page.locator('th[data-col="2"]')).toHaveClass(/sort-asc/);
  // previous column's indicator cleared
  await expect(page.locator('th[data-col="0"]')).not.toHaveClass(/sort-asc/);
  await expect(page.locator('th[data-col="0"]')).not.toHaveClass(/sort-desc/);

  // ---- clicking the header label (not the button) must NOT sort -----------
  // The sort action must be scoped to .sort-btn — otherwise drag-reorder /
  // selection on the label would be hijacked.
  const lenBefore = (await page.evaluate(() => (window as any).__posted)).length;
  await page.locator('th[data-col="1"] .th-label').click();
  const lenAfter = (await page.evaluate(() => (window as any).__posted)).length;
  const newMsgs = (await page.evaluate(() => (window as any).__posted)).slice(lenBefore, lenAfter);
  for (const m of newMsgs) {
    expect(m.type).not.toBe('sortColumn');
    expect(m.type).not.toBe('resetSort');
  }
});
