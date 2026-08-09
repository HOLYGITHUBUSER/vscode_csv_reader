/** Real-browser coverage for the header sort menu. */
import { test, expect, type Page } from '@playwright/test';
import fs from 'fs';
import { writeHarnessHtml } from './harness-脚手架';

const cfg = {
  columns: 3, addSerialIndex: true, fontSize: 14, rowHeightMode: 'compact' as const,
  header: { absRow: 0, cells: ['Name', 'Age', 'City'] },
  body: [{ absRow: 1, cells: ['Alice', '30', 'NYC'] }, { absRow: 2, cells: ['Bob', '25', 'LA'] }],
};
let harnessDir: string;
test.afterAll(() => { if (harnessDir) try { fs.rmSync(harnessDir, { recursive: true, force: true }); } catch {} });

async function chooseSort(page: Page, col: number, action: 'sort-asc' | 'sort-desc' | 'sort-reset') {
  await page.locator(`th[data-col="${col}"] .sort-btn`).click();
  await expect(page.locator('#csvHeaderActionMenu[data-menu-kind="sort"]')).toBeVisible();
  await page.locator(`[data-header-action="${action}"]`).click();
}

test('header sort menu sends ascending, descending, and reset messages', async ({ page }) => {
  const { url, dir } = writeHarnessHtml(cfg); harnessDir = dir;
  await page.goto(url);
  await expect(page.locator('#csv-root')).toBeVisible();

  await chooseSort(page, 0, 'sort-asc');
  await expect(page.locator('th[data-col="0"]')).toHaveClass(/sort-asc/);
  await chooseSort(page, 0, 'sort-desc');
  await expect(page.locator('th[data-col="0"]')).toHaveClass(/sort-desc/);
  await chooseSort(page, 0, 'sort-reset');
  await expect(page.locator('th[data-col="0"]')).not.toHaveClass(/sort-asc|sort-desc/);

  const posted = await page.evaluate(() => (window as any).__posted as any[]);
  expect(posted).toEqual([
    { type: 'sortColumn', index: 0, ascending: true },
    { type: 'sortColumn', index: 0, ascending: false },
    { type: 'resetSort' },
  ]);
});
