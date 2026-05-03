/**
 * E2E for the right-bottom floating panel (#csvFloatPanel): column filters
 * + row-height cycle button + clear-filter button.
 *
 * Runs real Chromium clicks / keyboard input against the real media-媒体/main.js.
 * Expected contract (matches CsvEditorProvider's message handler):
 *   - adding a column condition → postMessage type:'filterSort'
 *   - clicking #csvRowHeightToggle → postMessage type:'setRowHeightMode',
 *     cycling data-mode: compact → wrap → compact
 *   - clearing column conditions fires another filterSort with no columnFilters
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import { writeHarnessHtml } from './harness';

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
    path: 'e2e-端到端/test-results/float-panel-initial.png',
    fullPage: true,
  });

  await expect(page.locator('#csvGlobalSearch')).toHaveCount(0);
  await expect(page.locator('#csvColumnFilterColumn')).toBeVisible();
  await expect(page.locator('#csvColumnFilterValue')).toBeVisible();

  await page.locator('#csvColumnFilterColumn').selectOption('0');
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

  await page.locator('#csvColumnFilterColumn').selectOption('1');
  await page.locator('#csvColumnFilterValue').fill('30');
  await page.locator('#csvColumnFilterAdd').click();
  await page.locator('#csvColumnFilterColumn').selectOption('2');
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

  await page.locator('#csvColumnFilterColumn').selectOption('2');
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

test('floating panel: clear button resets column filters', async ({ page }) => {
  const { url, dir } = writeHarnessHtml(cfg);
  harnessDir = dir;

  await page.goto(url);
  await expect(page.locator('#csv-root')).toBeVisible();

  const input = page.locator('#csvColumnFilterValue');
  const clear = page.locator('#csvColumnFilterClear');

  // Initially hidden.
  await expect(clear).toBeHidden();

  await page.locator('#csvColumnFilterColumn').selectOption('0');
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
