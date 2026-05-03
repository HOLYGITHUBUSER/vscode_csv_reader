/**
 * 真 webview 交互：行高模式里的多行单元格显示。
 */
import assert from 'assert';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { createHarness, Harness } from './helpers/webview-harness';

describe('Webview row-height mode newline rendering', () => {
  let h: Harness;

  afterEach(() => {
    if (h) h.destroy();
  });

  const createCompactHarness = () => createHarness({
    columns: 2,
    addSerialIndex: true,
    fontSize: 14,
    rowHeightMode: 'compact',
    header: { absRow: 0, cells: ['Name', 'Note'] },
    body: [
      { absRow: 1, cells: ['Alice', 'line one\nline two'] },
      { absRow: 2, cells: ['Bob', 'single line'] },
    ],
  });

  beforeEach(() => {
    h = createCompactHarness();
  });

  it('initial compact mode replaces cell newlines with visible markers', () => {
    const body = h.getCell(1, 1)!.querySelector<HTMLElement>(':scope > .cell-body')!;

    assert.strictEqual(body.textContent, 'line one↵line two');
    assert.strictEqual(body.getAttribute('data-orig-html'), 'line one\nline two');
  });

  it('leaving compact mode restores original multiline text', () => {
    const btn = h.document.getElementById('csvRowHeightToggle')!;
    btn.click();

    const body = h.getCell(1, 1)!.querySelector<HTMLElement>(':scope > .cell-body')!;
    assert.strictEqual(btn.getAttribute('data-mode'), 'wrap');
    assert.strictEqual(body.textContent, 'line one\nline two');
    assert.strictEqual(body.hasAttribute('data-orig-html'), false);
  });

  it('returning to compact mode after restore reapplies newline markers', () => {
    const btn = h.document.getElementById('csvRowHeightToggle')!;
    btn.click(); // compact -> wrap
    btn.click(); // wrap -> compact

    const body = h.getCell(1, 1)!.querySelector<HTMLElement>(':scope > .cell-body')!;
    assert.strictEqual(btn.getAttribute('data-mode'), 'compact');
    assert.strictEqual(body.textContent, 'line one↵line two');
    assert.strictEqual(body.getAttribute('data-orig-html'), 'line one\nline two');
  });

  it('filterSortResult rows are normalized when compact mode is active', () => {
    const msg = {
      type: 'filterSortResult',
      addSerialIndex: true,
      sortCol: -1,
      sortDir: null,
      rows: [
        {
          absRow: 5,
          displayIdx: 1,
          cells: [
            { value: 'Cindy', rendered: 'Cindy' },
            { value: 'alpha\nbeta', rendered: 'alpha\nbeta' },
          ],
        },
      ],
    };

    h.window.dispatchEvent(new h.window.MessageEvent('message', { data: msg }));

    const body = h.getCell(5, 1)!.querySelector<HTMLElement>(':scope > .cell-body')!;
    assert.strictEqual(body.textContent, 'alpha↵beta');
    assert.strictEqual(body.getAttribute('data-orig-html'), 'alpha\nbeta');
  });
});
