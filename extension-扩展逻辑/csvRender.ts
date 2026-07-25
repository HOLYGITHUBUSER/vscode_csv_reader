import { ChunkRenderState, ChunkResponse } from './csvTypes';

export type CsvRenderHelpers = {
  formatCellContent(text: string, linkify: boolean): string;
  getMultilineCellTitleAttr(text: string): string;
  computeColumnWidths(data: string[][]): number[];
  estimateColumnDataType(column: string[]): string;
  getColumnColor(type: string, isDark: boolean, columnIndex: number, palette?: 'default' | 'cool' | 'warm'): string;
};

export type CsvTableRenderOptions = {
  data: string[][];
  treatHeader: boolean;
  addSerialIndex: boolean;
  hiddenRows: number;
  clickableLinks: boolean;
  columnColorMode: string;
  columnColorPalette: string;
  showTrailingEmptyRow: boolean;
  maxSerializedChunks?: number;
  isDark: boolean;
  helpers: CsvRenderHelpers;
};

export type CsvTableRenderResult = {
  tableHtml: string;
  chunksJson: string;
  colorCss: string;
  nextChunkStart: number;
  hasRemoteChunks: boolean;
  chunkState: ChunkRenderState | undefined;
};

// Larger initial page: users complained that only ~1000 rows felt available.
// Wide tables still scale down via MAX_CELLS_PER_CHUNK so a single chunk stays bounded.
const BASE_CHUNK_ROWS = 3000;
const MAX_CELLS_PER_CHUNK = 50000;
const MIN_CHUNK_ROWS = 10;

function cellBorder(isDark: boolean): string {
  return isDark ? '#555' : '#ccc';
}

function renderDataCell(
  row: string[],
  absRow: number,
  col: number,
  state: Pick<ChunkRenderState, 'columnWidths' | 'columnColors' | 'clickableLinks' | 'isDark'>,
  helpers: Pick<CsvRenderHelpers, 'formatCellContent' | 'getMultilineCellTitleAttr'>
): string {
  const rawValue = row[col] || '';
  const safe = helpers.formatCellContent(rawValue, state.clickableLinks);
  const titleAttr = helpers.getMultilineCellTitleAttr(rawValue);
  return `<td tabindex="0" style="min-width: ${Math.min(state.columnWidths[col] || 0, 100)}ch; max-width: 100ch; border: 1px solid ${cellBorder(state.isDark)}; color: ${state.columnColors[col]}; overflow: hidden;"${titleAttr} data-row="${absRow}" data-col="${col}"><div class="cell-body" style="white-space: pre-wrap; overflow-wrap: anywhere;">${safe}</div></td>`;
}

function renderSerialCell(absRow: number, displayIdx: number, state: Pick<ChunkRenderState, 'serialIndexWidthCh' | 'isDark'>): string {
  return `<td tabindex="0" style="min-width: ${state.serialIndexWidthCh}ch; max-width: ${state.serialIndexWidthCh}ch; border: 1px solid ${cellBorder(state.isDark)}; color: #888;" data-row="${absRow}" data-col="-1">${displayIdx}</td>`;
}

function renderVirtualRow(absRow: number, displayIdx: number, state: ChunkRenderState): string {
  const idxCell = state.addSerialIndex ? renderSerialCell(absRow, displayIdx, state) : '';
  const dataCells = Array.from(
    { length: state.numColumns },
    (_, i) => `<td tabindex="0" style="min-width: ${Math.min(state.columnWidths[i] || 0, 100)}ch; max-width: 100ch; border: 1px solid ${cellBorder(state.isDark)}; color: ${state.columnColors[i]}; overflow: hidden;" data-row="${absRow}" data-col="${i}"></td>`
  ).join('');
  return `<tr>${idxCell}${dataCells}</tr>`;
}

export function renderChunkFromState(
  state: ChunkRenderState,
  start: number,
  helpers: Pick<CsvRenderHelpers, 'formatCellContent' | 'getMultilineCellTitleAttr'>
): ChunkResponse {
  if (start < state.allRowsCount) {
    const end = Math.min(start + state.chunkRows, state.allRowsCount);
    const html = state.allRows.slice(start, end).map((row, localR) => {
      const absRow = state.startAbs + start + localR;
      const displayIdx = start + localR + 1;
      let cells = '';
      for (let cIdx = 0; cIdx < state.numColumns; cIdx++) {
        cells += renderDataCell(row, absRow, cIdx, state, helpers);
      }
      const idxCell = state.addSerialIndex ? renderSerialCell(absRow, displayIdx, state) : '';
      return `<tr>${idxCell}${cells}</tr>`;
    }).join('');

    if (end < state.allRowsCount) {
      return { html, nextStart: end, done: false };
    }
    if (state.includeTrailingEmptyRow) {
      return { html, nextStart: state.allRowsCount, done: false };
    }
    return { html, nextStart: -1, done: true };
  }

  if (start === state.allRowsCount && state.includeTrailingEmptyRow) {
    const virtualAbs = state.startAbs + state.allRowsCount;
    const displayIdx = state.allRowsCount + 1;
    return { html: renderVirtualRow(virtualAbs, displayIdx, state), nextStart: -1, done: true };
  }

  return { html: '', nextStart: -1, done: true };
}

export function generateTableAndChunks(options: CsvTableRenderOptions): CsvTableRenderResult {
  const {
    data,
    addSerialIndex,
    hiddenRows,
    clickableLinks,
    columnColorMode,
    columnColorPalette,
    showTrailingEmptyRow,
    isDark,
    helpers
  } = options;
  let headerFlag = options.treatHeader;
  const totalRows = data.length;
  const offset = Math.min(Math.max(0, hiddenRows), totalRows);

  let headerRow: string[] = [];
  let bodyData: string[][] = [];
  if (totalRows === 0 || offset >= totalRows) {
    headerFlag = false;
    bodyData = [];
  } else if (headerFlag) {
    headerRow = data[offset];
    bodyData = data.slice(offset + 1);
  } else {
    bodyData = data.slice(offset);
  }
  const visibleForWidth = headerFlag ? [headerRow, ...bodyData] : bodyData;
  let numColumns = visibleForWidth.reduce((max, row) => Math.max(max, row.length), 0);
  if (numColumns === 0) numColumns = 1;

  const columnData = Array.from({ length: numColumns }, (_, i) => bodyData.map(row => row[i] || ''));
  const columnTypes = columnData.map(col => helpers.estimateColumnDataType(col));
  const useThemeForeground = columnColorMode === 'theme';
  const palette = columnColorPalette === 'cool'
    ? 'cool'
    : (columnColorPalette === 'warm' ? 'warm' : 'default');
  const columnColors = useThemeForeground
    ? Array.from({ length: numColumns }, () => 'var(--vscode-editor-foreground)')
    : columnTypes.map((type, i) => helpers.getColumnColor(type, isDark, i, palette));
  const columnWidths = helpers.computeColumnWidths(visibleForWidth);

  const allRows = headerFlag ? data.slice(offset + 1) : data.slice(offset);
  const allRowsCount = allRows.length;
  const chunkRows = Math.max(
    MIN_CHUNK_ROWS,
    Math.min(BASE_CHUNK_ROWS, Math.floor(MAX_CELLS_PER_CHUNK / Math.max(1, numColumns)))
  );
  const includeTrailingEmptyRow = showTrailingEmptyRow || allRowsCount === 0;
  const serialIndexMaxDisplay = includeTrailingEmptyRow ? allRowsCount + 1 : allRowsCount;
  const serialIndexWidthCh = Math.max(4, String(Math.max(1, serialIndexMaxDisplay)).length + 1);
  const chunks: string[] = [];
  const chunked = allRowsCount > chunkRows;
  let nextChunkStart = -1;
  const safeMaxSerializedChunks = Number.isFinite(options.maxSerializedChunks)
    ? Math.max(0, Math.trunc(options.maxSerializedChunks ?? 0))
    : 0;
  let serializedChunkCount = 0;

  const chunkState: ChunkRenderState = {
    startAbs: headerFlag ? offset + 1 : offset,
    allRows,
    allRowsCount,
    chunkRows,
    includeTrailingEmptyRow,
    addSerialIndex,
    numColumns,
    columnWidths,
    columnColors,
    clickableLinks,
    isDark,
    serialIndexWidthCh
  };

  if (chunked) {
    for (let i = chunkRows; i < allRowsCount; i += chunkRows) {
      if (serializedChunkCount >= safeMaxSerializedChunks) {
        nextChunkStart = i;
        break;
      }
      chunks.push(renderChunkFromState(chunkState, i, helpers).html);
      serializedChunkCount++;
    }
  }

  const colorCss = useThemeForeground
    ? ''
    : columnColors.map((hex, i) => `td[data-col="${i}"], th[data-col="${i}"] { color: ${hex}; }`).join('');

  let tableHtml = `<table>`;
  if (headerFlag) {
    tableHtml += `<thead><tr>${addSerialIndex ? `<th tabindex="0" style="min-width: ${serialIndexWidthCh}ch; max-width: ${serialIndexWidthCh}ch; border: 1px solid ${cellBorder(isDark)}; background-color: ${isDark ? '#1e1e1e' : '#ffffff'}; color: #888;"></th>` : ''}`;
    for (let i = 0; i < numColumns; i++) {
      const safe = helpers.formatCellContent(headerRow[i] || '', clickableLinks);
      tableHtml += `<th tabindex="0" style="min-width: max(${Math.min(columnWidths[i] || 0, 100)}ch, 60px); max-width: 100ch; border: 1px solid ${cellBorder(isDark)}; background-color: ${isDark ? '#1e1e1e' : '#ffffff'}; color: ${columnColors[i]}; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;" data-row="${offset}" data-col="${i}"><span class="th-content"><span class="th-label">${safe}</span><span class="sort-btn" data-sort-btn="1" role="button" aria-label="Sort column" title="点击切换：A-Z → Z-A → 原始"></span></span></th>`;
    }
    tableHtml += `</tr></thead><tbody>`;
  } else {
    tableHtml += `<tbody>`;
  }

  const initialRows = chunked ? allRows.slice(0, chunkRows) : allRows;
  initialRows.forEach((row, r) => {
    const absRow = (headerFlag ? offset + 1 : offset) + r;
    const displayIdx = r + 1;
    const idxCell = addSerialIndex ? renderSerialCell(absRow, displayIdx, chunkState) : '';
    let dataCells = '';
    for (let i = 0; i < numColumns; i++) {
      dataCells += renderDataCell(row, absRow, i, chunkState, helpers);
    }
    tableHtml += `<tr>${idxCell}${dataCells}</tr>`;
  });

  if (!chunked && includeTrailingEmptyRow) {
    const virtualAbs = (headerFlag ? offset + 1 : offset) + initialRows.length;
    tableHtml += renderVirtualRow(virtualAbs, initialRows.length + 1, chunkState);
  }

  tableHtml += `</tbody></table>`;

  if (chunked && includeTrailingEmptyRow) {
    if (nextChunkStart === -1 && serializedChunkCount < safeMaxSerializedChunks) {
      const virtualAbs = chunkState.startAbs + allRowsCount;
      chunks.push(renderVirtualRow(virtualAbs, allRowsCount + 1, chunkState));
    } else if (nextChunkStart === -1) {
      nextChunkStart = allRowsCount;
    }
  }

  const hasRemoteChunks = nextChunkStart >= 0;
  return {
    tableHtml,
    chunksJson: JSON.stringify(chunks),
    colorCss,
    nextChunkStart,
    hasRemoteChunks,
    chunkState: chunked ? chunkState : undefined
  };
}
