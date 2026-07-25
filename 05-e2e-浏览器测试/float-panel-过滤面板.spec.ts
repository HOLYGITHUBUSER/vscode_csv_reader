/**
 * E2E for the right-bottom floating panel (#csvFloatPanel): column filters
 * + row-height cycle button + clear-filter button.
 *
 * Runs real Chromium clicks / keyboard input against the real 02-webview-表格界面/webview-main.js.
 * Expected contract (matches CsvEditorProvider's message handler):
 *   - adding a column condition → postMessage type:'filterSort'
 *   - clicking #csvRowHeightToggle → postMessage type:'setRowHeightMode',
 *     cycling data-mode: compact → wrap → compact
 *   - clearing column conditions fires another filterSort with no columnFilters
 */
import { test, expect } from '@playwright/test';
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
    { absRow: 2, cells: ['Bob',   '25', 'LA']  },
    { absRow: 3, cells: ['Cindy', '28', 'SF']  },
  ],
};

let harnessDir: string;
const chooseColumn = async (page: any, query: string) => {
  const input = page.locator('#csvColumnFilterColumn');
  await input.click();
  await input.fill(query);
  await input.press('Enter');
};
test.afterAll(() => {
  if (harnessDir) try { fs.rmSync(harnessDir, { recursive: true, force: true }); } catch {}
});

test('floating panel: column filter builder is visible and fires filterSort', async ({ page }) => {
  const { url, dir } = writeHarnessHtml(cfg);
  harnessDir = dir;

  const pageErrors: string[] = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') pageErrors.push(`[console.error] ${m.text()}`); });

  await page.goto(url);
  await expect(page.locator('#csv-root')).toBeVisible();
  expect(pageErrors).toEqual([]);

  await page.screenshot({
    path: '05-e2e-浏览器测试/test-results/float-panel-initial.png',
    fullPage: true,
  });

  await expect(page.locator('#csvGlobalSearch')).toBeVisible();
  await expect(page.locator('#csvColumnFilterColumn')).toBeVisible();
  await expect(page.locator('#csvColumnFilterValue')).toBeVisible();

  await chooseColumn(page, 'Name');
  await page.locator('#csvColumnFilterValue').fill('Alice');
  await page.locator('#csvColumnFilterAdd').click();

  const posted = await page.evaluate(() => (window as any).__posted as any[]);
  const filterMsgs = posted.filter(m => m && m.type === 'filterSort');
  expect(
    filterMsgs.length,
    `Expected adding a column condition to emit filterSort; got messages: ${JSON.stringify(posted)}`,
  ).toBeGreaterThan(0);

  const last = filterMsgs[filterMsgs.length - 1];
  expect(last.globalSearch).toBe('');
  expect(last.columnFilters).toEqual({
    '0': { value: 'Alice', mode: 'contains', ignoreCase: true, ignoreWhitespace: false },
  });
});

test('floating panel: searchable column picker shows matching candidates', async ({ page }) => {
  const { url, dir } = writeHarnessHtml(cfg);
  harnessDir = dir;

  await page.goto(url);
  await expect(page.locator('#csv-root')).toBeVisible();

  const input = page.locator('#csvColumnFilterColumn');
  await input.click();
  await input.fill('zz');
  await expect(page.locator('#csvColumnFilterOptions .csv-column-option')).toHaveText('无匹配列');

  await input.fill('na');
  const nameOption = page.locator('#csvColumnFilterOptions .csv-column-option').filter({ hasText: '1. Name' });
  await expect(nameOption).toBeVisible();

  await input.fill('ci');

  const option = page.locator('#csvColumnFilterOptions .csv-column-option').filter({ hasText: '3. City' });
  await expect(option).toBeVisible();
  await option.click();
  await expect(input).toHaveAttribute('data-selected-col', '2');
  await expect(input).toHaveValue('3. City');
});

test('floating panel: row-height toggle cycles compact → wrap', async ({ page }) => {
  const { url, dir } = writeHarnessHtml({ ...cfg, rowHeightMode: 'compact' });
  harnessDir = dir;

  const pageErrors: string[] = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') pageErrors.push(`[console.error] ${m.text()}`); });

  await page.goto(url);
  await expect(page.locator('#csv-root')).toBeVisible();
  expect(pageErrors).toEqual([]);

  const btn = page.locator('#csvRowHeightToggle');
  await expect(btn).toBeVisible();
  await expect(btn).toHaveAttribute('data-mode', 'compact');

  // Click 1: compact → wrap
  await btn.click();
  await expect(btn).toHaveAttribute('data-mode', 'wrap');

  // Click 2: wrap → compact (full cycle)
  await btn.click();
  await expect(btn).toHaveAttribute('data-mode', 'compact');

  // Each click should have emitted a setRowHeightMode message with the new mode.
  const posted = await page.evaluate(() => (window as any).__posted as any[]);
  const modeMsgs = posted.filter(m => m && m.type === 'setRowHeightMode');
  expect(modeMsgs.length).toBeGreaterThanOrEqual(2);
  expect(modeMsgs.slice(-2).map(m => m.mode)).toEqual(['wrap', 'compact']);
});

test('floating panel: column filters post combined AND conditions', async ({ page }) => {
  const { url, dir } = writeHarnessHtml(cfg);
  harnessDir = dir;

  await page.goto(url);
  await expect(page.locator('#csv-root')).toBeVisible();

  await chooseColumn(page, 'Age');
  await page.locator('#csvColumnFilterValue').fill('30');
  await page.locator('#csvColumnFilterAdd').click();
  await chooseColumn(page, 'City');
  await page.locator('#csvColumnFilterValue').fill('NYC');
  await page.locator('#csvColumnFilterAdd').click();

  await expect(page.locator('#csvColumnFilterChips .csv-filter-chip')).toHaveCount(2);
  const posted = await page.evaluate(() => (window as any).__posted as any[]);
  const filterMsgs = posted.filter(m => m && m.type === 'filterSort');
  const last = filterMsgs[filterMsgs.length - 1];
  expect(last.globalSearch).toBe('');
  expect(last.columnFilters).toEqual({
    '1': { value: '30', mode: 'contains', ignoreCase: true, ignoreWhitespace: false },
    '2': { value: 'NYC', mode: 'contains', ignoreCase: true, ignoreWhitespace: false },
  });
});

test('floating panel: column filter options post match flags', async ({ page }) => {
  const { url, dir } = writeHarnessHtml(cfg);
  harnessDir = dir;

  await page.goto(url);
  await expect(page.locator('#csv-root')).toBeVisible();

  await chooseColumn(page, 'City');
  await page.locator('#csvColumnFilterMode').selectOption('equals');
  await page.locator('#csvColumnFilterIgnoreCase').uncheck();
  await page.locator('#csvColumnFilterIgnoreWhitespace').check();
  await page.locator('#csvColumnFilterValue').fill(' NY C ');
  await page.locator('#csvColumnFilterAdd').click();

  const posted = await page.evaluate(() => (window as any).__posted as any[]);
  const filterMsgs = posted.filter(m => m && m.type === 'filterSort');
  const last = filterMsgs[filterMsgs.length - 1];
  expect(last.columnFilters).toEqual({
    '2': { value: 'NY C', mode: 'equals', ignoreCase: false, ignoreWhitespace: true },
  });
});

test('filterSortResult message from host rewrites tbody', async ({ page }) => {
  const { url, dir } = writeHarnessHtml(cfg);
  harnessDir = dir;

  await page.goto(url);
  await expect(page.locator('#csv-root')).toBeVisible();

  // Before: 3 rows (Alice/Bob/Cindy)
  await expect(page.locator('#csv-root tbody tr')).toHaveCount(3);

  // Simulate host posting a filtered result with only one row.
  await page.evaluate(() => {
    const msg = {
      type: 'filterSortResult',
      addSerialIndex: true,
      sortCol: -1,
      sortDir: null,
      rows: [
        {
          absRow: 1,
          displayIdx: 1,
          cells: [
            { value: 'Alice', rendered: 'Alice' },
            { value: '30',    rendered: '30' },
            { value: 'NYC',   rendered: 'NYC' },
          ],
        },
      ],
    };
    window.postMessage(msg, '*');
  });

  await expect(page.locator('#csv-root tbody tr')).toHaveCount(1);
  await expect(page.locator('#csv-root tbody td[data-col="0"]').first()).toContainText('Alice');
  // Sort indicator cleared.
  await expect(page.locator('th[data-col="0"]')).not.toHaveClass(/sort-asc/);
  await expect(page.locator('th[data-col="0"]')).not.toHaveClass(/sort-desc/);
});

test('floating panel: global search input fires filterSort with globalSearch field', async ({ page }) => {
  const { url, dir } = writeHarnessHtml(cfg);
  harnessDir = dir;

  const pageErrors: string[] = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') pageErrors.push(`[console.error] ${m.text()}`); });

  await page.goto(url);
  await expect(page.locator('#csv-root')).toBeVisible();
  expect(pageErrors).toEqual([]);

  // Global search input is visible and initially empty
  const globalInput = page.locator('#csvGlobalSearch');
  await expect(globalInput).toBeVisible();
  await expect(globalInput).toHaveValue('');

  // Type a search term and press Enter
  await globalInput.fill('Alice');
  await globalInput.press('Enter');

  const posted = await page.evaluate(() => (window as any).__posted as any[]);
  const filterMsgs = posted.filter(m => m && m.type === 'filterSort');
  expect(
    filterMsgs.length,
    `Expected global search to emit filterSort; got: ${JSON.stringify(posted)}`,
  ).toBeGreaterThan(0);

  const last = filterMsgs[filterMsgs.length - 1];
  expect(last.globalSearch).toBe('Alice');
  expect(last.columnFilters).toEqual({});
});

test('floating panel: global search AND column filter together', async ({ page }) => {
  const { url, dir } = writeHarnessHtml(cfg);
  harnessDir = dir;

  await page.goto(url);
  await expect(page.locator('#csv-root')).toBeVisible();

  // Add a column filter: Age contains "30"
  await chooseColumn(page, 'Age');
  await page.locator('#csvColumnFilterValue').fill('30');
  await page.locator('#csvColumnFilterAdd').click();

  // Add global search: "NYC"
  const globalInput = page.locator('#csvGlobalSearch');
  await globalInput.fill('NYC');
  await globalInput.press('Enter');

  const posted = await page.evaluate(() => (window as any).__posted as any[]);
  const filterMsgs = posted.filter(m => m && m.type === 'filterSort');
  const last = filterMsgs[filterMsgs.length - 1];
  // Only Alice (row 1) has both Age "30" AND City containing "NYC"
  expect(last.globalSearch).toBe('NYC');
  expect(last.columnFilters).toEqual({
    '1': { value: '30', mode: 'contains', ignoreCase: true, ignoreWhitespace: false },
  });
});

test('floating panel: filterSortResult with globalSearch restores input value', async ({ page }) => {
  const { url, dir } = writeHarnessHtml(cfg);
  harnessDir = dir;

  await page.goto(url);
  await expect(page.locator('#csv-root')).toBeVisible();

  // Type in global search
  const globalInput = page.locator('#csvGlobalSearch');
  await globalInput.fill('Bob');

  // Simulate host posting filterSortResult with globalSearch preserved
  await page.evaluate(() => {
    const msg = {
      type: 'filterSortResult',
      addSerialIndex: true,
      sortCol: -1,
      sortDir: null,
      rows: [],
      columnFilters: {},
      globalSearch: 'Bob',
    };
    window.postMessage(msg, '*');
  });

  // The global search input should retain the value after filterSortResult
  await expect(globalInput).toHaveValue('Bob');
});

test('floating panel: clear button clears global search but keeps column filters', async ({ page }) => {
  const { url, dir } = writeHarnessHtml(cfg);
  harnessDir = dir;

  await page.goto(url);
  await expect(page.locator('#csv-root')).toBeVisible();

  // Add a column filter
  await chooseColumn(page, 'City');
  await page.locator('#csvColumnFilterValue').fill('NYC');
  await page.locator('#csvColumnFilterAdd').click();

  // Add global search
  const globalInput = page.locator('#csvGlobalSearch');
  await globalInput.fill('Alice');
  await globalInput.press('Enter');

  // csvClearFilter button should now be visible
  const clearBtn = page.locator('#csvClearFilter');
  await expect(clearBtn).toBeVisible();

  // Clear global search
  await clearBtn.click();

  // Global search should be empty
  await expect(globalInput).toHaveValue('');
  // Column filter should still be present
  await expect(page.locator('#csvColumnFilterChips .csv-filter-chip')).toHaveCount(1);

  const posted = await page.evaluate(() => (window as any).__posted as any[]);
  const filterMsgs = posted.filter(m => m && m.type === 'filterSort');
  const last = filterMsgs[filterMsgs.length - 1];
  expect(last.globalSearch).toBe('');
  expect(last.columnFilters).toEqual({
    '2': { value: 'NYC', mode: 'contains', ignoreCase: true, ignoreWhitespace: false },
  });
});

test('floating panel: clear button resets column filters', async ({ page }) => {
  const { url, dir } = writeHarnessHtml(cfg);
  harnessDir = dir;

  await page.goto(url);
  await expect(page.locator('#csv-root')).toBeVisible();

  const input = page.locator('#csvColumnFilterValue');
  const clear = page.locator('#csvColumnFilterClear');

  // Initially hidden.
  await expect(clear).toBeHidden();

  await chooseColumn(page, 'Name');
  await input.fill('Bob');
  await page.locator('#csvColumnFilterAdd').click();
  await expect(clear).toBeVisible();

  await clear.click();
  await expect(page.locator('#csvColumnFilterChips .csv-filter-chip')).toHaveCount(0);
  const posted = await page.evaluate(() => (window as any).__posted as any[]);
  const filterMsgs = posted.filter(m => m && m.type === 'filterSort');
  expect(filterMsgs.length).toBeGreaterThan(0);
  const last = filterMsgs[filterMsgs.length - 1];
  expect(last.globalSearch).toBe('');
  expect(last.columnFilters).toEqual({});
});
