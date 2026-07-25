/**
 * Webview 交互测试脚手架（headless jsdom 版）
 *
 * 现有 webview-*.test.ts 大多是对 `webview-main.js` 源串做 grep 断言——
 * 那种写法不能复现「点了按钮没反应 / 拖了行没变高」这类真实交互 bug。
 *
 * 本模块把 `02-webview-表格界面/webview-main.js` 真正加载进一个 jsdom 环境，
 * 构造 CsvEditorProvider 渲染出的等价 DOM，暴露简单的合成鼠标事件 API，
 * 并捕获 `vscode.postMessage` 的全部调用，便于断言。
 */

import fs from 'fs';
import path from 'path';
import vm from 'vm';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { JSDOM } = require('jsdom');

export interface PostedMessage {
  type: string;
  [key: string]: unknown;
}

export interface HarnessRow {
  /** 展示用的 data-row 绝对值（表头行是 offset，首数据行是 offset+1 等） */
  absRow: number;
  /** 每列的文本；长度需等于 columns */
  cells: string[];
}

export interface HarnessConfig {
  columns: number;
  /** 表头行（会包含带 data-sort-btn 的 .sort-btn） */
  header: HarnessRow;
  /** 数据行 */
  body: HarnessRow[];
  /** 是否包含最左「序号列」<td data-col="-1"> */
  addSerialIndex?: boolean;
  /** 传给 root 的 data-fontsize */
  fontSize?: number;
  /** rowHeightMode：对应 table class `row-${mode}`，决定是否有 cell-body max-height */
  rowHeightMode?: 'compact' | 'wrap';
}

export interface Harness {
  dom: any;
  window: any;
  document: Document;
  /** 所有 `vscode.postMessage({...})` 调用都会被按顺序 push 到这里 */
  posted: PostedMessage[];
  /** 获取表格元素 */
  table: HTMLTableElement;
  /** 按 (row, col) 定位单元格（col=-1 是序号列） */
  getCell: (row: number, col: number) => HTMLElement | null;
  /** 表头第 col 列 */
  getHeader: (col: number) => HTMLElement | null;
  /** 表头第 col 列的 .sort-btn */
  getSortBtn: (col: number) => HTMLElement | null;
  /** 合成一次鼠标事件到具体坐标 */
  fireMouse: (type: string, target: Element, opts?: MouseEventInit) => void;
  /** 模拟行底边拖动：在指定 cell 的底边向下拖 dy 像素 */
  dragRowBottom: (cell: Element, dy: number) => void;
  /** 关闭并释放 jsdom */
  destroy: () => void;
}

/**
 * 生成一段和 CsvEditorProvider.updateWebviewContent 输出在结构上等价的 HTML。
 * 不会包含编辑/菜单/FindReplace 等无关模块（webview-main.js 里那些模块在没有相应 DOM 时走早退逻辑）。
 */
function buildHtml(cfg: HarnessConfig): string {
  const cols = cfg.columns;
  const addSerial = !!cfg.addSerialIndex;
  const rowMode = cfg.rowHeightMode ?? 'compact';
  const fontSize = cfg.fontSize ?? 14;

  const headCells: string[] = [];
  if (addSerial) headCells.push('<th tabindex="0"></th>');
  for (let i = 0; i < cols; i++) {
    const label = cfg.header.cells[i] ?? '';
    headCells.push(
      `<th tabindex="0" data-row="${cfg.header.absRow}" data-col="${i}">` +
        `<span class="th-content">` +
        `<span class="th-label">${label}</span>` +
        `<span class="sort-btn" data-sort-btn="1" role="button" aria-label="Sort column"></span>` +
        `</span>` +
        `</th>`,
    );
  }

  const bodyRows: string[] = [];
  for (const row of cfg.body) {
    const cells: string[] = [];
    if (addSerial) {
      cells.push(`<td tabindex="0" data-row="${row.absRow}" data-col="-1">${row.absRow}</td>`);
    }
    for (let i = 0; i < cols; i++) {
      const val = row.cells[i] ?? '';
      cells.push(
        `<td tabindex="0" data-row="${row.absRow}" data-col="${i}">` +
          `<div class="cell-body">${val}</div>` +
          `</td>`,
      );
    }
    bodyRows.push(`<tr>${cells.join('')}</tr>`);
  }

  const cellBodyMaxHeight =
    rowMode === 'wrap' ? 'none' : `${Math.max(18, Math.round(fontSize * 1.4))}px`;

  return `<!DOCTYPE html>
<html><head>
<style>
  th, td { padding: 2px 8px; border: 1px solid #ccc; vertical-align: top; }
  td { overflow: hidden; }
  td .cell-body { display: block; white-space: pre-wrap; }
  table.row-compact td .cell-body { max-height: ${cellBodyMaxHeight}; overflow: hidden; }
</style>
</head>
<body>
<div id="csv-root" class="table-container" data-sepcode="44" data-fontsize="${fontSize}" data-wheelzoomenabled="1" data-wheelzoominvert="0" data-nextchunkstart="" data-hasmorechunks="0">
  <table class="row-${rowMode}">
    <thead><tr>${headCells.join('')}</tr></thead>
    <tbody>${bodyRows.join('')}</tbody>
  </table>
</div>
<script id="__csvChunks" type="application/json">[]</script>
<script id="__csvColumnLabels" type="application/json">${JSON.stringify(cfg.header.cells)}</script>
<script id="__csvColumnFilters" type="application/json">{}</script>
<div id="contextMenu" style="display:none"></div>

<!-- Floating filter / rowHeight panel（webview-main.js 启动时会 querySelector 它们） -->
<div id="csvFloatPanel">
  <span id="csvFilterStatus"></span>
  <div class="csv-column-combobox">
    <input id="csvColumnFilterColumn" type="text" role="combobox" aria-expanded="false" aria-controls="csvColumnFilterOptions" data-selected-col="0">
    <div id="csvColumnFilterOptions" role="listbox" hidden></div>
  </div>
  <select id="csvColumnFilterMode">
    <option value="contains">包含</option>
    <option value="equals">等于</option>
  </select>
  <input id="csvColumnFilterValue" type="text">
  <label><input id="csvColumnFilterIgnoreCase" type="checkbox" checked>忽略大小写</label>
  <label><input id="csvColumnFilterIgnoreWhitespace" type="checkbox">忽略空格</label>
  <button id="csvColumnFilterAdd" type="button"></button>
  <button id="csvColumnFilterClear" type="button"></button>
  <div id="csvColumnFilterChips"></div>
  <button id="csvRowHeightToggle" type="button" data-mode="${rowMode}"></button>
</div>

<!-- Minimal find-replace DOM so webview-main.js's top-level event bindings don't crash -->
<div id="findReplaceWidget" class="replace-collapsed" style="display:none">
  <div id="replaceToggleGutter">
    <button id="replaceToggle" type="button" aria-expanded="false">›</button>
  </div>
  <input id="findInput" type="text">
  <input id="replaceInput" type="text">
  <div id="findStatus"></div>
  <button id="findPrev" type="button" disabled></button>
  <button id="findNext" type="button" disabled></button>
  <button id="findMenuButton" type="button" aria-expanded="false"></button>
  <div id="findOverflowMenu" role="menu" hidden>
    <button id="findOverflowPreserveCase" type="button" role="menuitemcheckbox" aria-checked="false"></button>
  </div>
  <button id="findClose" type="button"></button>
  <button id="findCaseToggle" type="button" aria-pressed="false"></button>
  <button id="findWordToggle" type="button" aria-pressed="false"></button>
  <button id="findRegexToggle" type="button" aria-pressed="false"></button>
  <button id="replaceCaseToggle" type="button" aria-pressed="false"></button>
  <button id="replaceOne" type="button"></button>
  <button id="replaceAll" type="button"></button>
</div>
</body></html>`;
}

export function createHarness(cfg: HarnessConfig): Harness {
  const mainJsPath = path.join(process.cwd(), '02-webview-表格界面', 'webview-main.js');
  const mainJs = fs.readFileSync(mainJsPath, 'utf8');
  const findReplaceJsPath = path.join(process.cwd(), '02-webview-表格界面', 'webview-find-replace.js');
  const findReplaceJs = fs.readFileSync(findReplaceJsPath, 'utf8');
  const filterPanelJsPath = path.join(process.cwd(), '02-webview-表格界面', 'webview-filter-panel.js');
  const filterPanelJs = fs.readFileSync(filterPanelJsPath, 'utf8');

  const html = buildHtml(cfg);
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    url: 'https://example.test/',
  });

  const { window } = dom;

  // webview-main.js 用 IntersectionObserver 做分块加载；我们测的是点击/拖动，给个 no-op。
  if (typeof window.IntersectionObserver === 'undefined') {
    window.IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() { return []; }
    };
  }

  // 模拟所有 <td>/<th> 的 getBoundingClientRect，让热区判断可算。
  // 每个单元格高度 24px（对齐 getMinRowHeight），宽 80px。
  const CELL_H = 24;
  const CELL_W = 80;
  const origGBCR = window.Element.prototype.getBoundingClientRect;
  window.Element.prototype.getBoundingClientRect = function () {
    const el = this as unknown as Element;
    if (el instanceof window.HTMLTableCellElement) {
      const tr = el.closest('tr');
      const tbl = el.closest('table');
      const allRows = tbl ? Array.from(tbl.querySelectorAll('tr')) : [];
      const rowIdx = tr ? allRows.indexOf(tr as any) : 0;
      const cells = tr ? Array.from((tr as HTMLTableRowElement).cells) : [];
      const colIdx = cells.indexOf(el as HTMLTableCellElement);
      const storedH = parseInt((el as HTMLElement).style.height || '0', 10) || CELL_H;
      const top = rowIdx * CELL_H;
      const left = colIdx * CELL_W;
      return {
        top,
        left,
        right: left + CELL_W,
        bottom: top + storedH,
        width: CELL_W,
        height: storedH,
        x: left,
        y: top,
        toJSON() { return this; },
      } as DOMRect;
    }
    return origGBCR.call(el);
  };

  // 捕获 postMessage，并在 window 上暴露 acquireVsCodeApi —— webview-main.js 启动时会调用它。
  const posted: PostedMessage[] = [];
  const state: { value: unknown } = { value: undefined };
  (window as any).acquireVsCodeApi = () => ({
    postMessage: (msg: PostedMessage) => posted.push(msg),
    getState: () => state.value,
    setState: (v: unknown) => { state.value = v; },
  });

  // 把 webview-main.js 以脚本形式注入（相当于 <script>…</script>）。
  const findReplaceScript = new window.Function(findReplaceJs);
  findReplaceScript.call(window);
  const script = new window.Function(mainJs);
  script.call(window);
  const filterPanelScript = new window.Function(filterPanelJs);
  filterPanelScript.call(window);

  const doc = window.document as Document;
  const table = doc.querySelector('table') as HTMLTableElement;

  const getHeader = (col: number) =>
    doc.querySelector<HTMLElement>(`th[data-col="${col}"]`);
  const getSortBtn = (col: number) =>
    doc.querySelector<HTMLElement>(`th[data-col="${col}"] .sort-btn`);
  const getCell = (row: number, col: number) =>
    doc.querySelector<HTMLElement>(`[data-row="${row}"][data-col="${col}"]`);

  const fireMouse: Harness['fireMouse'] = (type, target, opts = {}) => {
    const ev = new window.MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window,
      button: 0,
      buttons: type === 'mousemove' ? 1 : 0,
      clientX: opts.clientX ?? 0,
      clientY: opts.clientY ?? 0,
      ...opts,
    });
    target.dispatchEvent(ev);
  };

  const dragRowBottom: Harness['dragRowBottom'] = (cell, dy) => {
    const rect = (cell as HTMLElement).getBoundingClientRect();
    // 落在底边的热区中（bottom - 2px）
    const startX = rect.left + 4;
    const startY = rect.bottom - 2;
    fireMouse('mousemove', cell, { clientX: startX, clientY: startY });
    fireMouse('mousedown', cell, { clientX: startX, clientY: startY });
    fireMouse('mousemove', doc.body, { clientX: startX, clientY: startY + dy });
    fireMouse('mouseup', doc.body, { clientX: startX, clientY: startY + dy });
  };

  return {
    dom,
    window,
    document: doc,
    posted,
    table,
    getCell,
    getHeader,
    getSortBtn,
    fireMouse,
    dragRowBottom,
    destroy: () => dom.window.close(),
  };
}
