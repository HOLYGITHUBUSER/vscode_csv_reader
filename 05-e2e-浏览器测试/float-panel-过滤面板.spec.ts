/** Real-browser coverage for header filter popovers and the compact footer. */
import { test, expect, type Page } from '@playwright/test';
import fs from 'fs';
import { writeHarnessHtml } from './harness-脚手架';

const cfg = {
  columns: 3,
  addSerialIndex: true,
  fontSize: 14,
  rowHeightMode: 'compact' as const,
  header: { absRow: 0, cells: ['Name', 'Age', 'City'] },
  body: [
    { absRow: 1, cells: ['Alice', '30', 'NYC'] },
    { absRow: 2, cells: ['Bob', '25', 'LA'] },
    { absRow: 3, cells: ['Cindy', '28', 'SF'] },
  ],
};

let harnessDir: string;
test.afterAll(() => { if (harnessDir) try { fs.rmSync(harnessDir, { recursive: true, force: true }); } catch {} });

async function openFilter(page: Page, col: number) {
  await page.locator(`.csv-header-filter-btn[data-col-filter-btn="${col}"]`).click();
  await expect(page.locator('#csvHeaderActionMenu[data-menu-kind="filter"]')).toBeVisible();
}

async function applyFilter(page: Page, col: number, value: string) {
  await openFilter(page, col);
  await page.locator('[data-header-filter-input]').fill(value);
  await page.locator('[data-header-action="filter-apply"]').click();
}

test('header filter button opens an editor and posts a condition', async ({ page }) => {
  const { url, dir } = writeHarnessHtml(cfg); harnessDir = dir;
  await page.goto(url);
  await expect(page.locator('#csv-root')).toBeVisible();
  await expect(page.locator('.csv-header-filter-btn')).toHaveCount(3);

  await applyFilter(page, 0, 'Alice');
  await expect(page.locator('#csvColumnFilterChips .csv-filter-chip')).toHaveCount(1);
  const posted = await page.evaluate(() => (window as any).__posted as any[]);
  expect(posted.at(-1)).toMatchObject({
    type: 'filterSort', globalSearch: '',
    columnFilters: { '0': { value: 'Alice', mode: 'contains', ignoreCase: true, ignoreWhitespace: false } },
  });
});

test('header filters combine conditions and expose active chips', async ({ page }) => {
  const { url, dir } = writeHarnessHtml(cfg); harnessDir = dir;
  await page.goto(url);
  await applyFilter(page, 1, '30');
  await applyFilter(page, 2, 'NYC');
  await expect(page.locator('#csvActiveFilters')).toBeVisible();
  await expect(page.locator('#csvColumnFilterChips .csv-filter-chip')).toHaveCount(2);
  const posted = await page.evaluate(() => (window as any).__posted as any[]);
  expect(posted.at(-1).columnFilters).toEqual({
    '1': { value: '30', mode: 'contains', ignoreCase: true, ignoreWhitespace: false },
    '2': { value: 'NYC', mode: 'contains', ignoreCase: true, ignoreWhitespace: false },
  });
});

test('header filter options are sent with the selected match flags', async ({ page }) => {
  const { url, dir } = writeHarnessHtml(cfg); harnessDir = dir;
  await page.goto(url);
  await openFilter(page, 2);
  await page.locator('[data-header-filter-mode]').selectOption('equals');
  await page.locator('[data-header-filter-ignore-case]').uncheck();
  await page.locator('[data-header-filter-ignore-whitespace]').check();
  await page.locator('[data-header-filter-input]').fill(' NY C ');
  await page.locator('[data-header-action="filter-apply"]').click();
  const posted = await page.evaluate(() => (window as any).__posted as any[]);
  expect(posted.at(-1).columnFilters).toEqual({
    '2': { value: 'NY C', mode: 'equals', ignoreCase: false, ignoreWhitespace: true },
  });
});

test('filter chip removal clears only its own condition', async ({ page }) => {
  const { url, dir } = writeHarnessHtml(cfg); harnessDir = dir;
  await page.goto(url);
  await applyFilter(page, 0, 'Alice');
  await applyFilter(page, 1, '30');
  await page.locator('#csvColumnFilterChips .csv-filter-chip').first().getByRole('button').click();
  await expect(page.locator('#csvColumnFilterChips .csv-filter-chip')).toHaveCount(1);
  const posted = await page.evaluate(() => (window as any).__posted as any[]);
  expect(posted.at(-1).columnFilters).toEqual({
    '1': { value: '30', mode: 'contains', ignoreCase: true, ignoreWhitespace: false },
  });
});

test('filterSortResult from the host rewrites tbody and restores filter chips', async ({ page }) => {
  const { url, dir } = writeHarnessHtml(cfg); harnessDir = dir;
  await page.goto(url);
  await page.evaluate(() => window.postMessage({
    type: 'filterSortResult', addSerialIndex: true, sortCol: -1, sortDir: null,
    columnFilters: { '0': { value: 'Alice', mode: 'contains', ignoreCase: true, ignoreWhitespace: false } },
    rows: [{ absRow: 1, displayIdx: 1, cells: [{ value: 'Alice', rendered: 'Alice' }, { value: '30', rendered: '30' }, { value: 'NYC', rendered: 'NYC' }] }],
  }, '*'));
  await expect(page.locator('#csv-root tbody tr')).toHaveCount(1);
  await expect(page.locator('#csvColumnFilterChips .csv-filter-chip')).toHaveCount(1);
});

test('row-height toggle cycles compact and wrap', async ({ page }) => {
  const { url, dir } = writeHarnessHtml(cfg); harnessDir = dir;
  await page.goto(url);
  const button = page.locator('#csvRowHeightToggle');
  await button.click();
  await expect(button).toHaveAttribute('data-mode', 'wrap');
  await button.click();
  await expect(button).toHaveAttribute('data-mode', 'compact');
  const posted = await page.evaluate(() => (window as any).__posted as any[]);
  expect(posted.filter(message => message.type === 'setRowHeightMode').slice(-2).map(message => message.mode)).toEqual(['wrap', 'compact']);
});
