/**
 * 真 webview 交互：列头选择与编辑。
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

  it('single-clicking a column header selects the whole column', () => {
    clickHeader(1);

    assert.ok(h.getHeader(1)!.classList.contains('selected'));
    assert.ok(h.getCell(1, 1)!.classList.contains('selected'));
    assert.ok(h.getCell(2, 1)!.classList.contains('selected'));
    assert.ok(!h.getCell(1, 0)!.classList.contains('selected'));
  });

  it('shift-clicking another header extends to a column range', () => {
    clickHeader(0);
    clickHeader(2, { shiftKey: true });

    for (const col of [0, 1, 2]) {
      assert.ok(h.getHeader(col)!.classList.contains('selected'), `header ${col} should be selected`);
      assert.ok(h.getCell(1, col)!.classList.contains('selected'), `row 1 col ${col} should be selected`);
      assert.ok(h.getCell(2, col)!.classList.contains('selected'), `row 2 col ${col} should be selected`);
    }
  });

  it('double-clicking a column header enters header edit mode', () => {
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
