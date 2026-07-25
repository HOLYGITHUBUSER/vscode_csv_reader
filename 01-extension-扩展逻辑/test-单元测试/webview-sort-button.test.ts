/**
 * 真 webview 交互：表头 sort-btn 的三态循环。
 * 验证：
 *   - 第 1 次：asc  → postMessage sortColumn ascending=true， th.sort-asc
 *   - 第 2 次：desc → postMessage sortColumn ascending=false，th.sort-desc
 *   - 第 3 次：原始 → postMessage resetSort，th 上 sort-asc/desc 都被清掉
 *   - 第 4 次：又回到 asc
 *   - 点 sort-btn 不会启动列选中 / reorder
 *   - 切到别的列直接从 asc 开始
 */
import assert from 'assert';
import { describe, it, before, after } from 'node:test';
import { createHarness, Harness } from './helpers/webview-harness-脚手架';

describe('Webview sort-btn interactions (tri-state)', () => {
  let h: Harness;

  before(() => {
    h = createHarness({
      columns: 3,
      addSerialIndex: true,
      fontSize: 14,
      rowHeightMode: 'compact',
      header: { absRow: 0, cells: ['Name', 'Age', 'City'] },
      body: [
        { absRow: 1, cells: ['Alice', '30', 'NYC'] },
        { absRow: 2, cells: ['Bob',   '25', 'LA'] },
        { absRow: 3, cells: ['Cindy', '28', 'SF'] },
      ],
    });
  });

  after(() => h.destroy());

  const clickSort = (col: number) => {
    const btn = h.getSortBtn(col);
    assert.ok(btn, `sort-btn for column ${col} should exist`);
    h.fireMouse('mousedown', btn!, { clientX: 0, clientY: 0 });
    h.fireMouse('click', btn!, { clientX: 0, clientY: 0 });
  };

  it('1st click → ascending', () => {
    clickSort(1);

    const lastMsg = h.posted[h.posted.length - 1];
    assert.strictEqual(lastMsg.type, 'sortColumn');
    assert.strictEqual(lastMsg.index, 1);
    assert.strictEqual(lastMsg.ascending, true);

    const th = h.getHeader(1)!;
    assert.ok(th.classList.contains('sort-asc'));
    assert.ok(!th.classList.contains('sort-desc'));
  });

  it('2nd click on same column → descending', () => {
    clickSort(1);

    const lastMsg = h.posted[h.posted.length - 1];
    assert.strictEqual(lastMsg.type, 'sortColumn');
    assert.strictEqual(lastMsg.ascending, false);

    const th = h.getHeader(1)!;
    assert.ok(th.classList.contains('sort-desc'));
    assert.ok(!th.classList.contains('sort-asc'));
  });

  it('3rd click on same column → resetSort, no sort indicator', () => {
    clickSort(1);

    const lastMsg = h.posted[h.posted.length - 1];
    assert.strictEqual(lastMsg.type, 'resetSort');

    const th = h.getHeader(1)!;
    assert.ok(!th.classList.contains('sort-asc'));
    assert.ok(!th.classList.contains('sort-desc'));
  });

  it('4th click wraps back to ascending', () => {
    clickSort(1);

    const lastMsg = h.posted[h.posted.length - 1];
    assert.strictEqual(lastMsg.type, 'sortColumn');
    assert.strictEqual(lastMsg.ascending, true);

    assert.ok(h.getHeader(1)!.classList.contains('sort-asc'));
  });

  it('clicking sort-btn does NOT select the column or start reorder', () => {
    const before = h.posted.filter(m => m.type === 'reorderColumns').length;
    clickSort(2);
    const after = h.posted.filter(m => m.type === 'reorderColumns').length;
    assert.strictEqual(after, before, 'no reorderColumns message should be posted');

    const cell = h.getCell(1, 2)!;
    assert.ok(!cell.classList.contains('selected'), 'data cell should not be selected');
  });

  it('switching to a different column starts fresh at ascending', () => {
    // Previous state: col=2 just entered asc via the test above.
    clickSort(0);

    const lastMsg = h.posted[h.posted.length - 1];
    assert.strictEqual(lastMsg.type, 'sortColumn');
    assert.strictEqual(lastMsg.index, 0);
    assert.strictEqual(lastMsg.ascending, true);

    assert.ok(h.getHeader(0)!.classList.contains('sort-asc'));
    // old column's marker cleared
    assert.ok(!h.getHeader(2)!.classList.contains('sort-asc'));
    assert.ok(!h.getHeader(2)!.classList.contains('sort-desc'));
  });
});
