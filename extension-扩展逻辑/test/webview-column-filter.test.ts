/**
 * 真 webview 交互：右下角多列组合过滤。
 */
import assert from 'assert';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { createHarness, Harness } from './helpers/webview-harness';

describe('Webview column filter panel', () => {
  let h: Harness;

  beforeEach(() => {
    h = createHarness({
      columns: 3,
      addSerialIndex: true,
      fontSize: 14,
      rowHeightMode: 'compact',
      header: { absRow: 0, cells: ['Name', 'City', 'Status'] },
      body: [
        { absRow: 1, cells: ['Alice', 'Shanghai', 'active'] },
        { absRow: 2, cells: ['Bob', 'Beijing', 'inactive'] },
      ],
    });
  });

  afterEach(() => h.destroy());

  const addColumnFilter = (col: string, value: string, options: { mode?: string; ignoreCase?: boolean; ignoreWhitespace?: boolean } = {}) => {
    const select = h.document.getElementById('csvColumnFilterColumn') as HTMLSelectElement;
    const mode = h.document.getElementById('csvColumnFilterMode') as HTMLSelectElement;
    const input = h.document.getElementById('csvColumnFilterValue') as HTMLInputElement;
    const ignoreCase = h.document.getElementById('csvColumnFilterIgnoreCase') as HTMLInputElement;
    const ignoreWhitespace = h.document.getElementById('csvColumnFilterIgnoreWhitespace') as HTMLInputElement;
    const add = h.document.getElementById('csvColumnFilterAdd') as HTMLButtonElement;
    select.value = col;
    mode.value = options.mode ?? 'contains';
    ignoreCase.checked = options.ignoreCase ?? true;
    ignoreWhitespace.checked = options.ignoreWhitespace ?? false;
    input.value = value;
    add.click();
  };
  const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

  it('posts multiple column filters without global search', () => {
    addColumnFilter('1', 'shanghai');
    addColumnFilter('2', 'active');

    const lastMsg = h.posted[h.posted.length - 1];
    assert.strictEqual(lastMsg.type, 'filterSort');
    assert.strictEqual(lastMsg.globalSearch, '');
    assert.deepStrictEqual(plain(lastMsg.columnFilters), {
      '1': { value: 'shanghai', mode: 'contains', ignoreCase: true, ignoreWhitespace: false },
      '2': { value: 'active', mode: 'contains', ignoreCase: true, ignoreWhitespace: false },
    });
  });

  it('posts match mode and normalization options', () => {
    addColumnFilter('1', ' Shang Hai ', {
      mode: 'equals',
      ignoreCase: false,
      ignoreWhitespace: true,
    });

    const lastMsg = h.posted[h.posted.length - 1];
    assert.strictEqual(lastMsg.type, 'filterSort');
    assert.deepStrictEqual(plain(lastMsg.columnFilters), {
      '1': { value: 'Shang Hai', mode: 'equals', ignoreCase: false, ignoreWhitespace: true },
    });
  });

  it('renders chips and allows removing a single column filter', () => {
    addColumnFilter('0', 'alice');
    addColumnFilter('1', 'shanghai');

    const chips = h.document.querySelectorAll('#csvColumnFilterChips .csv-filter-chip');
    assert.strictEqual(chips.length, 2);

    const removeFirst = chips[0].querySelector('button') as HTMLButtonElement;
    removeFirst.click();

    const lastMsg = h.posted[h.posted.length - 1];
    assert.strictEqual(lastMsg.type, 'filterSort');
    assert.deepStrictEqual(plain(lastMsg.columnFilters), {
      '1': { value: 'shanghai', mode: 'contains', ignoreCase: true, ignoreWhitespace: false },
    });
  });

  it('syncs authoritative filters from filterSortResult messages', () => {
    h.window.dispatchEvent(new h.window.MessageEvent('message', {
      data: {
        type: 'filterSortResult',
        addSerialIndex: true,
        sortCol: -1,
        sortDir: null,
        columnLabels: ['Name', 'City', 'Status'],
        columnFilters: { '2': { value: 'active', mode: 'equals', ignoreCase: false, ignoreWhitespace: true } },
        rows: [],
      },
    }));

    const chip = h.document.querySelector('#csvColumnFilterChips .csv-filter-chip span');
    assert.ok(chip);
    assert.strictEqual(chip.textContent, '3. Status 等于/忽略空格: active');
  });
});
