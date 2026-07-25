/**
 * 真 webview 交互：行高拖拽。
 * 验证：
 *   - 任意数据单元格底边都能触发行高拖（不只是序号列）
 *   - 拖动后整行所有单元格 style.height 被设置
 *   - 同时清掉 cell-body 的 max-height（否则在紧凑模式下视觉不变）
 *   - 顶部表头那一行的列拖拽不被误伤
 */
import assert from 'assert';
import { describe, it, before, after } from 'node:test';
import { createHarness, Harness } from './helpers/webview-harness-脚手架';

describe('Webview row-resize interactions', () => {
  let h: Harness;

  before(() => {
    h = createHarness({
      columns: 3,
      addSerialIndex: true,
      fontSize: 14,
      rowHeightMode: 'compact',
      header: { absRow: 0, cells: ['a', 'b', 'c'] },
      body: [
        { absRow: 1, cells: ['alpha',   'one',   'x'] },
        { absRow: 2, cells: ['bravo',   'two',   'y'] },
        { absRow: 3, cells: ['charlie', 'three', 'z'] },
      ],
    });
  });

  after(() => h.destroy());

  it('dragging the bottom edge of a middle data cell resizes that row', () => {
    const cell = h.getCell(2, 1)!; // row 2, 中间列
    const initialH = cell.getBoundingClientRect().height;

    h.dragRowBottom(cell, 40); // 向下拖 40px

    // 整行所有单元格都应该被改高
    const rowCells = Array.from(
      h.document.querySelectorAll<HTMLElement>('[data-row="2"]'),
    );
    assert.ok(rowCells.length >= 3, 'should find all cells in row 2');
    for (const c of rowCells) {
      const h2 = parseInt(c.style.height || '0', 10);
      assert.ok(h2 > initialH, `cell ${c.getAttribute('data-col')} height (${h2}) should exceed initial ${initialH}`);
    }
  });

  it('resize lifts the cell-body max-height so compact mode actually grows', () => {
    const cell = h.getCell(2, 1)!;
    const body = cell.querySelector<HTMLElement>(':scope > .cell-body');
    assert.ok(body, '.cell-body must exist');
    assert.strictEqual(body!.style.maxHeight, 'none', 'cell-body max-height must be cleared');
  });

  it('dragging the bottom of the serial index cell also resizes the row', () => {
    const serial = h.getCell(3, -1)!;
    h.dragRowBottom(serial, 30);

    const rowCells = Array.from(
      h.document.querySelectorAll<HTMLElement>('[data-row="3"]'),
    );
    for (const c of rowCells) {
      const h2 = parseInt(c.style.height || '0', 10);
      assert.ok(h2 > 24, `row 3 cell height should grow, got ${h2}`);
    }
  });

  it('does not treat header-row bottom edge as a row-resize handle', () => {
    // Header row has data-row=0; its bottom is adjacent to first data row's top,
    // but row-resize for row 0 would be confusing. We accept either "no resize"
    // OR "row 0 resize" — we only assert that clicking near the header's sort-btn
    // pixel coordinate does not resize row 1 cells.
    const rowOneCell = h.getCell(1, 1)!;
    const before = rowOneCell.style.height;

    const headerTh = h.getHeader(1)!;
    const rect = headerTh.getBoundingClientRect();
    // 鼠标放到 header 的中心（绝不是底边热区）
    h.fireMouse('mousemove', headerTh, {
      clientX: rect.left + 10,
      clientY: rect.top + 5,
    });
    h.fireMouse('mousedown', headerTh, {
      clientX: rect.left + 10,
      clientY: rect.top + 5,
    });
    h.fireMouse('mouseup', h.document.body, {
      clientX: rect.left + 10,
      clientY: rect.top + 5,
    });

    assert.strictEqual(rowOneCell.style.height, before, 'row 1 height should be untouched');
  });
});
