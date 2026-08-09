/**
 * 真 webview 交互：表头排序按钮打开独立菜单。
 */
import assert from 'assert';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { createHarness, Harness } from './helpers/webview-harness-脚手架';

describe('Webview header sort menu', () => {
  let h: Harness;

  beforeEach(() => {
    h = createHarness({
      columns: 3,
      addSerialIndex: true,
      fontSize: 14,
      rowHeightMode: 'compact',
      header: { absRow: 0, cells: ['Name', 'Age', 'City'] },
      body: [
        { absRow: 1, cells: ['Alice', '30', 'NYC'] },
        { absRow: 2, cells: ['Bob', '25', 'LA'] },
        { absRow: 3, cells: ['Cindy', '28', 'SF'] },
      ],
    });
  });

  afterEach(() => h.destroy());

  const openSortMenu = (col: number) => {
    const btn = h.getSortBtn(col);
    assert.ok(btn, `sort-btn for column ${col} should exist`);
    h.fireMouse('mousedown', btn, { clientX: 0, clientY: 0 });
    h.fireMouse('click', btn, { clientX: 0, clientY: 0 });
  };

  const chooseSort = (col: number, action: 'sort-asc' | 'sort-desc' | 'sort-reset') => {
    openSortMenu(col);
    const item = h.document.querySelector(`[data-header-action="${action}"]`) as HTMLElement | null;
    assert.ok(item, `sort menu action ${action} should exist`);
    h.fireMouse('click', item, { clientX: 0, clientY: 0 });
  };
  const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

  it('opens a three-item menu without sorting immediately', () => {
    openSortMenu(1);

    const menu = h.document.querySelector('#csvHeaderActionMenu');
    assert.ok(menu);
    assert.strictEqual(menu?.getAttribute('data-menu-kind'), 'sort');
    assert.strictEqual(menu?.querySelectorAll('[data-header-action^="sort-"]').length, 3);
    assert.strictEqual(h.posted.length, 0);
  });

  it('chooses ascending explicitly', () => {
    chooseSort(1, 'sort-asc');

    const lastMsg = h.posted[h.posted.length - 1];
    assert.deepStrictEqual(plain(lastMsg), { type: 'sortColumn', index: 1, ascending: true });
    assert.ok(h.getHeader(1)?.classList.contains('sort-asc'));
  });

  it('chooses descending explicitly', () => {
    chooseSort(1, 'sort-desc');

    const lastMsg = h.posted[h.posted.length - 1];
    assert.deepStrictEqual(plain(lastMsg), { type: 'sortColumn', index: 1, ascending: false });
    assert.ok(h.getHeader(1)?.classList.contains('sort-desc'));
  });

  it('restores original order explicitly', () => {
    chooseSort(1, 'sort-asc');
    chooseSort(1, 'sort-reset');

    const lastMsg = h.posted[h.posted.length - 1];
    assert.deepStrictEqual(plain(lastMsg), { type: 'resetSort' });
    assert.ok(!h.getHeader(1)?.classList.contains('sort-asc'));
    assert.ok(!h.getHeader(1)?.classList.contains('sort-desc'));
  });

  it('does not select or reorder the column when opening the menu', () => {
    const before = h.posted.filter(m => m.type === 'reorderColumns').length;
    openSortMenu(2);
    const after = h.posted.filter(m => m.type === 'reorderColumns').length;

    assert.strictEqual(after, before);
    assert.ok(!h.getCell(1, 2)?.classList.contains('selected'));
  });

  it('moves the sort indicator when another column is selected', () => {
    chooseSort(2, 'sort-asc');
    chooseSort(0, 'sort-desc');

    assert.ok(h.getHeader(0)?.classList.contains('sort-desc'));
    assert.ok(!h.getHeader(2)?.classList.contains('sort-asc'));
    assert.ok(!h.getHeader(2)?.classList.contains('sort-desc'));
  });
});
