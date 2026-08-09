/**
 * 真 webview 交互：表头配置列过滤，右下角只展示条件/删除与行高。
 */
import assert from 'assert';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { createHarness, Harness } from './helpers/webview-harness-脚手架';

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

  const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

  const openFilterEditor = (col: number) => {
    const header = h.getHeader(col);
    assert.ok(header);
    const button = header.querySelector('.csv-header-filter-btn') as HTMLElement | null;
    assert.ok(button);
    h.fireMouse('mousedown', button, { clientX: 0, clientY: 0 });
    h.fireMouse('click', button, { clientX: 0, clientY: 0 });

    const menu = h.document.querySelector('#csvHeaderActionMenu') as HTMLElement | null;
    assert.ok(menu);
    const input = menu.querySelector('[data-header-filter-input]') as HTMLInputElement | null;
    const mode = menu.querySelector('[data-header-filter-mode]') as HTMLSelectElement | null;
    const ignoreCase = menu.querySelector('[data-header-filter-ignore-case]') as HTMLInputElement | null;
    const ignoreWhitespace = menu.querySelector('[data-header-filter-ignore-whitespace]') as HTMLInputElement | null;
    const apply = menu.querySelector('[data-header-action="filter-apply"]') as HTMLButtonElement | null;
    assert.ok(input);
    assert.ok(mode);
    assert.ok(ignoreCase);
    assert.ok(ignoreWhitespace);
    assert.ok(apply);
    return { menu, input, mode, ignoreCase, ignoreWhitespace, apply };
  };

  const applyColumnFilter = (
    col: number,
    value: string,
    options: { mode?: string; ignoreCase?: boolean; ignoreWhitespace?: boolean } = {},
  ) => {
    const editor = openFilterEditor(col);
    editor.input.value = value;
    editor.input.dispatchEvent(new h.window.Event('input', { bubbles: true }));
    editor.mode.value = options.mode ?? 'contains';
    editor.ignoreCase.checked = options.ignoreCase ?? true;
    editor.ignoreWhitespace.checked = options.ignoreWhitespace ?? false;
    editor.apply.click();
  };

  it('keeps only active-filter summaries and row height in the bottom panel', () => {
    const panel = h.document.getElementById('csvFloatPanel');
    const activeFilters = h.document.getElementById('csvActiveFilters') as HTMLElement | null;
    assert.ok(panel);
    assert.ok(activeFilters);
    assert.strictEqual(activeFilters.hidden, true);
    assert.ok(h.document.getElementById('csvRowHeightToggle'));

    [
      'csvGlobalSearch',
      'csvClearFilter',
      'csvColumnFilterColumn',
      'csvColumnFilterMode',
      'csvColumnFilterValue',
      'csvColumnFilterIgnoreCase',
      'csvColumnFilterIgnoreWhitespace',
      'csvColumnFilterAdd',
      'csvColumnFilterClear',
    ].forEach(id => assert.strictEqual(h.document.getElementById(id), null, `${id} should not remain in footer`));
  });

  it('opens all filter settings directly from the selected header', () => {
    const editor = openFilterEditor(1);

    assert.strictEqual(editor.menu.getAttribute('data-menu-kind'), 'filter');
    assert.strictEqual(editor.menu.getAttribute('role'), 'dialog');
    assert.ok(editor.menu.textContent?.includes('过滤：2. City'));
    assert.strictEqual(editor.mode.value, 'contains');
    assert.strictEqual(editor.ignoreCase.checked, true);
    assert.strictEqual(editor.ignoreWhitespace.checked, false);
    assert.ok(editor.menu.querySelector('[data-header-action="filter-cancel"]'));
    assert.strictEqual(editor.menu.querySelector('[data-header-action="filter-delete"]'), null);
    assert.strictEqual(editor.menu.querySelector('[data-header-action="filter-clear-all"]'), null);
    assert.strictEqual(h.posted.length, 0);
  });

  it('posts multiple column filters configured from their headers', () => {
    applyColumnFilter(1, 'shanghai');
    applyColumnFilter(2, 'active');

    const lastMsg = h.posted[h.posted.length - 1];
    assert.strictEqual(lastMsg.type, 'filterSort');
    assert.strictEqual(lastMsg.globalSearch, '');
    assert.deepStrictEqual(plain(lastMsg.columnFilters), {
      '1': { value: 'shanghai', mode: 'contains', ignoreCase: true, ignoreWhitespace: false },
      '2': { value: 'active', mode: 'contains', ignoreCase: true, ignoreWhitespace: false },
    });
  });

  it('posts match mode, case, and whitespace options from the header editor', () => {
    applyColumnFilter(1, ' Shang Hai ', {
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

  it('applies a header filter with Enter', () => {
    const editor = openFilterEditor(0);
    editor.input.value = 'Alice';
    editor.input.dispatchEvent(new h.window.Event('input', { bubbles: true }));
    editor.input.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    const lastMsg = h.posted[h.posted.length - 1];
    assert.deepStrictEqual(plain(lastMsg.columnFilters), {
      '0': { value: 'Alice', mode: 'contains', ignoreCase: true, ignoreWhitespace: false },
    });
    assert.strictEqual(h.document.getElementById('csvHeaderActionMenu'), null);
  });

  it('prefills an existing condition when the header filter is edited', () => {
    applyColumnFilter(1, 'Shang Hai', {
      mode: 'equals',
      ignoreCase: false,
      ignoreWhitespace: true,
    });

    const editor = openFilterEditor(1);
    assert.strictEqual(editor.input.value, 'Shang Hai');
    assert.strictEqual(editor.mode.value, 'equals');
    assert.strictEqual(editor.ignoreCase.checked, false);
    assert.strictEqual(editor.ignoreWhitespace.checked, true);
    assert.strictEqual(editor.apply.textContent, '更新');
    assert.ok(editor.menu.querySelector('[data-header-action="filter-delete"]'));
  });

  it('deletes the current filter from its header editor', () => {
    applyColumnFilter(1, 'Shanghai');

    const editor = openFilterEditor(1);
    const deleteFilter = editor.menu.querySelector(
      '[data-header-action="filter-delete"]',
    ) as HTMLButtonElement | null;
    assert.ok(deleteFilter);
    deleteFilter.click();

    const lastMsg = h.posted[h.posted.length - 1];
    assert.deepStrictEqual(plain(lastMsg.columnFilters), {});
    assert.strictEqual(h.document.getElementById('csvActiveFilters')?.hidden, true);
    assert.strictEqual(h.getHeader(1)?.querySelector('.csv-header-filter-btn')?.classList.contains('active'), false);
  });

  it('shows complete condition chips and removes filters from the bottom panel', () => {
    applyColumnFilter(0, 'Alice');
    applyColumnFilter(1, 'Shang Hai', {
      mode: 'equals',
      ignoreCase: false,
      ignoreWhitespace: true,
    });

    const activeFilters = h.document.getElementById('csvActiveFilters') as HTMLElement;
    const divider = h.document.getElementById('csvPanelDivider') as HTMLElement;
    let chips = h.document.querySelectorAll('#csvColumnFilterChips .csv-filter-chip');
    assert.strictEqual(activeFilters.hidden, false);
    assert.strictEqual(divider.hidden, false);
    assert.strictEqual(chips.length, 2);
    assert.strictEqual(
      chips[1].querySelector('span')?.textContent,
      '2. City · 等于 · 区分大小写 · 忽略空格: Shang Hai',
    );

    (chips[0].querySelector('button') as HTMLButtonElement).click();
    let lastMsg = h.posted[h.posted.length - 1];
    assert.deepStrictEqual(plain(lastMsg.columnFilters), {
      '1': { value: 'Shang Hai', mode: 'equals', ignoreCase: false, ignoreWhitespace: true },
    });

    chips = h.document.querySelectorAll('#csvColumnFilterChips .csv-filter-chip');
    (chips[0].querySelector('button') as HTMLButtonElement).click();
    lastMsg = h.posted[h.posted.length - 1];
    assert.deepStrictEqual(plain(lastMsg.columnFilters), {});
    assert.strictEqual(activeFilters.hidden, true);
    assert.strictEqual(divider.hidden, true);
  });

  it('syncs authoritative filters into the bottom summaries', () => {
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
    assert.strictEqual(
      chip.textContent,
      '3. Status · 等于 · 区分大小写 · 忽略空格: active',
    );
  });

  it('places filter and sort controls side by side in the same header container', () => {
    const header = h.getHeader(1);
    assert.ok(header);
    const controls = header.querySelector(':scope > .th-content');
    const sortButton = controls?.querySelector(':scope > .sort-btn');
    const filterButton = controls?.querySelector(':scope > .csv-header-filter-btn');

    assert.ok(controls);
    assert.ok(sortButton);
    assert.ok(filterButton);
    assert.strictEqual(filterButton?.textContent, '⌛︎');
    assert.strictEqual(sortButton?.parentElement, filterButton?.parentElement);
  });

  it('keeps exactly one filter button after repeated result refreshes', () => {
    const result = {
      type: 'filterSortResult',
      addSerialIndex: true,
      sortCol: -1,
      sortDir: null,
      columnLabels: ['Name', 'City', 'Status'],
      columnFilters: {},
      rows: [],
    };

    h.window.dispatchEvent(new h.window.MessageEvent('message', { data: result }));
    h.window.dispatchEvent(new h.window.MessageEvent('message', { data: result }));
    h.window.dispatchEvent(new h.window.MessageEvent('message', { data: result }));

    for (let col = 0; col < 3; col++) {
      const header = h.getHeader(col);
      assert.strictEqual(header?.querySelectorAll('.sort-btn').length, 1);
      assert.strictEqual(header?.querySelectorAll('.csv-header-filter-btn').length, 1);
    }
  });
});
