/**
 * 真 webview 交互：列头选择与编辑。
 * 003-F1 revised: 单击表头 = 不响应（Airtable/Notion 范式）
 * 右键表头 = headerMenu 6 项（选中/复制/重命名/排序/列宽/隐藏）
 * 双击表头 = 重命名列
 * 拖动表头 = 整列选中
 */
import assert from 'assert';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { createHarness, Harness } from './helpers/webview-harness';

describe('Webview column header interactions', () => {
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
      ],
    });
  });

  afterEach(() => h.destroy());

  const clickHeader = (col: number, opts: MouseEventInit = {}) => {
    const header = h.getHeader(col)!;
    h.fireMouse('mousedown', header, { clientX: 4, clientY: 4, ...opts });
    h.fireMouse('mouseup', header, { clientX: 4, clientY: 4, ...opts });
  };

  const dragHeader = (fromCol: number, toCol: number) => {
    const from = h.getHeader(fromCol)!;
    const to = h.getHeader(toCol)!;
    h.fireMouse('mousedown', from, { clientX: 4, clientY: 4, button: 0 });
    h.fireMouse('mousemove', from, { clientX: 4, clientY: 4, button: 0 });
    h.fireMouse('mousemove', to, { clientX: 84, clientY: 4, button: 0 });
    h.fireMouse('mouseup', to, { clientX: 84, clientY: 4, button: 0 });
  };

  const rightClickHeader = (col: number) => {
    const header = h.getHeader(col)!;
    h.fireMouse('contextmenu', header, { clientX: 4, clientY: 4, button: 2 });
  };

  it('single-clicking a column header does NOT select the column (003-F1 revised)', () => {
    clickHeader(1);

    assert.ok(!h.getCell(1, 1)!.classList.contains('selected'), 'no cell selected after single click');
    assert.ok(!h.getHeader(1)!.classList.contains('selected'), 'header itself not selected');
  });

  it('dragging across column headers selects the column range', () => {
    dragHeader(0, 2);

    for (const col of [0, 1, 2]) {
      assert.ok(h.getHeader(col)!.classList.contains('selected'), `header ${col} selected`);
      assert.ok(h.getCell(1, col)!.classList.contains('selected'), `row 1 col ${col} selected`);
    }
  });

  it('right-clicking a column header opens the action menu (6 actions)', () => {
    rightClickHeader(1);

    const menu = h.dom.window.document.querySelector('[data-header-menu="true"]') as HTMLElement;
    assert.ok(menu, 'menu exists');
    assert.strictEqual(menu.style.display, 'block', 'menu visible after right-click');

    const buttons = menu.querySelectorAll('button[data-action]');
    assert.strictEqual(buttons.length, 6, '6 actions: select/copy/rename/sort/autofit/hide');
    const labels = Array.from(buttons).map(b => (b as HTMLElement).textContent);
    assert.ok(labels.some(l => l!.includes('选中整列')), 'has select column');
    assert.ok(labels.some(l => l!.includes('复制整列')), 'has copy column');
    assert.ok(labels.some(l => l!.includes('重命名')), 'has rename');
    assert.ok(labels.some(l => l!.includes('排序')), 'has sort');
    assert.ok(labels.some(l => l!.includes('列宽')), 'has autofit');
    assert.ok(labels.some(l => l!.includes('隐藏')), 'has hide');
  });

  it('header menu "select column" action selects the whole column', () => {
    rightClickHeader(1);
    const menu = h.dom.window.document.querySelector('[data-header-menu="true"]') as HTMLElement;
    const selectBtn = menu.querySelector('[data-action="select"]') as HTMLButtonElement;
    h.fireMouse('click', selectBtn, {});

    assert.ok(h.getHeader(1)!.classList.contains('selected'));
    assert.ok(h.getCell(1, 1)!.classList.contains('selected'));
    assert.ok(h.getCell(2, 1)!.classList.contains('selected'));
    assert.ok(!h.getCell(1, 0)!.classList.contains('selected'));
  });

  it('header menu closes after action is chosen', () => {
    rightClickHeader(1);
    const menu = h.dom.window.document.querySelector('[data-header-menu="true"]') as HTMLElement;
    const sortBtn = menu.querySelector('[data-action="sort"]') as HTMLButtonElement;
    h.fireMouse('click', sortBtn, {});

    assert.strictEqual(menu.style.display, 'none', 'menu closed after action');
  });

  it('header menu moves focus to first button on open (003-P0)', () => {
    rightClickHeader(1);
    const menu = h.dom.window.document.querySelector('[data-header-menu="true"]') as HTMLElement;
    const firstBtn = menu.querySelector('button[data-action]') as HTMLButtonElement;
    assert.strictEqual(h.dom.window.document.activeElement, firstBtn, 'first button focused');
  });

  it('Escape closes the header menu', () => {
    rightClickHeader(1);
    const menu = h.dom.window.document.querySelector('[data-header-menu="true"]') as HTMLElement;
    assert.strictEqual(menu.style.display, 'block', 'precondition: menu is open');
    h.dom.window.document.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert.strictEqual(menu.style.display, 'none', 'menu closed on Esc');
  });

  it('double-clicking a column header enters header edit mode (rename)', () => {
    const header = h.getHeader(1)!;
    h.fireMouse('dblclick', header, { clientX: 4, clientY: 4 });

    assert.strictEqual(header.getAttribute('contenteditable'), 'true');
    assert.ok(header.classList.contains('editing'));
  });

  it('double-clicking the sort button does not enter header edit mode', () => {
    const header = h.getHeader(1)!;
    const sortBtn = h.getSortBtn(1)!;
    h.fireMouse('dblclick', sortBtn, { clientX: 4, clientY: 4 });

    assert.notStrictEqual(header.getAttribute('contenteditable'), 'true');
    assert.ok(!header.classList.contains('editing'));
  });
});
