/**
 * Playwright harness: assembles a self-contained HTML page that mirrors the
 * DOM structure `CsvEditorProvider.updateWebviewContent` emits, then inlines
 * the real `webview-表格界面/main.js`. Loaded via `file://` — NO Node, NO jsdom,
 * NO extension host. Clicks & drags are real Chromium events.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

export interface HarnessRow {
  absRow: number;
  cells: string[];
}

export interface HarnessConfig {
  columns: number;
  header: HarnessRow;
  body: HarnessRow[];
  addSerialIndex?: boolean;
  fontSize?: number;
  rowHeightMode?: 'compact' | 'wrap';
}

const REPO_ROOT = path.resolve(__dirname, '..');

function buildDom(cfg: HarnessConfig): string {
  const cols = cfg.columns;
  const addSerial = !!cfg.addSerialIndex;
  const rowMode = cfg.rowHeightMode ?? 'compact';
  const fontSize = cfg.fontSize ?? 14;

  const headCells: string[] = [];
  if (addSerial) headCells.push('<th tabindex="0"></th>');
  for (let i = 0; i < cols; i++) {
    const label = cfg.header.cells[i] ?? '';
    headCells.push(
      `<th tabindex="0" data-row="${cfg.header.absRow}" data-col="${i}" ` +
        `style="min-width: 80px;">` +
        `<span class="th-content">` +
        `<span class="th-label">${label}</span>` +
        `<span class="sort-btn" data-sort-btn="1" role="button" aria-label="Sort column" title="点击切换：A-Z → Z-A → 原始"></span>` +
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

  return `
<style>
  html, body { margin: 0; padding: 16px; font-family: -apple-system, sans-serif; }
  table { border-collapse: collapse; }
  th, td { padding: 4px 10px; border: 1px solid #ccc; vertical-align: top; }
  td { overflow: hidden; }
  td .cell-body { display: block; white-space: pre-wrap; }
  table.row-compact td .cell-body { max-height: ${cellBodyMaxHeight}; overflow: hidden; }
  /* Sort indicator, mirrors runtime CSS */
  th[data-col] .sort-btn {
    display: inline-block;
    margin-left: 6px;
    width: 16px; height: 16px;
    text-align: center; line-height: 16px;
    cursor: pointer;
    opacity: 0.55;
    user-select: none;
  }
  th[data-col] .sort-btn::before { content: "\\2195"; display: inline-block; }
  th[data-col] .sort-btn:hover { opacity: 1; background: rgba(0,0,0,0.06); border-radius: 3px; }
  th.sort-asc .sort-btn, th.sort-desc .sort-btn { opacity: 1; }
  th.sort-asc .sort-btn::before  { content: "\\25B2"; }
  th.sort-desc .sort-btn::before { content: "\\25BC"; }
</style>

<div id="csv-root" class="table-container"
     data-sepcode="44"
     data-fontsize="${fontSize}"
     data-wheelzoomenabled="1"
     data-wheelzoominvert="0"
     data-nextchunkstart=""
     data-hasmorechunks="0">
  <table class="row-${rowMode}">
    <thead><tr>${headCells.join('')}</tr></thead>
    <tbody>${bodyRows.join('')}</tbody>
  </table>
</div>

<script id="__csvChunks" type="application/json">[]</script>
<script id="__csvColumnLabels" type="application/json">${JSON.stringify(cfg.header.cells)}</script>
<script id="__csvColumnFilters" type="application/json">{}</script>

<!-- Context menu + Floating filter panel + Find widget (main.js's top-level
     querySelectors touch these; shipping empty stubs so init doesn't crash) -->
<div id="contextMenu" style="display:none"></div>
<!-- Mirrors CsvEditorProvider.updateWebviewContent()'s float panel markup
     closely enough that event-binding regressions surface in the harness. -->
<div id="csvFloatPanel" style="position:fixed;right:16px;bottom:16px;z-index:1150;display:flex;align-items:center;flex-wrap:nowrap;gap:8px;max-width:calc(100vw - 32px);overflow-x:auto;overflow-y:hidden;white-space:nowrap;padding:6px 10px;border:1px solid #ccc;border-radius:6px;background:#fff;">
  <span style="font-weight:600;">过滤:</span>
  <span id="csvFilterStatus" style="color:#999;font-size:0.85em;"></span>
  <select id="csvColumnFilterColumn">
    ${cfg.header.cells.map((label, i) => `<option value="${i}">${i + 1}. ${label}</option>`).join('')}
  </select>
  <select id="csvColumnFilterMode">
    <option value="contains">包含</option>
    <option value="equals">等于</option>
  </select>
  <input id="csvColumnFilterValue" type="text" placeholder="过滤词，Enter 添加">
  <label><input id="csvColumnFilterIgnoreCase" type="checkbox" checked>忽略大小写</label>
  <label><input id="csvColumnFilterIgnoreWhitespace" type="checkbox">忽略空格</label>
  <button id="csvColumnFilterAdd" type="button">添加</button>
  <button id="csvColumnFilterClear" type="button">清空</button>
  <div id="csvColumnFilterChips" style="display:flex;flex-wrap:nowrap;gap:6px;max-width:min(360px,35vw);overflow-x:auto;overflow-y:hidden;"></div>
  <span style="width:1px;height:18px;background:#ccc;margin:0 2px;"></span>
  <span style="font-weight:600;">行高:</span>
  <button id="csvRowHeightToggle" type="button" data-mode="${rowMode}">${rowMode === 'compact' ? '紧凑' : '自然折行'}</button>
</div>
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
`;
}

/**
 * Writes an index.html into an OS temp dir that:
 *   - installs the acquireVsCodeApi shim that records every postMessage into
 *     `window.__posted`
 *   - renders the DOM structure
 *   - inlines webview-表格界面/main.js so Chromium runs the same bytes the webview
 *     would run
 * Returns the file:// URL to load.
 */
export function writeHarnessHtml(cfg: HarnessConfig): { url: string; dir: string } {
  const mainJs = fs.readFileSync(path.join(REPO_ROOT, 'webview-表格界面', 'main.js'), 'utf8');
  const findReplaceJs = fs.readFileSync(path.join(REPO_ROOT, 'webview-表格界面', 'webviewFindReplace.js'), 'utf8');
  const filterPanelJs = fs.readFileSync(path.join(REPO_ROOT, 'webview-表格界面', 'webviewFilterPanel.js'), 'utf8');

  const shim = `
<script>
  window.__posted = [];
  window.__state  = undefined;
  window.acquireVsCodeApi = function () {
    return {
      postMessage: function (msg) { window.__posted.push(msg); },
      setState:    function (s)   { window.__state = s; },
      getState:    function ()    { return window.__state; },
    };
  };
  // main.js uses IntersectionObserver for chunk loading; harmless noop.
  if (typeof window.IntersectionObserver === 'undefined') {
    window.IntersectionObserver = class {
      observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
    };
  }
</script>`;

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>csv-custom-pro e2e harness</title>
${shim}
</head><body>
${buildDom(cfg)}
<script>
${findReplaceJs}
</script>
<script>
${mainJs}
</script>
<script>
${filterPanelJs}
</script>
</body></html>`;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-pro-e2e-'));
  const file = path.join(dir, 'index.html');
  fs.writeFileSync(file, html, 'utf8');
  return { url: `file://${file}`, dir };
}
