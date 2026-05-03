import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { writeHarnessHtml } from './harness';

const cfg = {
  columns: 3,
  addSerialIndex: true,
  fontSize: 14,
  header: { absRow: 0, cells: ['id', 'name', 'notes'] },
  body: [
    { absRow: 1, cells: ['1', 'Line 1\nLine 2\nLine 3', 'first row'] },
    { absRow: 2, cells: ['2', 'single line', 'second row'] },
  ],
};

test('row-height modes render multiline cells and save review screenshots', async ({ page }) => {
  const { url, dir } = writeHarnessHtml({ ...cfg, rowHeightMode: 'compact' as const });
  const screenshotDir = path.resolve(__dirname, 'visual-review', 'row-height');
  fs.rmSync(screenshotDir, { recursive: true, force: true });
  fs.mkdirSync(screenshotDir, { recursive: true });

  try {
    await page.goto(url);
    await expect(page.locator('#csv-root')).toBeVisible();

    const table = page.locator('#csv-root table');
    const cell = page.locator('td[data-row="1"][data-col="1"] .cell-body');
    const btn = page.locator('#csvRowHeightToggle');

    await table.screenshot({ path: path.join(screenshotDir, 'row-height-compact.png') });
    await expect(cell).toContainText('Line 1↵Line 2↵Line 3');

    await btn.click(); // compact -> wrap
    await expect(btn).toHaveAttribute('data-mode', 'wrap');
    await table.screenshot({ path: path.join(screenshotDir, 'row-height-wrap.png') });
    const wrapHeight = await cell.evaluate(el => el.getBoundingClientRect().height);
    await expect(cell).toContainText('Line 1\nLine 2\nLine 3');

    const compactHeight = await page.locator('td[data-row="2"][data-col="1"] .cell-body').evaluate(el => el.getBoundingClientRect().height);
    expect(compactHeight).toBeLessThan(wrapHeight);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
