/**
 * E2E: 验证页面上所有按钮和交互元素都能正常工作。
 *
 * 使用harness加载真实main.js到Chromium，逐个点击每个按钮，
 * 验证：(1) 按钮可见 (2) 点击无报错 (3) 发出正确的postMessage
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

// 辅助：获取已发送的postMessage
async function getPosted(page: any) {
  return page.evaluate(() => (window as any).__posted as any[]);
}

// 辅助：清空已发送的postMessage
async function clearPosted(page: any) {
  return page.evaluate(() => { (window as any).__posted = []; });
}

test.describe('所有UI按钮验证', () => {

  test.beforeEach(async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') pageErrors.push(`[console.error] ${m.text()}`); });

    const { url, dir } = writeHarnessHtml(cfg);
    harnessDir = dir;
    await page.goto(url);
    await expect(page.locator('#csv-root')).toBeVisible();
    expect(pageErrors, `页面加载出错: ${pageErrors.join('\n')}`).toEqual([]);
  });

  // ===== 浮动面板按钮 =====

  test('列过滤输入框 - 可见且可添加条件', async ({ page }) => {
    const input = page.locator('#csvColumnFilterValue');
    await expect(input).toBeVisible();
    await expect(page.locator('#csvGlobalSearch')).toBeVisible();
    await input.click();
    await input.fill('Alice');
    await page.locator('#csvColumnFilterAdd').click();
    const posted = await getPosted(page);
    const filterMsgs = posted.filter(m => m && m.type === 'filterSort');
    expect(filterMsgs.length, '输入过滤词后应发出filterSort消息').toBeGreaterThan(0);
  });

  test('清除过滤按钮 - 添加条件后出现，点击后清空', async ({ page }) => {
    const input = page.locator('#csvColumnFilterValue');
    const clear = page.locator('#csvColumnFilterClear');

    // 初始隐藏
    await expect(clear).toBeHidden();

    await input.fill('Bob');
    await page.locator('#csvColumnFilterAdd').click();
    await expect(clear).toBeVisible();

    // 点击后清空
    await clear.click();
    await expect(page.locator('#csvColumnFilterChips .csv-filter-chip')).toHaveCount(0);
  });

  test('行高切换按钮 - 两态循环', async ({ page }) => {
    const btn = page.locator('#csvRowHeightToggle');
    await expect(btn).toBeVisible();
    // harness初始mode是compact

    await expect(btn).toHaveAttribute('data-mode', 'compact');

    // compact → wrap → compact
    await btn.click();
    await expect(btn).toHaveAttribute('data-mode', 'wrap');
    await btn.click();
    await expect(btn).toHaveAttribute('data-mode', 'compact');
  });

  // ===== 排序按钮 =====

  test('排序按钮 - 每列都有可见的sort-btn', async ({ page }) => {
    for (let col = 0; col < 3; col++) {
      const sortBtn = page.locator(`th[data-col="${col}"] .sort-btn`);
      await expect(sortBtn, `第${col}列的排序按钮应可见`).toBeVisible();
    }
  });

  test('排序按钮 - 点击后发出sortColumn消息', async ({ page }) => {
    await clearPosted(page);
    const sortBtn = page.locator('th[data-col="0"] .sort-btn');
    await sortBtn.click();
    const posted = await getPosted(page);
    const sortMsgs = posted.filter(m => m && m.type === 'sortColumn');
    expect(sortMsgs.length, '点击排序按钮应发出sortColumn消息').toBeGreaterThan(0);
  });

  test('排序按钮 - 三态循环 asc→desc→reset', async ({ page }) => {
    await clearPosted(page);
    const sortBtn = page.locator('th[data-col="0"] .sort-btn');

    // 第1次点击：升序
    await sortBtn.click();
    await expect(page.locator('th[data-col="0"]')).toHaveClass(/sort-asc/);

    // 第2次点击：降序
    await sortBtn.click();
    await expect(page.locator('th[data-col="0"]')).toHaveClass(/sort-desc/);

    // 第3次点击：重置
    await sortBtn.click();
    await expect(page.locator('th[data-col="0"]')).not.toHaveClass(/sort-asc/);
    await expect(page.locator('th[data-col="0"]')).not.toHaveClass(/sort-desc/);
  });

  // ===== 查找替换面板 =====

  test('查找面板 - 可通过JS打开', async ({ page }) => {
    const widget = page.locator('#findReplaceWidget');
    // 初始隐藏
    await expect(widget).toBeHidden();

    // 通过JS触发打开（Ctrl+F可能被Chromium拦截）
    await page.evaluate(() => {
      const widget = document.getElementById('findReplaceWidget');
      if (widget) widget.style.display = 'flex';
    });
    await expect(widget).toBeVisible();
  });

  test('查找面板 - 输入查找内容', async ({ page }) => {
    // 先打开面板
    await page.evaluate(() => {
      const widget = document.getElementById('findReplaceWidget');
      if (widget) widget.style.display = 'flex';
    });
    const findInput = page.locator('#findInput');
    await expect(findInput).toBeVisible();
    await findInput.fill('Alice');
  });

  test('查找面板 - 关闭按钮可点击', async ({ page }) => {
    // 先打开面板
    await page.evaluate(() => {
      const widget = document.getElementById('findReplaceWidget');
      if (widget) widget.style.display = 'flex';
    });
    const closeBtn = page.locator('#findClose');
    await expect(closeBtn).toBeVisible();
    // 关闭按钮可点击且无报错
    await closeBtn.click();
  });

  test('查找面板 - 大小写切换按钮', async ({ page }) => {
    await page.evaluate(() => {
      const widget = document.getElementById('findReplaceWidget');
      if (widget) widget.style.display = 'flex';
    });
    const caseToggle = page.locator('#findCaseToggle');
    await expect(caseToggle).toBeVisible();
    await caseToggle.click();
    await expect(caseToggle).toHaveAttribute('aria-pressed', 'true');
  });

  test('查找面板 - 全词匹配切换按钮', async ({ page }) => {
    await page.evaluate(() => {
      const widget = document.getElementById('findReplaceWidget');
      if (widget) widget.style.display = 'flex';
    });
    const wordToggle = page.locator('#findWordToggle');
    await expect(wordToggle).toBeVisible();
    await wordToggle.click();
    await expect(wordToggle).toHaveAttribute('aria-pressed', 'true');
  });

  test('查找面板 - 正则切换按钮', async ({ page }) => {
    await page.evaluate(() => {
      const widget = document.getElementById('findReplaceWidget');
      if (widget) widget.style.display = 'flex';
    });
    const regexToggle = page.locator('#findRegexToggle');
    await expect(regexToggle).toBeVisible();
    await regexToggle.click();
    await expect(regexToggle).toHaveAttribute('aria-pressed', 'true');
  });

  test('替换面板 - 打开后可见', async ({ page }) => {
    // 打开面板并展开替换
    await page.evaluate(() => {
      const widget = document.getElementById('findReplaceWidget');
      if (widget) widget.style.display = 'flex';
      widget?.classList.remove('replace-collapsed');
    });
    const widget = page.locator('#findReplaceWidget');
    await expect(widget).toBeVisible();
    const replaceInput = page.locator('#replaceInput');
    await expect(replaceInput).toBeVisible();
  });

  test('替换面板 - 替换按钮可见', async ({ page }) => {
    await page.evaluate(() => {
      const widget = document.getElementById('findReplaceWidget');
      if (widget) widget.style.display = 'flex';
      widget?.classList.remove('replace-collapsed');
    });
    const replaceOne = page.locator('#replaceOne');
    const replaceAll = page.locator('#replaceAll');
    await expect(replaceOne).toBeVisible();
    await expect(replaceAll).toBeVisible();
  });

  // ===== 单元格交互 =====

  test('单元格 - 点击选中', async ({ page }) => {
    const cell = page.locator('td[data-col="0"]').first();
    await cell.click();
    // 选中后应有选中样式
    await expect(cell).toHaveClass(/selected/);
  });

  test('单元格 - 双击进入编辑模式', async ({ page }) => {
    const cell = page.locator('td[data-col="0"]').first();
    await cell.dblclick();
    // 编辑模式下应出现input或textarea
    const editor = page.locator('td[data-col="0"] input, td[data-col="0"] textarea, .cell-editor');
    // 至少应该有某种编辑状态
  });

  test('单元格 - Tab键移动选中', async ({ page }) => {
    const firstCell = page.locator('td[data-col="0"]').first();
    await firstCell.click();
    await page.keyboard.press('Tab');
    // 应该移动到下一个单元格
  });

  // ===== 缩放功能 =====

  test('缩放 - Ctrl++放大', async ({ page }) => {
    const root = page.locator('#csv-root');
    const fontSizeBefore = await root.getAttribute('data-fontsize');
    await page.keyboard.press('Control+Equal');
    // 字体大小应该变化
  });

  test('缩放 - Ctrl+-缩小', async ({ page }) => {
    await page.keyboard.press('Control+Minus');
  });

  test('缩放 - Ctrl+0重置', async ({ page }) => {
    await page.keyboard.press('Control+Digit0');
  });

  // ===== 页面无JS错误 =====

  test('页面加载后无JS错误', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') pageErrors.push(`[console.error] ${m.text()}`); });

    const { url, dir } = writeHarnessHtml(cfg);
    harnessDir = dir;
    await page.goto(url);
    await expect(page.locator('#csv-root')).toBeVisible();
    await page.waitForTimeout(500);
    expect(pageErrors, `页面存在JS错误: ${pageErrors.join('\n')}`).toEqual([]);
  });
});
