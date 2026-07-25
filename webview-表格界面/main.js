// Webview script moved out of inline <script>. Kept logic changes minimal.

document.body.setAttribute('tabindex', '0');
try { document.body.focus({ preventScroll: true }); } catch { try { document.body.focus(); } catch {} }

const vscode = acquireVsCodeApi();

const root = document.getElementById('csv-root');
const CSV_SEPARATOR = String.fromCodePoint(parseInt(root?.dataset?.sepcode || '44', 10)); // default ','
const parsePositiveNumber = value => {
  const parsed = typeof value === 'string' ? Number.parseFloat(value) : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
};
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const configuredFontSizePx = parsePositiveNumber(root?.dataset?.fontsize);
const computedFontSizePx = parsePositiveNumber(window.getComputedStyle(document.body).fontSize);
const BASE_FONT_SIZE_PX = configuredFontSizePx ?? computedFontSizePx ?? 14;
const MOUSE_WHEEL_ZOOM_ENABLED = root?.dataset?.wheelzoomenabled !== '0';
const MOUSE_WHEEL_ZOOM_INVERTED = root?.dataset?.wheelzoominvert === '1';
const ZOOM_STEP = 0.1;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3.0;
let zoomScale = 1;
const getMinRowHeight = () => Math.max(22, Math.round(BASE_FONT_SIZE_PX * zoomScale * 1.6));

let lastContextIsHeader = false;   // remembers whether we right-clicked a <th>
let isUpdating = false, isSelecting = false, anchorCell = null, rangeEndCell = null, currentSelection = [];
let startCell = null, endCell = null, selectionMode = "cell";
let editingCell = null, originalCellValue = "";
// Edit mode:
//  - 'quick': started by typing a character (not Enter)
//  - 'detail': started by Enter or double-click
let editMode = null; // 'quick' | 'detail' | null
const DRAG_THRESHOLD_PX = 4;
const RESIZE_HANDLE_PX = 8;
let resizeState = null;
let reorderState = null;
let currentSortCol = null;
let currentSortAsc = true;
try {
  const saved = vscode.getState && vscode.getState();
  if (saved && typeof saved.sortCol === 'number') {
    currentSortCol = saved.sortCol;
    currentSortAsc = !!saved.sortAsc;
  }
} catch {}
const persistSortState = () => {
  try {
    const prev = (vscode.getState && vscode.getState()) || {};
    vscode.setState({ ...prev, sortCol: currentSortCol, sortAsc: currentSortAsc });
  } catch {}
};

const table = document.querySelector('#csv-root table');
const scrollContainer = document.querySelector('.table-container');
const COMPACT_ORIG_HTML_ATTR = 'data-orig-html';
const replaceCompactNewlineText = rootNode => {
  const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  for (const node of textNodes) {
    node.nodeValue = (node.nodeValue || '').replace(/\r\n|\r|\n/g, '↵');
  }
};
const applyCompactNewlineMarkers = (rootNode = table) => {
  if (!rootNode) return;
  rootNode.querySelectorAll(`td .cell-body:not([${COMPACT_ORIG_HTML_ATTR}])`).forEach(div => {
    div.setAttribute(COMPACT_ORIG_HTML_ATTR, div.innerHTML);
    replaceCompactNewlineText(div);
  });
};
const restoreCompactNewlineMarkers = (rootNode = table) => {
  if (!rootNode) return;
  rootNode.querySelectorAll(`td .cell-body[${COMPACT_ORIG_HTML_ATTR}]`).forEach(div => {
    div.innerHTML = div.getAttribute(COMPACT_ORIG_HTML_ATTR) || '';
    div.removeAttribute(COMPACT_ORIG_HTML_ATTR);
  });
};
const getCellTextForData = cell => {
  const compactBody = cell?.querySelector?.(`:scope > .cell-body[${COMPACT_ORIG_HTML_ATTR}]`);
  if (!compactBody) return cell ? cell.textContent : '';
  const tmp = document.createElement('div');
  tmp.innerHTML = compactBody.getAttribute(COMPACT_ORIG_HTML_ATTR) || '';
  return tmp.textContent || '';
};
const dragIndicator = document.createElement('div');
dragIndicator.style.position = 'fixed';
dragIndicator.style.pointerEvents = 'none';
dragIndicator.style.zIndex = '20000';
dragIndicator.style.background = '#0a84ff';
dragIndicator.style.display = 'none';
document.body.appendChild(dragIndicator);
let columnSizeState = {};
let rowSizeState = {};

const normalizeSizeState = (raw, minSize) => {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw)) {
    const idx = parseInt(k, 10);
    const size = Number(v);
    if (!Number.isFinite(idx) || idx < 0) continue;
    if (!Number.isFinite(size) || size < minSize) continue;
    out[String(idx)] = Math.round(size);
  }
  return out;
};

/** Apply persisted col/row sizes. Prefer a subtree (new chunk) over full-table scans. */
const applySizeStateToRenderedCells = (root = table) => {
  if (!root) return;
  const scope = root.querySelectorAll ? root : table;
  for (const [col, width] of Object.entries(columnSizeState)) {
    const px = Math.max(40, Math.round(Number(width)));
    scope.querySelectorAll(`[data-col="${col}"]`).forEach(cell => {
      cell.style.width = `${px}px`;
      cell.style.minWidth = `${px}px`;
      cell.style.maxWidth = `${px}px`;
    });
  }
  for (const [row, height] of Object.entries(rowSizeState)) {
    const px = Math.max(getMinRowHeight(), Math.round(Number(height)));
    scope.querySelectorAll(`[data-row="${row}"]`).forEach(cell => {
      cell.style.height = `${px}px`;
      cell.style.minHeight = `${px}px`;
      const body = cell.querySelector(':scope > .cell-body');
      if (body) {
        body.style.maxHeight = 'none';
        body.style.overflow = 'hidden';
      }
    });
  }
};

const getFirstDataRow = () => {
  const cells = Array.from(table.querySelectorAll('tbody td[data-col]:not([data-col="-1"])'));
  let min = Infinity;
  for (const el of cells) {
    const v = parseInt(el.getAttribute('data-row') || 'NaN', 10);
    if (!Number.isNaN(v)) min = Math.min(min, v);
  }
  return Number.isFinite(min) ? min : 0;
};

const setZoomScale = (nextScale, persist = true) => {
  const normalized = clamp(Math.round(nextScale * 100) / 100, ZOOM_MIN, ZOOM_MAX);
  if (Math.abs(normalized - zoomScale) < 0.001) {
    return false;
  }
  zoomScale = normalized;
  document.body.style.fontSize = `${Math.max(1, BASE_FONT_SIZE_PX * zoomScale)}px`;
  applySizeStateToRenderedCells();
  if (persist) {
    persistState();
  }
  return true;
};
const zoomIn = () => setZoomScale(zoomScale + ZOOM_STEP);
const zoomOut = () => setZoomScale(zoomScale - ZOOM_STEP);
const resetZoom = () => setZoomScale(1);
const isZoomModifier = e => (e.ctrlKey || e.metaKey) && !e.altKey;
const isZoomInShortcut = e => e.code === 'NumpadAdd' || e.key === '+' || e.key === '=';
const isZoomOutShortcut = e => e.code === 'NumpadSubtract' || e.key === '-' || e.key === '_';
const isZoomResetShortcut = e => e.key === '0';
const maybeHandleZoomShortcut = e => {
  if (!isZoomModifier(e)) return false;
  if (isZoomInShortcut(e)) {
    e.preventDefault();
    zoomIn();
    return true;
  }
  if (isZoomOutShortcut(e)) {
    e.preventDefault();
    zoomOut();
    return true;
  }
  if (isZoomResetShortcut(e)) {
    e.preventDefault();
    resetZoom();
    return true;
  }
  return false;
};

// Persist/restore view state (scroll + selection) across webview reloads
const persistState = () => {
  try {
    const st = vscode.getState() || {};
    const anchor = anchorCell ? getCellCoords(anchorCell) : null;
    const nextState = {
      ...st,
      scrollX: scrollContainer ? scrollContainer.scrollLeft : 0,
      scrollY: scrollContainer ? scrollContainer.scrollTop : (window.scrollY || window.pageYOffset || 0),
      anchorRow: anchor ? anchor.row : undefined,
      anchorCol: anchor ? anchor.col : undefined,
      columnSizes: { ...columnSizeState },
      rowSizes: { ...rowSizeState },
      zoomScale
    };
    vscode.setState(nextState);
  } catch {}
};

const restoreState = () => {
  try {
    const st = vscode.getState() || {};
    const restoredZoom = parsePositiveNumber(st.zoomScale);
    setZoomScale(restoredZoom ?? 1, false);
    columnSizeState = normalizeSizeState(st.columnSizes, 40);
    rowSizeState = normalizeSizeState(st.rowSizes, getMinRowHeight());
    applySizeStateToRenderedCells();
    if (typeof st.scrollX === 'number' && scrollContainer) {
      scrollContainer.scrollLeft = st.scrollX;
    }
    // If the saved scroll position is beyond current height (because only the first
    // chunk is mounted), progressively load more chunks until we can restore it.
    if (typeof st.scrollY === 'number') {
      if (scrollContainer) {
        let guard = 100;
      while (
        typeof window.__csvLoadNextChunk === 'function' &&
        (scrollContainer.scrollHeight - scrollContainer.clientHeight < st.scrollY) &&
        guard-- > 0
      ) {
        if (!window.__csvLoadNextChunk()) break;
      }
      applySizeStateToRenderedCells();
      scrollContainer.scrollTop = st.scrollY;
    } else {
      window.scrollTo(0, st.scrollY);
      }
    }
    if (typeof st.anchorRow === 'number' && typeof st.anchorCol === 'number') {
      const tag = (hasHeader && st.anchorRow === 0 ? 'th' : 'td');
      let sel = table.querySelector(`${tag}[data-row="${st.anchorRow}"][data-col="${st.anchorCol}"]`);
      // If not present yet (due to chunking), load chunks until available or exhausted
      if (!sel && typeof window.__csvLoadNextChunk === 'function') {
        let guard = 100; // prevent infinite loops
        while (!sel && typeof window.__csvLoadNextChunk === 'function' && guard-- > 0) {
          if (!window.__csvLoadNextChunk()) break;
          sel = table.querySelector(`${tag}[data-row="${st.anchorRow}"][data-col="${st.anchorCol}"]`);
        }
      }
      applySizeStateToRenderedCells();
      if (sel) {
        clearSelection();
        sel.classList.add('selected');
        currentSelection.push(sel);
        anchorCell = sel; rangeEndCell = sel;
        try { sel.focus({ preventScroll: true }); } catch { try { sel.focus(); } catch {} }
      }
    }
    // Re-apply scroll after any late chunk loads from selection restoration
    if (typeof st.scrollY === 'number' && scrollContainer) {
      scrollContainer.scrollTop = st.scrollY;
    }
  } catch {}
};

/* ──────────── VIRTUAL / WINDOWED SCROLL LOADER ──────────── */
// Large CSVs use a sliding window: only ~viewport+overscan rows stay in the DOM.
// Small CSVs keep the older append-on-scroll path.
const chunkTemplate = document.getElementById('__csvChunks');
let csvChunks = [];
try {
  csvChunks = chunkTemplate ? JSON.parse(chunkTemplate.textContent || '[]') : [];
} catch (e) {
  csvChunks = [];
}
let remoteNextChunkStart = Number.parseInt(root?.dataset?.nextchunkstart || '', 10);
if (!Number.isInteger(remoteNextChunkStart) || remoteNextChunkStart < 0) {
  remoteNextChunkStart = -1;
}
let remoteHasMoreChunks = root?.dataset?.hasmorechunks === '1' && remoteNextChunkStart >= 0;
let remoteChunkRequestInFlight = false;
let remoteChunkRequestedStart = -1;
let remoteChunkRequestSeq = 0;
let remoteChunkRequestedCount = 0;
let pendingEnsureTarget = null;
let nearBottom = () => false;
let loadNextChunk = () => false;
let primeChunkObserver = () => {};
/** Jump virtual window so abs row is in DOM (used by keyboard/find). */
let ensureBodyIndexVisible = (_bodyIndex) => {};

const totalBodyRowsMeta = Number.parseInt(root?.dataset?.totalbodyrows || '0', 10) || 0;
const bodyStartAbsMeta = Number.parseInt(root?.dataset?.bodystartabs || '0', 10) || 0;
const includeVirtualRowMeta = root?.dataset?.includevirtualrow === '1';
const metaNumColumns = Number.parseInt(root?.dataset?.numcolumns || '0', 10) || 0;
const totalLogicalRows = totalBodyRowsMeta + (includeVirtualRowMeta ? 1 : 0);
// Windowed mode once there is enough body data that append-all would jank.
const USE_WINDOWED_SCROLL = totalLogicalRows >= 400 && !!table;

const requestRemoteChunk = (startOverride, countOverride) => {
  if (remoteChunkRequestInFlight) return;
  const start = Number.isInteger(startOverride) ? startOverride : remoteNextChunkStart;
  if (!Number.isInteger(start) || start < 0) {
    if (!USE_WINDOWED_SCROLL) remoteHasMoreChunks = false;
    return;
  }
  if (!USE_WINDOWED_SCROLL && !remoteHasMoreChunks) return;
  remoteChunkRequestInFlight = true;
  remoteChunkRequestedStart = start;
  remoteChunkRequestedCount = Number.isInteger(countOverride) && countOverride > 0 ? countOverride : 0;
  remoteChunkRequestSeq += 1;
  const payload = { type: 'requestChunk', start, requestId: remoteChunkRequestSeq };
  if (remoteChunkRequestedCount > 0) payload.count = remoteChunkRequestedCount;
  vscode.postMessage(payload);
};

if (USE_WINDOWED_SCROLL) {
  const tbody = table.tBodies[0];
  const OVERSCAN = 40;
  const MAX_WINDOW = 160; // hard cap on real <tr> rows in DOM
  const cache = new Map(); // key `${start}:${count}` -> html
  let rowHeight = getMinRowHeight();
  let windowStart = 0; // body index of first real data row in window
  let windowCount = 0;
  let appliedStart = -1;
  let appliedCount = -1;
  let scrollRaf = 0;
  let numCols = metaNumColumns;
  if (!numCols && tbody) {
    const sample = tbody.querySelector('tr:not(.csv-vspacer)');
    numCols = sample ? sample.children.length : 1;
  }
  numCols = Math.max(1, numCols);

  // Measure real row height from first painted row (compact is stable).
  try {
    const sampleRow = tbody && tbody.querySelector('tr:not(.csv-vspacer)');
    if (sampleRow) {
      const h = sampleRow.getBoundingClientRect().height;
      if (h > 8) rowHeight = h;
    }
  } catch {}

  const makeSpacer = (kind, heightPx) => {
    const tr = document.createElement('tr');
    tr.className = `csv-vspacer csv-vspacer-${kind}`;
    tr.style.height = `${Math.max(0, Math.round(heightPx))}px`;
    const td = document.createElement('td');
    td.colSpan = numCols;
    td.style.height = 'inherit';
    tr.appendChild(td);
    return tr;
  };

  const countDataRowsInHtml = (html) => {
    if (!html) return 0;
    // Cheap count: each data row is a <tr> (spacers are not in server HTML).
    const matches = html.match(/<tr\b/gi);
    return matches ? matches.length : 0;
  };

  const applyWindowHtml = (start, html) => {
    if (!tbody) return;
    const count = countDataRowsInHtml(html);
    const topH = start * rowHeight;
    const bottomH = Math.max(0, (totalLogicalRows - start - count) * rowHeight);
    const holder = document.createElement('tbody');
    holder.innerHTML = html || '';
    const frag = document.createDocumentFragment();
    frag.appendChild(makeSpacer('top', topH));
    while (holder.firstChild) {
      frag.appendChild(holder.firstChild);
    }
    frag.appendChild(makeSpacer('bottom', bottomH));
    // Preserve scrollTop across re-render.
    const keepY = scrollContainer ? scrollContainer.scrollTop : 0;
    const keepX = scrollContainer ? scrollContainer.scrollLeft : 0;
    tbody.replaceChildren(frag);
    applySizeStateToRenderedCells(tbody);
    if (table.classList.contains('row-compact')) {
      applyCompactNewlineMarkers(tbody);
    }
    if (scrollContainer) {
      scrollContainer.scrollTop = keepY;
      scrollContainer.scrollLeft = keepX;
    }
    windowStart = start;
    windowCount = count;
    appliedStart = start;
    appliedCount = count;
    window.dispatchEvent(new Event('csvChunkLoaded'));
  };

  const fetchWindow = (start, count) => {
    const s = Math.max(0, Math.min(start, Math.max(0, totalLogicalRows - 1)));
    const c = Math.max(1, Math.min(count, MAX_WINDOW));
    const key = `${s}:${c}`;
    if (cache.has(key)) {
      applyWindowHtml(s, cache.get(key));
      return;
    }
    requestRemoteChunk(s, c);
  };

  const desiredWindow = () => {
    if (!scrollContainer) return { start: 0, count: Math.min(MAX_WINDOW, totalLogicalRows) };
    const viewRows = Math.max(8, Math.ceil(scrollContainer.clientHeight / Math.max(8, rowHeight)));
    const count = Math.min(MAX_WINDOW, viewRows + OVERSCAN * 2);
    let start = Math.floor(scrollContainer.scrollTop / Math.max(8, rowHeight)) - OVERSCAN;
    start = Math.max(0, Math.min(start, Math.max(0, totalLogicalRows - count)));
    return { start, count };
  };

  const syncWindow = (force = false) => {
    const { start, count } = desiredWindow();
    // Skip tiny moves to avoid thrashing while still tracking the viewport.
    if (!force && appliedStart >= 0 && Math.abs(start - appliedStart) < Math.floor(OVERSCAN / 2) && count === appliedCount) {
      return;
    }
    fetchWindow(start, count);
  };

  // Initial: keep first paint rows but install spacers so total scroll height is correct.
  {
    const existing = tbody ? Array.from(tbody.querySelectorAll('tr:not(.csv-vspacer)')) : [];
    const initialCount = existing.length;
    windowStart = 0;
    windowCount = initialCount;
    appliedStart = 0;
    appliedCount = initialCount;
    if (tbody && totalLogicalRows > initialCount) {
      const bottomH = (totalLogicalRows - initialCount) * rowHeight;
      tbody.appendChild(makeSpacer('bottom', bottomH));
    }
    // Cache initial HTML for 0:initialCount if possible
    if (initialCount > 0 && tbody) {
      const clone = existing.map(tr => tr.outerHTML).join('');
      cache.set(`0:${initialCount}`, clone);
    }
  }

  ensureBodyIndexVisible = (bodyIndex) => {
    const idx = Math.max(0, Math.min(bodyIndex, Math.max(0, totalLogicalRows - 1)));
    if (idx >= windowStart && idx < windowStart + windowCount) return;
    const count = Math.min(MAX_WINDOW, Math.max(80, windowCount || 120));
    const start = Math.max(0, Math.min(idx - Math.floor(count / 3), Math.max(0, totalLogicalRows - count)));
    fetchWindow(start, count);
  };

  loadNextChunk = () => {
    // Compatibility shim: advance one window "page" downward.
    const next = Math.min(windowStart + Math.max(20, Math.floor(windowCount * 0.75)), Math.max(0, totalLogicalRows - 1));
    ensureBodyIndexVisible(next);
    return true;
  };
  window.__csvLoadNextChunk = loadNextChunk;
  window.__csvEnsureBodyIndex = ensureBodyIndexVisible;

  nearBottom = () => {
    if (!scrollContainer) return false;
    const remain = scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight;
    return remain < rowHeight * 4;
  };
  primeChunkObserver = () => {};

  const onScroll = () => {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      syncWindow(false);
    });
  };
  if (scrollContainer) {
    scrollContainer.addEventListener('scroll', onScroll, { passive: true });
  } else {
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  // Handle window responses (shared chunkData path sets cache via hook below).
  window.__csvOnWindowChunk = (start, html, countHint) => {
    const count = countHint || countDataRowsInHtml(html) || remoteChunkRequestedCount || 80;
    const key = `${start}:${count}`;
    if (html) {
      cache.set(key, html);
      // Bound cache size
      if (cache.size > 12) {
        const first = cache.keys().next().value;
        cache.delete(first);
      }
    }
    // Only apply if this matches the latest desired window (or we have no window yet).
    const desired = desiredWindow();
    if (start === desired.start || Math.abs(start - desired.start) <= OVERSCAN || appliedStart < 0) {
      applyWindowHtml(start, html || cache.get(key) || '');
    }
  };

} else if (csvChunks.length || remoteHasMoreChunks) {
  // ── Small-file append path (unchanged idea, lighter than full virtual) ──
  const tbody = table.tBodies[0];
  let loading = false;
  let scrollLoadScheduled = false;

  const afterChunkInserted = () => {
    window.dispatchEvent(new Event('csvChunkLoaded'));
    if (!csvChunks.length) requestRemoteChunk();
    primeChunkObserver();
  };

  const appendChunkHtmlBatched = (html) => {
    if (!tbody || !html) {
      loading = false;
      afterChunkInserted();
      return;
    }
    const holder = document.createElement('tbody');
    holder.innerHTML = html;
    const rows = Array.from(holder.children);
    let index = 0;
    const BATCH = 48;
    const step = () => {
      const frag = document.createDocumentFragment();
      const end = Math.min(index + BATCH, rows.length);
      while (index < end) frag.appendChild(rows[index++]);
      applySizeStateToRenderedCells(frag);
      if (table.classList.contains('row-compact')) applyCompactNewlineMarkers(frag);
      tbody.appendChild(frag);
      if (index < rows.length) requestAnimationFrame(step);
      else {
        loading = false;
        afterChunkInserted();
      }
    };
    requestAnimationFrame(step);
  };

  loadNextChunk = () => {
    if (loading || !tbody) return false;
    if (!csvChunks.length) {
      requestRemoteChunk();
      return false;
    }
    loading = true;
    const html = csvChunks.shift();
    if (!html) {
      loading = false;
      return false;
    }
    appendChunkHtmlBatched(html);
    return true;
  };
  window.__csvLoadNextChunk = loadNextChunk;

  nearBottom = (px = 600) => {
    if (!scrollContainer) return false;
    return scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight < px;
  };

  const io = new IntersectionObserver((entries) => {
    if (entries[0] && entries[0].isIntersecting) {
      loadNextChunk();
      const last = tbody && tbody.querySelector('tr:last-child');
      if (last) io.observe(last);
    }
  }, { root: scrollContainer || null, rootMargin: '0px 0px 800px 0px' });

  primeChunkObserver = () => {
    const last = tbody && tbody.querySelector('tr:last-child');
    if (last) io.observe(last);
  };
  primeChunkObserver();

  const scrollHandler = () => {
    if (scrollLoadScheduled) return;
    if (!csvChunks.length && !remoteHasMoreChunks) return;
    if (!nearBottom()) return;
    scrollLoadScheduled = true;
    requestAnimationFrame(() => {
      scrollLoadScheduled = false;
      if (!nearBottom()) return;
      if (!loadNextChunk()) requestRemoteChunk();
    });
  };
  if (scrollContainer) scrollContainer.addEventListener('scroll', scrollHandler, { passive: true });
  else window.addEventListener('scroll', scrollHandler, { passive: true });
}

const ensureTargetStep = () => {
  if (!pendingEnsureTarget) return;
  const { row, col } = pendingEnsureTarget;
  const sel = table.querySelector(`td[data-row="${row}"][data-col="${col}"], th[data-row="${row}"][data-col="${col}"]`);
  if (sel) {
    pendingEnsureTarget = null;
    return;
  }
  pendingEnsureTarget.guard -= 1;
  if (pendingEnsureTarget.guard <= 0) {
    pendingEnsureTarget = null;
    return;
  }
  if (USE_WINDOWED_SCROLL) {
    const bodyIndex = Math.max(0, row - bodyStartAbsMeta);
    ensureBodyIndexVisible(bodyIndex);
    return;
  }
  if (!remoteHasMoreChunks && !csvChunks.length) {
    pendingEnsureTarget = null;
    return;
  }
  if (!loadNextChunk()) requestRemoteChunk();
};
window.addEventListener('csvChunkLoaded', ensureTargetStep);
/* ───────── END VIRTUAL-SCROLL LOADER ───────── */

// Restore state after initial DOM is ready
restoreState();
setTimeout(() => { try { restoreState(); } catch {} }, 0);
requestAnimationFrame(() => { try { restoreState(); } catch {} });

// Throttle scroll persistence — setState every wheel tick was a jank source on large tables.
let persistScrollRaf = 0;
const schedulePersistState = () => {
  if (persistScrollRaf) return;
  persistScrollRaf = requestAnimationFrame(() => {
    persistScrollRaf = 0;
    persistState();
  });
};
if (scrollContainer) {
  scrollContainer.addEventListener('scroll', schedulePersistState, { passive: true });
} else {
  window.addEventListener('scroll', schedulePersistState, { passive: true });
}

// Persist on blur/visibility change and restore on focus/visibility
window.addEventListener('blur', () => { persistState(); }, { passive: true });
window.addEventListener('focus', () => {
  setTimeout(() => { try { restoreState(); } catch {} }, 0);
}, { passive: true });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    persistState();
  } else if (document.visibilityState === 'visible') {
    setTimeout(() => { try { restoreState(); } catch {} }, 0);
  }
});

const handleZoomWheel = e => {
  if (!MOUSE_WHEEL_ZOOM_ENABLED) return;
  if (!isZoomModifier(e)) return;
  if (Math.abs(e.deltaY) < 0.1) return;
  e.preventDefault();
  const naturalDirection = e.deltaY < 0 ? 1 : -1;
  const direction = MOUSE_WHEEL_ZOOM_INVERTED ? -naturalDirection : naturalDirection;
  if (direction > 0) {
    zoomIn();
  } else {
    zoomOut();
  }
};
window.addEventListener('wheel', handleZoomWheel, { passive: false });

const hasHeader = document.querySelector('thead') !== null;
const getCellCoords = cell => ({ row: parseInt(cell.getAttribute('data-row')), col: parseInt(cell.getAttribute('data-col')) });
const clearSelection = () => { currentSelection.forEach(c => c.classList.remove('selected')); currentSelection = []; };
const contextMenu = document.getElementById('contextMenu');

/* ──────── Cell full-text preview (replaces un-copyable native title tooltips) ──────── */
const cellPreview = document.getElementById('csvCellPreview');
const cellPreviewBody = document.getElementById('csvPreviewBody');
const cellPreviewCopyBtn = document.getElementById('csvPreviewCopy');
const cellPreviewCloseBtn = document.getElementById('csvPreviewClose');
let cellPreviewAnchor = null;
let cellPreviewHideTimer = 0;
let cellPreviewShowTimer = 0;

const getFullCellText = cell => {
  if (!cell) return '';
  // Prefer data-full-text (multiline / long values stored for preview).
  if (cell.hasAttribute('data-full-text')) {
    return cell.getAttribute('data-full-text') || '';
  }
  // Legacy native title fallback.
  if (cell.hasAttribute('title') && cell.getAttribute('title')) {
    return cell.getAttribute('title') || '';
  }
  return getCellTextForData(cell);
};

const hideCellPreview = () => {
  if (cellPreviewShowTimer) {
    clearTimeout(cellPreviewShowTimer);
    cellPreviewShowTimer = 0;
  }
  if (cellPreviewHideTimer) {
    clearTimeout(cellPreviewHideTimer);
    cellPreviewHideTimer = 0;
  }
  if (!cellPreview) return;
  cellPreview.classList.remove('open');
  cellPreview.setAttribute('aria-hidden', 'true');
  cellPreviewAnchor = null;
};

const positionCellPreview = (anchor) => {
  if (!cellPreview || !anchor) return;
  const rect = anchor.getBoundingClientRect();
  const pad = 8;
  // Temporarily show to measure.
  cellPreview.style.visibility = 'hidden';
  cellPreview.classList.add('open');
  const pw = cellPreview.offsetWidth || 320;
  const ph = cellPreview.offsetHeight || 160;
  let left = rect.left;
  let top = rect.bottom + 6;
  if (left + pw > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - pw - pad);
  if (top + ph > window.innerHeight - pad) top = Math.max(pad, rect.top - ph - 6);
  if (left < pad) left = pad;
  if (top < pad) top = pad;
  cellPreview.style.left = `${Math.round(left)}px`;
  cellPreview.style.top = `${Math.round(top)}px`;
  cellPreview.style.visibility = '';
};

const showCellPreview = (cell, opts = {}) => {
  if (!cellPreview || !cellPreviewBody || !cell) return;
  const text = getFullCellText(cell);
  if (!text) return;
  cellPreviewAnchor = cell;
  cellPreviewBody.textContent = text;
  cellPreview.setAttribute('aria-hidden', 'false');
  positionCellPreview(cell);
  cellPreview.classList.add('open');
  if (opts.focusBody) {
    try { cellPreviewBody.focus({ preventScroll: true }); } catch { try { cellPreviewBody.focus(); } catch {} }
  }
  if (opts.selectAll) {
    try {
      const range = document.createRange();
      range.selectNodeContents(cellPreviewBody);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch {}
  }
};

const scheduleShowCellPreview = (cell) => {
  if (!cell || editingCell) return;
  // Only auto-preview cells that carry full text payload (multiline / long).
  if (!cell.hasAttribute('data-full-text') && !cell.getAttribute('title')) return;
  if (cellPreviewShowTimer) clearTimeout(cellPreviewShowTimer);
  cellPreviewShowTimer = setTimeout(() => {
    cellPreviewShowTimer = 0;
    showCellPreview(cell);
  }, 350);
};

const scheduleHideCellPreview = () => {
  if (cellPreviewHideTimer) clearTimeout(cellPreviewHideTimer);
  cellPreviewHideTimer = setTimeout(() => {
    cellPreviewHideTimer = 0;
    hideCellPreview();
  }, 200);
};

const copyTextToClipboard = (text) => {
  if (typeof text !== 'string') return;
  vscode.postMessage({ type: 'copyToClipboard', text });
};

if (cellPreviewCopyBtn) {
  cellPreviewCopyBtn.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    const text = cellPreviewBody ? cellPreviewBody.textContent || '' : '';
    copyTextToClipboard(text);
    cellPreviewCopyBtn.textContent = '已复制';
    setTimeout(() => { cellPreviewCopyBtn.textContent = '复制'; }, 1200);
  });
}
if (cellPreviewCloseBtn) {
  cellPreviewCloseBtn.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    hideCellPreview();
  });
}
if (cellPreview) {
  cellPreview.addEventListener('mouseenter', () => {
    if (cellPreviewHideTimer) {
      clearTimeout(cellPreviewHideTimer);
      cellPreviewHideTimer = 0;
    }
  });
  cellPreview.addEventListener('mouseleave', () => {
    scheduleHideCellPreview();
  });
  // Allow selecting text without starting table selection.
  cellPreview.addEventListener('mousedown', e => e.stopPropagation());
}

table.addEventListener('mouseover', e => {
  if (editingCell) return;
  const cell = e.target && e.target.closest ? e.target.closest('td[data-col], th[data-col]') : null;
  if (!cell || cell.getAttribute('data-col') === '-1') return;
  if (cell === cellPreviewAnchor && cellPreview && cellPreview.classList.contains('open')) return;
  scheduleShowCellPreview(cell);
});
table.addEventListener('mouseout', e => {
  const to = e.relatedTarget;
  if (cellPreview && to && cellPreview.contains(to)) return;
  const cell = e.target && e.target.closest ? e.target.closest('td[data-col], th[data-col]') : null;
  if (!cell) return;
  scheduleHideCellPreview();
});

/* ──────── UPDATED showContextMenu ──────── */
const showContextMenu = (x, y, row, col) => {
  hideCellPreview();
  contextMenu.innerHTML = '';
  const item = (label, cb) => {
    const d = document.createElement('div');
    d.textContent = label;
    d.addEventListener('click', () => { cb(); contextMenu.style.display = 'none'; });
    contextMenu.appendChild(d);
  };
  const divider = () => {
    const d = document.createElement('div');
    d.style.borderTop = '1px solid #888';
    d.style.margin = '1px 0';
    contextMenu.appendChild(d);
  };
  // Derive multi-row/column selection counts
  const selectedIndexCells = currentSelection.filter(el => el && el.getAttribute && el.getAttribute('data-col') === '-1');
  const selectedRowIds = Array.from(new Set(selectedIndexCells.map(el => parseInt(el.getAttribute('data-row') || '-1', 10)).filter(n => !isNaN(n)))).sort((a,b)=>a-b);
  const rowCountSel = selectedRowIds.length;

  const selectedHeaderCells = currentSelection.filter(el => el && el.tagName === 'TH' && el.getAttribute('data-col') !== null);
  const selectedColIds = Array.from(new Set(selectedHeaderCells.map(el => parseInt(el.getAttribute('data-col') || '-1', 10)).filter(n => !isNaN(n) && n >= 0))).sort((a,b)=>a-b);
  const colCountSel = selectedColIds.length;

  let addedRowItems = false;

  /* Header-only: SORT functionality */
  if (lastContextIsHeader) {
    item('Sort: A-Z', () => {
      currentSortCol = col; currentSortAsc = true;
      persistSortState(); updateSortHeaderIndicator();
      vscode.postMessage({ type: 'sortColumn', index: col, ascending: true });
    });
    item('Sort: Z-A', () => {
      currentSortCol = col; currentSortAsc = false;
      persistSortState(); updateSortHeaderIndicator();
      vscode.postMessage({ type: 'sortColumn', index: col, ascending: false });
    });
    item('Sort: 恢复原始', () => {
      currentSortCol = null; currentSortAsc = true;
      persistSortState(); updateSortHeaderIndicator();
      vscode.postMessage({ type: 'resetSort' });
    });
  }

  /* Cell full text — native title was not copyable */
  const contextCell = (!isNaN(row) && !isNaN(col) && col >= 0)
    ? table.querySelector(`${lastContextIsHeader ? 'th' : 'td'}[data-row="${row}"][data-col="${col}"]`)
    : null;
  if (contextCell) {
    if (contextMenu.children.length) divider();
    item('查看全文（可复制）', () => {
      showCellPreview(contextCell, { focusBody: true, selectAll: true });
    });
    item('复制单元格全文', () => {
      copyTextToClipboard(getFullCellText(contextCell));
    });
  }

  /* Row section */
  if (!isNaN(row) && row >= 0) {
    if (contextMenu.children.length) divider();
    const rowsN = rowCountSel > 1 ? rowCountSel : 1;
    const addAboveLabel = rowsN > 1 ? `Add ${rowsN} ROWS: above` : 'Add ROW: above';
    const addBelowLabel = rowsN > 1 ? `Add ${rowsN} ROWS: below` : 'Add ROW: below';
    const delLabel      = rowsN > 1 ? `Delete ${rowsN} ROWS`    : 'Delete ROW';
    item(addAboveLabel, () => {
      const base = rowCountSel > 1 ? Math.min(...selectedRowIds) : row;
      const count = rowsN;
      vscode.postMessage({ type: 'insertRows', index: base, count });
    });
    item(addBelowLabel, () => {
      const base = rowCountSel > 1 ? Math.max(...selectedRowIds) + 1 : (row + 1);
      const count = rowsN;
      vscode.postMessage({ type: 'insertRows', index: base, count });
    });
    item(delLabel, () => {
      if (rowCountSel > 1) {
        vscode.postMessage({ type: 'deleteRows', indices: selectedRowIds });
      } else {
        vscode.postMessage({ type: 'deleteRow', index: row });
      }
    });
    addedRowItems = true;
  }

  /* Column section, preceded by divider if row items exist */
  if (!isNaN(col) && col >= 0) {
    if (addedRowItems) divider();
    const colsN = colCountSel > 1 ? colCountSel : 1;
    const addLeftLabel  = colsN > 1 ? `Add ${colsN} COLUMNS: left`  : 'Add COLUMN: left';
    const addRightLabel = colsN > 1 ? `Add ${colsN} COLUMNS: right` : 'Add COLUMN: right';
    const delColLabel   = colsN > 1 ? `Delete ${colsN} COLUMNS`     : 'Delete COLUMN';
    item(addLeftLabel, () => {
      const base = colCountSel > 1 ? Math.min(...selectedColIds) : col;
      vscode.postMessage({ type: 'insertColumns', index: base, count: colsN });
    });
    item(addRightLabel, () => {
      const base = colCountSel > 1 ? Math.max(...selectedColIds) + 1 : (col + 1);
      vscode.postMessage({ type: 'insertColumns', index: base, count: colsN });
    });
    item(delColLabel, () => {
      if (colCountSel > 1) {
        vscode.postMessage({ type: 'deleteColumns', indices: selectedColIds });
      } else {
        vscode.postMessage({ type: 'deleteColumn', index: col });
      }
    });
  }

  contextMenu.style.left = x + 'px';
  contextMenu.style.top = y + 'px';
  contextMenu.style.display = 'block';
};

const getElementTarget = target => {
  if (target instanceof Element) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
};
const getLinkTarget = target => {
  const el = getElementTarget(target);
  return el ? el.closest('.csv-link[data-href]') : null;
};
const getCellTarget = target => {
  const el = getElementTarget(target);
  return el ? el.closest('td, th') : null;
};
const isColumnHeaderCell = cell => {
  if (!cell || cell.tagName !== 'TH') return false;
  const col = cell.getAttribute('data-col');
  return col !== null && col !== '-1';
};
const isRowIndexCell = cell => cell && cell.getAttribute && cell.getAttribute('data-col') === '-1';
const getSelectedColumnIds = () => {
  const ids = currentSelection
    .filter(el => el && el.tagName === 'TH')
    .map(el => parseInt(el.getAttribute('data-col') || 'NaN', 10))
    .filter(v => !Number.isNaN(v) && v >= 0);
  return Array.from(new Set(ids)).sort((a, b) => a - b);
};
const getSelectedRowIds = () => {
  const ids = currentSelection
    .filter(el => isRowIndexCell(el))
    .map(el => parseInt(el.getAttribute('data-row') || 'NaN', 10))
    .filter(v => !Number.isNaN(v) && v >= 0);
  return Array.from(new Set(ids)).sort((a, b) => a - b);
};
const hideDragIndicator = () => {
  dragIndicator.style.display = 'none';
};
const showColumnDropIndicator = x => {
  const rect = table.getBoundingClientRect();
  dragIndicator.style.left = `${Math.round(x) - 1}px`;
  dragIndicator.style.top = `${Math.round(rect.top)}px`;
  dragIndicator.style.width = '2px';
  dragIndicator.style.height = `${Math.max(1, Math.round(rect.height))}px`;
  dragIndicator.style.display = 'block';
};
const showRowDropIndicator = y => {
  const rect = table.getBoundingClientRect();
  dragIndicator.style.left = `${Math.round(rect.left)}px`;
  dragIndicator.style.top = `${Math.round(y) - 1}px`;
  dragIndicator.style.width = `${Math.max(1, Math.round(rect.width))}px`;
  dragIndicator.style.height = '2px';
  dragIndicator.style.display = 'block';
};
const getColumnDropTarget = clientX => {
  const headers = Array.from(table.querySelectorAll('thead th[data-col]'))
    .map(cell => ({ cell, col: parseInt(cell.getAttribute('data-col') || 'NaN', 10) }))
    .filter(entry => !Number.isNaN(entry.col) && entry.col >= 0)
    .sort((a, b) => a.col - b.col);
  if (!headers.length) return null;

  let beforeIndex = headers[0].col;
  let indicatorX = headers[0].cell.getBoundingClientRect().left;
  for (const entry of headers) {
    const rect = entry.cell.getBoundingClientRect();
    if (clientX < rect.left + rect.width / 2) {
      beforeIndex = entry.col;
      indicatorX = rect.left;
      return { beforeIndex, indicatorX };
    }
    beforeIndex = entry.col + 1;
    indicatorX = rect.right;
  }
  return { beforeIndex, indicatorX };
};
const getRowDropTarget = clientY => {
  const rows = Array.from(table.querySelectorAll('tbody td[data-col="-1"]'))
    .map(cell => ({ cell, row: parseInt(cell.getAttribute('data-row') || 'NaN', 10) }))
    .filter(entry => !Number.isNaN(entry.row) && entry.row >= 0)
    .sort((a, b) => a.row - b.row);
  if (!rows.length) return null;

  let beforeIndex = rows[0].row;
  let indicatorY = rows[0].cell.getBoundingClientRect().top;
  for (const entry of rows) {
    const rect = entry.cell.getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) {
      beforeIndex = entry.row;
      indicatorY = rect.top;
      return { beforeIndex, indicatorY };
    }
    beforeIndex = entry.row + 1;
    indicatorY = rect.bottom;
  }
  return { beforeIndex, indicatorY };
};
const getResizeEdgeInfo = (target, e) => {
  if (!target) return null;
  if (isColumnHeaderCell(target)) {
    const col = parseInt(target.getAttribute('data-col') || 'NaN', 10);
    if (!Number.isNaN(col)) {
      const rect = target.getBoundingClientRect();
      const edgeDelta = rect.right - e.clientX;
      if (edgeDelta >= 0 && edgeDelta <= RESIZE_HANDLE_PX) {
        return { axis: 'column', index: col, rect };
      }
    }
  }
  // Row-resize: any cell with a numeric data-row (serial or data) triggers when near its bottom.
  const rowAttr = target && target.getAttribute ? target.getAttribute('data-row') : null;
  if (rowAttr !== null) {
    const row = parseInt(rowAttr, 10);
    if (!Number.isNaN(row) && row >= 0) {
      const rect = target.getBoundingClientRect();
      const edgeDelta = rect.bottom - e.clientY;
      if (edgeDelta >= 0 && edgeDelta <= RESIZE_HANDLE_PX) {
        return { axis: 'row', index: row, rect };
      }
    }
  }
  return null;
};
const applyColumnWidth = (col, widthPx) => {
  const width = Math.max(40, Math.round(widthPx));
  columnSizeState[String(col)] = width;
  table.querySelectorAll(`[data-col="${col}"]`).forEach(cell => {
    cell.style.width = `${width}px`;
    cell.style.minWidth = `${width}px`;
    cell.style.maxWidth = `${width}px`;
  });
};
const resetColumnWidth = col => {
  delete columnSizeState[String(col)];
  table.querySelectorAll(`[data-col="${col}"]`).forEach(cell => {
    cell.style.width = '';
    cell.style.minWidth = '';
    cell.style.maxWidth = '';
  });
};
const applyRowHeight = (row, heightPx) => {
  const height = Math.max(getMinRowHeight(), Math.round(heightPx));
  rowSizeState[String(row)] = height;
  table.querySelectorAll(`[data-row="${row}"]`).forEach(cell => {
    cell.style.height = `${height}px`;
    cell.style.minHeight = `${height}px`;
    const body = cell.querySelector(':scope > .cell-body');
    if (body) {
      body.style.maxHeight = 'none';
      body.style.overflow = 'hidden';
    }
  });
};
const resetRowHeight = row => {
  delete rowSizeState[String(row)];
  table.querySelectorAll(`[data-row="${row}"]`).forEach(cell => {
    cell.style.height = '';
    cell.style.minHeight = '';
    const body = cell.querySelector(':scope > .cell-body');
    if (body) {
      body.style.maxHeight = '';
      body.style.overflow = '';
    }
  });
};
const startResizeDrag = (target, e) => {
  if (e.button !== 0) return false;
  const edge = getResizeEdgeInfo(target, e);
  if (!edge) return false;
  if (edge.axis === 'column') {
    resizeState = { axis: 'column', index: edge.index, startPos: e.clientX, startSize: edge.rect.width };
    table.style.cursor = 'col-resize';
    return true;
  }
  const rowCells = Array.from(table.querySelectorAll(`[data-row="${edge.index}"]`));
  const startHeight = rowCells.reduce((max, cell) => Math.max(max, cell.getBoundingClientRect().height), edge.rect.height);
  resizeState = { axis: 'row', index: edge.index, startPos: e.clientY, startSize: startHeight };
  table.style.cursor = 'row-resize';
  return true;
};
const startReorderDrag = (target, e) => {
  if (e.button !== 0) return false;
  if (isColumnHeaderCell(target) && target.classList.contains('selected')) {
    const col = parseInt(target.getAttribute('data-col') || 'NaN', 10);
    if (Number.isNaN(col)) return false;
    const selected = getSelectedColumnIds();
    const indices = selected.includes(col) ? selected : [col];
    reorderState = {
      axis: 'column',
      indices,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
      beforeIndex: null
    };
    return true;
  }
  if (isRowIndexCell(target) && target.classList.contains('selected')) {
    const row = parseInt(target.getAttribute('data-row') || 'NaN', 10);
    if (Number.isNaN(row)) return false;
    const selected = getSelectedRowIds();
    const indices = selected.includes(row) ? selected : [row];
    reorderState = {
      axis: 'row',
      indices,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
      beforeIndex: null
    };
    return true;
  }
  return false;
};
const onGlobalDragMove = e => {
  if (resizeState) {
    e.preventDefault();
    if (resizeState.axis === 'column') {
      const delta = e.clientX - resizeState.startPos;
      applyColumnWidth(resizeState.index, resizeState.startSize + delta);
    } else if (resizeState.axis === 'row') {
      const delta = e.clientY - resizeState.startPos;
      applyRowHeight(resizeState.index, resizeState.startSize + delta);
    }
    return;
  }
  if (!reorderState) return;

  const movedX = Math.abs(e.clientX - reorderState.startX);
  const movedY = Math.abs(e.clientY - reorderState.startY);
  if (!reorderState.active && movedX < DRAG_THRESHOLD_PX && movedY < DRAG_THRESHOLD_PX) {
    return;
  }
  reorderState.active = true;
  e.preventDefault();

  if (reorderState.axis === 'column') {
    const target = getColumnDropTarget(e.clientX);
    if (!target) return;
    reorderState.beforeIndex = target.beforeIndex;
    showColumnDropIndicator(target.indicatorX);
  } else {
    const target = getRowDropTarget(e.clientY);
    if (!target) return;
    reorderState.beforeIndex = target.beforeIndex;
    showRowDropIndicator(target.indicatorY);
  }
};
const onGlobalDragEnd = () => {
  if (resizeState) {
    resizeState = null;
    table.style.cursor = '';
    persistState();
  }
  if (!reorderState) return;

  const { axis, indices, active, beforeIndex } = reorderState;
  reorderState = null;
  hideDragIndicator();
  table.style.cursor = '';

  if (!active || !Number.isFinite(beforeIndex)) return;
  if (axis === 'column') {
    vscode.postMessage({ type: 'reorderColumns', indices, beforeIndex });
  } else {
    vscode.postMessage({ type: 'reorderRows', indices, beforeIndex });
  }
};
document.addEventListener('mousemove', onGlobalDragMove);
document.addEventListener('mouseup', onGlobalDragEnd);
const postOpenLink = link => {
  const url = link.getAttribute('data-href') || link.getAttribute('href');
  if (url) {
    vscode.postMessage({ type: 'openLink', url });
  }
};

table.addEventListener('click', e => {
  const sortBtn = getSortBtnTarget(e.target);
  if (!sortBtn || e.button !== 0) return;
  const th = sortBtn.closest('th[data-col]');
  if (!th) return;
  const col = parseInt(th.getAttribute('data-col') || 'NaN', 10);
  if (Number.isNaN(col)) return;
  e.preventDefault();
  e.stopPropagation();
  toggleSortOnColumn(col);
});

document.addEventListener('click', (e) => {
  contextMenu.style.display = 'none';

  const link = getLinkTarget(e.target);
  if (!link) {
    return;
  }
  // Never navigate inside the webview.
  e.preventDefault();
  if (!(e.ctrlKey || e.metaKey)) {
    return;
  }
  // Ctrl/Cmd+click should open externally once, while regular clicks
  // still behave like normal cell interactions.
  if (e.detail === 1) {
    e.stopPropagation();
    postOpenLink(link);
  }
});

/* ──────── UPDATED contextmenu listener ──────── */
table.addEventListener('contextmenu', e => {
  const target = getCellTarget(e.target);
  if (!target) return;
  const colAttr = target.getAttribute('data-col');
  const rowAttr = target.getAttribute('data-row');
  const col = parseInt(colAttr);
  const row = parseInt(rowAttr);
  if ((isNaN(col) || col === -1) && (isNaN(row) || row === -1)) return;
  e.preventDefault();
  lastContextIsHeader = target.tagName === 'TH';
  showContextMenu(e.pageX, e.pageY, row, col);
});

const getSortBtnTarget = target => {
  const el = getElementTarget(target);
  return el ? el.closest('.sort-btn[data-sort-btn]') : null;
};
const updateSortHeaderIndicator = () => {
  table.querySelectorAll('th.sort-asc, th.sort-desc').forEach(th => {
    th.classList.remove('sort-asc');
    th.classList.remove('sort-desc');
  });
  if (currentSortCol === null) return;
  const th = table.querySelector(`th[data-col="${currentSortCol}"]`);
  if (th) th.classList.add(currentSortAsc ? 'sort-asc' : 'sort-desc');
};
/* Tri-state sort cycle per column:
 *   none → asc → desc → none (restore original) → asc → …
 * Switching to a different column always starts fresh at asc.
 * "none" is delivered to the extension host as { type: 'resetSort' }, which
 * restores the pre-sort document snapshot captured server-side.
 */
const toggleSortOnColumn = col => {
  if (currentSortCol !== col) {
    currentSortCol = col;
    currentSortAsc = true;
    persistSortState();
    updateSortHeaderIndicator();
    vscode.postMessage({ type: 'sortColumn', index: col, ascending: true });
    return;
  }
  if (currentSortAsc) {
    currentSortAsc = false;
    persistSortState();
    updateSortHeaderIndicator();
    vscode.postMessage({ type: 'sortColumn', index: col, ascending: false });
    return;
  }
  // Was desc → back to original.
  currentSortCol = null;
  currentSortAsc = true;
  persistSortState();
  updateSortHeaderIndicator();
  vscode.postMessage({ type: 'resetSort' });
};

table.addEventListener('mousedown', e => {
  // Sort button on header: intercept before selection / reorder / resize.
  const sortBtn = getSortBtnTarget(e.target);
  if (sortBtn && e.button === 0) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  const link = getLinkTarget(e.target);
  // Ctrl/Cmd+click on a link opens externally on click; keep existing selection unchanged.
  if (link && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    return;
  }
  const target = getCellTarget(e.target);
  if (!target) return;

  // Preserve selection on right-click; select target if outside current selection
  if (e.button === 2) { // right mouse button
    if (!editingCell) {
      e.preventDefault();
      if (!target.classList.contains('selected')) {
        clearSelection();
        target.classList.add('selected');
        currentSelection.push(target);
        anchorCell = target;
        rangeEndCell = target;
        try { target.focus({ preventScroll: true }); } catch { try { target.focus(); } catch {} }
      }
    }
    return; // do not start drag selection on right-click
  }
  if (e.button !== 0) return;
  if (!editingCell && startResizeDrag(target, e)) {
    e.preventDefault();
    return;
  }
  if (!editingCell && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && startReorderDrag(target, e)) {
    e.preventDefault();
    return;
  }

  // ──────── NEW: Shift+Click range selection ────────
  if (e.shiftKey && anchorCell && !editingCell) {
    const aRowAttr = anchorCell.getAttribute('data-row');
    const aColAttr = anchorCell.getAttribute('data-col');
    const tRowAttr = target.getAttribute('data-row');
    const tColAttr = target.getAttribute('data-col');
    // Ensure both have coordinates of some form
    if (aRowAttr !== null && tRowAttr !== null) {
      // Case 1: Header-to-header shift click → full column range
      if (anchorCell.tagName === 'TH' && target.tagName === 'TH' && aColAttr !== null && tColAttr !== null) {
        e.preventDefault();
        const startCol = parseInt(aColAttr, 10);
        const endCol = parseInt(tColAttr, 10);
        selectFullColumnRange(startCol, endCol);
        rangeEndCell = target;
        anchorCell.focus();
        return;
      }
      // Case 2: Serial-index-to-serial-index shift click → full row range
      if (aColAttr === '-1' && tColAttr === '-1') {
        e.preventDefault();
        const startRow = parseInt(aRowAttr, 10);
        const endRow = parseInt(tRowAttr, 10);
        selectFullRowRange(startRow, endRow);
        rangeEndCell = target;
        anchorCell.focus();
        return;
      }
      // Case 3: Regular cell-to-cell rectangle (exclude header/serial)
      if (
        aColAttr !== null && tColAttr !== null &&
        aColAttr !== '-1' && tColAttr !== '-1' &&
        target.tagName !== 'TH' && anchorCell.tagName !== 'TH'
      ) {
        e.preventDefault();
        selectRange(getCellCoords(anchorCell), getCellCoords(target));
        rangeEndCell = target;
        anchorCell.focus();
        return;
      }
    }
  }

  if(editingCell){ if(e.target !== editingCell) editingCell.blur(); else return; } else clearSelection();

  /* ──────── NEW: select-all via top-left header cell ──────── */
  if (
    target.tagName === 'TH' &&                 // header cell
    !target.hasAttribute('data-col') &&        // serial-index header has *no* data-col
    !target.hasAttribute('data-row')           // and no data-row
  ) {
    e.preventDefault();
    clearSelection();
    selectAllCells();
    isSelecting = false;
    anchorCell  = null;
    return;
  }
  /* ──────── END NEW BLOCK ──────── */
  
  selectionMode = isColumnHeaderCell(target) ? "column" : (target.getAttribute('data-col') === '-1' ? "row" : "cell");
  startCell = target; endCell = target; rangeEndCell = target; isSelecting = true; e.preventDefault();
  target.focus();
});

table.addEventListener('mousemove', e => {
  if(!isSelecting) return;
  let target = getCellTarget(e.target);
  if (!target) return;
  if(selectionMode === "cell"){
    endCell = target;
    rangeEndCell = target;
    selectRange(getCellCoords(startCell), getCellCoords(endCell));
  } else if(selectionMode === "column"){
    if(target.tagName !== 'TH'){
      const col = target.getAttribute('data-col');
      target = table.querySelector('thead th[data-col="'+col+'"]') || target;
    }
    endCell = target;
    rangeEndCell = target;
    const startCol = parseInt(startCell.getAttribute('data-col'));
    const endCol = parseInt(endCell.getAttribute('data-col'));
    selectFullColumnRange(startCol, endCol);
  } else if(selectionMode === "row"){
    if(target.getAttribute('data-col') !== '-1'){
      const row = target.getAttribute('data-row');
      target = table.querySelector('td[data-col="-1"][data-row="'+row+'"]') || target;
    }
    endCell = target;
    rangeEndCell = target;
    const startRow = parseInt(startCell.getAttribute('data-row'));
    const endRow = parseInt(endCell.getAttribute('data-row'));
    selectFullRowRange(startRow, endRow);
  }
});

table.addEventListener('mousemove', e => {
  if (isSelecting || resizeState || (reorderState && reorderState.active)) {
    return;
  }
  if (getSortBtnTarget(e.target)) {
    table.style.cursor = 'pointer';
    return;
  }
  const target = getCellTarget(e.target);
  if (!target) {
    table.style.cursor = '';
    return;
  }
  const edge = getResizeEdgeInfo(target, e);
  if (edge) {
    table.style.cursor = edge.axis === 'column' ? 'col-resize' : 'row-resize';
    return;
  }
  table.style.cursor = '';
});

table.addEventListener('mouseleave', () => {
  if (!resizeState) {
    table.style.cursor = '';
  }
});

table.addEventListener('mouseup', e => {
  if(!isSelecting) return;
  isSelecting = false;
  if(selectionMode === "cell"){
    if(startCell === endCell){
      clearSelection();
      startCell.classList.add('selected');
      currentSelection.push(startCell);
    }
    anchorCell = startCell;
    rangeEndCell = endCell;
    persistState();
  } else if(selectionMode === "column"){
    const startCol = parseInt(startCell.getAttribute('data-col'));
    const endCol = parseInt(endCell.getAttribute('data-col'));
    selectFullColumnRange(startCol, endCol); anchorCell = startCell; rangeEndCell = endCell; persistState();
  } else if(selectionMode === "row"){
    const startRow = parseInt(startCell.getAttribute('data-row'));
    const endRow = parseInt(endCell.getAttribute('data-row'));
    selectFullRowRange(startRow, endRow); anchorCell = startCell; rangeEndCell = endCell; persistState();
  }
});

const selectRange = (start, end) => {
  clearSelection();
  const minRow = Math.min(start.row, end.row), maxRow = Math.max(start.row, end.row);
  const minCol = Math.min(start.col, end.col), maxCol = Math.max(start.col, end.col);
  for(let r = minRow; r <= maxRow; r++){
    for(let c = minCol; c <= maxCol; c++){
      const selector = (hasHeader && r === 0 ? 'th' : 'td') + '[data-row="'+r+'"][data-col="'+c+'"]';
      const selCell = table.querySelector(selector);
      if(selCell){ selCell.classList.add('selected'); currentSelection.push(selCell); }
    }
  }
};

const selectFullColumnRange = (col1, col2) => {
  clearSelection();
  const minCol = Math.min(col1, col2), maxCol = Math.max(col1, col2);
  table.querySelectorAll('tr').forEach(row => {
    Array.from(row.children).forEach(cell => {
      const cellCol = cell.getAttribute('data-col');
      if(cellCol !== null && parseInt(cellCol) >= minCol && parseInt(cellCol) <= maxCol){
        cell.classList.add('selected'); currentSelection.push(cell);
      }
    });
  });
};

const selectFullRowRange = (row1, row2) => {
  clearSelection();
  const minRow = Math.min(row1, row2), maxRow = Math.max(row1, row2);
  table.querySelectorAll('tr').forEach(row => {
    Array.from(row.children).forEach(cell => {
      const r = cell.getAttribute('data-row');
      if(r !== null && parseInt(r) >= minRow && parseInt(r) <= maxRow){
        cell.classList.add('selected'); currentSelection.push(cell);
      }
    });
  });
};

const getDataCellCoords = cell => {
  if (!cell || typeof cell.getAttribute !== 'function') return null;
  const coords = getCellCoords(cell);
  if (!coords || !Number.isInteger(coords.row) || !Number.isInteger(coords.col)) return null;
  if (coords.row < 0 || coords.col < 0) return null;
  return coords;
};

const getDataSelectionBounds = () => {
  const coords = currentSelection
    .map(cell => getDataCellCoords(cell))
    .filter(Boolean);
  if (!coords.length) return null;
  const keys = new Set(coords.map(c => `${c.row}:${c.col}`));
  const rows = coords.map(c => c.row);
  const cols = coords.map(c => c.col);
  const minRow = Math.min(...rows);
  const maxRow = Math.max(...rows);
  const minCol = Math.min(...cols);
  const maxCol = Math.max(...cols);
  const expectedCount = (maxRow - minRow + 1) * (maxCol - minCol + 1);
  const rectangular = keys.size === expectedCount;
  return { minRow, maxRow, minCol, maxCol, rectangular };
};

const getPasteAnchorCoords = () => {
  const anchor = getDataCellCoords(anchorCell);
  if (anchor) return anchor;
  const fromActive = getDataCellCoords(getCellTarget(document.activeElement));
  if (fromActive) return fromActive;
  const bounds = getDataSelectionBounds();
  if (bounds) return { row: bounds.minRow, col: bounds.minCol };
  return null;
};

const getRenderedCellByCoords = (row, col) => {
  return table.querySelector(`td[data-row="${row}"][data-col="${col}"], th[data-row="${row}"][data-col="${col}"]`);
};
const ensureRenderedCellByCoords = (row, col) => {
  let cell = getRenderedCellByCoords(row, col);
  if (cell) {
    return cell;
  }
  if (USE_WINDOWED_SCROLL) {
    const bodyIndex = Math.max(0, row - bodyStartAbsMeta);
    ensureBodyIndexVisible(bodyIndex);
    pendingEnsureTarget = { row, col, guard: 40 };
    cell = getRenderedCellByCoords(row, col);
    return cell;
  }
  if (typeof window.__csvLoadNextChunk !== 'function') {
    return null;
  }
  let guard = 50000;
  while (!cell && guard-- > 0) {
    if (!window.__csvLoadNextChunk()) break;
    cell = getRenderedCellByCoords(row, col);
  }
  if (!cell && (remoteHasMoreChunks || remoteChunkRequestInFlight)) {
    pendingEnsureTarget = { row, col, guard: 5000 };
    requestRemoteChunk();
  }
  return cell;
};
const csvFindReplace = typeof window.createCsvFindReplace === 'function'
  ? window.createCsvFindReplace({
      vscode,
      table,
      getElementTarget,
      getRenderedCellByCoords,
      ensureRenderedCellByCoords,
      getFocusFallback: () => anchorCell || document.body,
    })
  : null;
window.CsvFindReplaceBridge = csvFindReplace;

// Capture-phase handler to intercept Cmd/Ctrl + Arrow and move to extremes
document.addEventListener('keydown', e => {
  if (csvFindReplace && csvFindReplace.isFindWidgetTarget(e.target)) {
    return;
  }
  const isArrowKey = (k) => ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Up','Down','Left','Right','Home','End'].includes(k);
  if (!editingCell && (e.ctrlKey || e.metaKey) && isArrowKey(e.key)) {
    e.preventDefault();
    e.stopImmediatePropagation();
    e.stopPropagation();

    const sc = document.querySelector('.table-container');
    if (sc) {
      if (['ArrowLeft','Left','Home'].includes(e.key))  sc.scrollTo({ left: 0, behavior: 'smooth' });
      if (['ArrowRight','Right','End'].includes(e.key)) sc.scrollTo({ left: sc.scrollWidth, behavior: 'smooth' });
      if (['ArrowUp','Up'].includes(e.key))    sc.scrollTo({ top: 0, behavior: 'smooth' });
      if (['ArrowDown','Down'].includes(e.key))  sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' });
    } else {
      if (['ArrowUp','Up'].includes(e.key)) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      if (['ArrowDown','Down'].includes(e.key)) {
        const h = Math.max(
          document.body.scrollHeight,
          document.documentElement.scrollHeight
        );
        window.scrollTo({ top: h, behavior: 'smooth' });
      }
    }

    const ref = anchorCell || currentSelection[0] || document.querySelector('td.selected, th.selected') || document.querySelector('td, th');
    let target = null;
    if (ref) {
      const { row, col } = getCellCoords(ref);
      if (['ArrowLeft','Left','Home'].includes(e.key)) {
        const tag = (hasHeader && row === 0 ? 'th' : 'td');
        const rowCells = Array.from(table.querySelectorAll(tag + '[data-row="'+row+'"]'))
          .filter(el => el.getAttribute('data-col') !== null && el.getAttribute('data-col') !== '-1');
        const min = rowCells.reduce((acc, el) => Math.min(acc, parseInt(el.getAttribute('data-col'))), Infinity);
        target = rowCells.find(el => parseInt(el.getAttribute('data-col')) === min) || ref;
      } else if (['ArrowRight','Right','End'].includes(e.key)) {
        const tag = (hasHeader && row === 0 ? 'th' : 'td');
        const rowCells = Array.from(table.querySelectorAll(tag + '[data-row="'+row+'"]'))
          .filter(el => el.getAttribute('data-col') !== null && el.getAttribute('data-col') !== '-1');
        const max = rowCells.reduce((acc, el) => Math.max(acc, parseInt(el.getAttribute('data-col'))), -1);
        target = rowCells.find(el => parseInt(el.getAttribute('data-col')) === max) || ref;
      } else if (['ArrowUp','Up'].includes(e.key)) {
        const topRow = getFirstDataRow();
        target = table.querySelector('td[data-row="'+topRow+'"][data-col="'+col+'"]') || ref;
      } else if (['ArrowDown','Down'].includes(e.key)) {
        const colCells = Array.from(table.querySelectorAll('td[data-col="'+col+'"]'));
        target = (colCells.length ? colCells[colCells.length - 1] : null) || ref;
      }
    }

    if (target) {
      clearSelection();
      target.classList.add('selected');
      currentSelection.push(target);
      anchorCell = target;
      rangeEndCell = target;
      persistState();
      target.focus({preventScroll:true});
      if (['ArrowUp','Up'].includes(e.key)) {
        const topRow = getFirstDataRow();
        const below = table.querySelector('td[data-row="'+topRow+'"][data-col="'+getCellCoords(target).col+'"]');
        if (below) {
          below.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        } else {
          target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        }
      } else {
        target.scrollIntoView({ block:'nearest', inline:'nearest', behavior:'smooth' });
      }
    }
  }
}, true);

document.addEventListener('keydown', e => {
  if (maybeHandleZoomShortcut(e)) {
    return;
  }
  // Escape closes full-text preview first.
  if (e.key === 'Escape' && cellPreview && cellPreview.classList.contains('open')) {
    e.preventDefault();
    hideCellPreview();
    return;
  }
  // Space / Alt+Enter on selected cell: open copyable full-text preview (not native title).
  if (!editingCell && !e.ctrlKey && !e.metaKey && currentSelection.length === 1) {
    const only = currentSelection[0];
    const isSpace = e.key === ' ' || e.code === 'Space';
    const isAltEnter = e.key === 'Enter' && e.altKey;
    if ((isSpace || isAltEnter) && only && only.getAttribute('data-col') !== '-1') {
      e.preventDefault();
      showCellPreview(only, { focusBody: true, selectAll: true });
      return;
    }
  }
  const key = typeof e.key === 'string' ? e.key.toLowerCase() : '';
  if ((e.ctrlKey || e.metaKey) && key === 'f') {
    e.preventDefault();
    if (csvFindReplace) csvFindReplace.open(false);
    return;
  }
  if ((e.ctrlKey || e.metaKey) && key === 'h') {
    e.preventDefault();
    if (csvFindReplace) csvFindReplace.open(true);
    return;
  }
  if (csvFindReplace && csvFindReplace.isOpen() && (e.ctrlKey || e.metaKey) && key === 'g') {
    e.preventDefault();
    csvFindReplace.navigate(e.shiftKey);
    return;
  }
  if (csvFindReplace && csvFindReplace.isOpen() && e.key === 'F3') {
    e.preventDefault();
    csvFindReplace.navigate(e.shiftKey);
    return;
  }
  if (csvFindReplace && csvFindReplace.isOpen() && e.key === 'Escape') {
    e.preventDefault();
    csvFindReplace.close();
    return;
  }
  if (csvFindReplace && csvFindReplace.isFindWidgetTarget(e.target)) {
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'a' && !editingCell) {
    e.preventDefault(); selectAllCells(); return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'c' && currentSelection.length > 0) {
    e.preventDefault(); copySelectionToClipboard(); return;
  }

  // Clear contents of selected cells when not editing
  if (!editingCell && currentSelection.length > 0 && (e.key === 'Delete' || e.key === 'Backspace')) {
    e.preventDefault();
    const cellsToClear = currentSelection
      .filter(cell => cell && cell.getAttribute('data-col') !== null && cell.getAttribute('data-col') !== '-1');
    if (cellsToClear.length === 0) return;
    cellsToClear.forEach(cell => {
      const { row, col } = getCellCoords(cell);
      // Update UI immediately
      cell.textContent = '';
      // Persist change to extension
      vscode.postMessage({ type: 'editCell', row, col, value: '' });
    });
    return;
  }

  const isArrowKey = (k) => ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Up','Down','Left','Right','Home','End'].includes(k);
  if (!editingCell && (e.ctrlKey || e.metaKey) && isArrowKey(e.key)) {
    e.preventDefault();
    const sc = document.querySelector('.table-container');
    if (sc) {
      if (['ArrowLeft','Left','Home'].includes(e.key))  sc.scrollTo({ left: 0, behavior: 'smooth' });
      if (['ArrowRight','Right','End'].includes(e.key)) sc.scrollTo({ left: sc.scrollWidth, behavior: 'smooth' });
      if (['ArrowUp','Up'].includes(e.key))    sc.scrollTo({ top: 0, behavior: 'smooth' });
      if (['ArrowDown','Down'].includes(e.key))  sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' });
    }

    let refCell = anchorCell;
    if (!refCell) {
      refCell = currentSelection[0] || document.querySelector('td.selected, th.selected');
    }
    let target = null;
    if (refCell) {
      const { row, col } = getCellCoords(refCell);
      if (['ArrowLeft','Left','Home'].includes(e.key)) {
        const tag = (hasHeader && row === 0 ? 'th' : 'td');
        const rowCells = Array.from(table.querySelectorAll(tag + '[data-row="'+row+'"]'))
          .filter(el => el.getAttribute('data-col') !== null && el.getAttribute('data-col') !== '-1');
        const min = rowCells.reduce((acc, el) => Math.min(acc, parseInt(el.getAttribute('data-col'))), Infinity);
        target = rowCells.find(el => parseInt(el.getAttribute('data-col')) === min) || refCell;
      } else if (['ArrowRight','Right','End'].includes(e.key)) {
        const tag = (hasHeader && row === 0 ? 'th' : 'td');
        const rowCells = Array.from(table.querySelectorAll(tag + '[data-row="'+row+'"]'))
          .filter(el => el.getAttribute('data-col') !== null && el.getAttribute('data-col') !== '-1');
        const max = rowCells.reduce((acc, el) => Math.max(acc, parseInt(el.getAttribute('data-col'))), -1);
        target = rowCells.find(el => parseInt(el.getAttribute('data-col')) === max) || refCell;
      } else if (['ArrowUp','Up'].includes(e.key)) {
        if (hasHeader) {
          target = table.querySelector('th[data-row="0"][data-col="'+col+'"]') || refCell;
        } else {
          target = table.querySelector('td[data-row="0"][data-col="'+col+'"]') || refCell;
        }
      } else if (['ArrowDown','Down'].includes(e.key)) {
        const colCells = Array.from(table.querySelectorAll('td[data-col="'+col+'"]'));
        target = (colCells.length ? colCells[colCells.length - 1] : null) || refCell;
      }
    }

    if (target) {
      clearSelection();
      target.classList.add('selected');
      currentSelection.push(target);
      anchorCell = target;
      rangeEndCell = target;
      persistState();
      target.focus({preventScroll:true});
      target.scrollIntoView({ block:'nearest', inline:'nearest', behavior:'smooth' });
    }
    return;
  }

  if (!editingCell && e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    const refCell = anchorCell || getCellTarget(document.activeElement) || currentSelection[0] || document.querySelector('td.selected, th.selected');
    if (!refCell) return;
    const coords = getCellCoords(refCell);
    if (!coords || !Number.isInteger(coords.row) || !Number.isInteger(coords.col) || coords.col < 0) {
      return;
    }
    const bounds = getDataColumnBounds();
    if (!bounds) return;
    const { minCol, maxCol } = bounds;
    const firstDataRow = getFirstDataRow();
    const isBackward = !!e.shiftKey;
    let targetRow = coords.row;
    let targetCol = coords.col + (isBackward ? -1 : 1);
    if (!isBackward && targetCol > maxCol) {
      targetRow += 1;
      targetCol = minCol;
    } else if (isBackward && targetCol < minCol) {
      if (targetRow <= firstDataRow) {
        return;
      }
      targetRow -= 1;
      targetCol = maxCol;
    }
    const nextCell = ensureRenderedCellByCoords(targetRow, targetCol);
    if (nextCell) {
      setSingleSelection(nextCell);
    }
    return;
  }

  /* ──────── NEW: ENTER + DIRECT TYPING HANDLERS ──────── */
  if (!editingCell && anchorCell && currentSelection.length === 1) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const cell = anchorCell;
      // Detail edit via Enter
      editCell(cell, undefined, 'detail');
      if (e.shiftKey) {
        // Shift+Enter from selection should open detail edit and insert
        // a newline immediately on the very first keypress.
        appendVisibleNewlineAtEnd(cell);
      }
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      const cell = anchorCell;
      // Quick edit via direct typing: start edit and inject the first char.
      editCell(cell, undefined, 'quick');
      // Overwrite existing content with the typed character.
      cell.textContent = e.key;
      setCursorToEnd(cell);
      return;
    }
  }

  /* ──────── ARROW KEY NAVIGATION ──────── */
  if (!editingCell && anchorCell && e.shiftKey && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
    const { row, col } = getCellCoords(rangeEndCell || anchorCell);
    let targetRow = row, targetCol = col;
    switch(e.key){
      case 'ArrowUp':   targetRow = row - 1; break;
      case 'ArrowDown': targetRow = row + 1; break;
      case 'ArrowLeft': targetCol = col - 1; break;
      case 'ArrowRight':targetCol = col + 1; break;
    }
    if(targetRow < 0 || targetCol < 0) return;
    const tag = (hasHeader && targetRow === 0 ? 'th' : 'td');
    const nextCell = table.querySelector(`${tag}[data-row="${targetRow}"][data-col="${targetCol}"]`);
    if(nextCell){
      e.preventDefault();
      rangeEndCell = nextCell;
      selectRange(getCellCoords(anchorCell), getCellCoords(rangeEndCell));
      persistState();
      anchorCell.focus({preventScroll:true});
      rangeEndCell.scrollIntoView({ block:'nearest', inline:'nearest', behavior:'smooth' });
    }
    return;
  }

  if (!editingCell && anchorCell && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
    const { row, col } = getCellCoords(anchorCell);
    let targetRow = row, targetCol = col;
    switch(e.key){
      case 'ArrowUp':   targetRow = row - 1; break;
      case 'ArrowDown': targetRow = row + 1; break;
      case 'ArrowLeft': targetCol = col - 1; break;
      case 'ArrowRight':targetCol = col + 1; break;
    }
    if(targetRow < 0 || targetCol < 0) return;
    const tag = (hasHeader && targetRow === 0 ? 'th' : 'td');
    const nextCell = table.querySelector(`${tag}[data-row="${targetRow}"][data-col="${targetCol}"]`);
    if(nextCell){
      e.preventDefault();
      clearSelection();
      nextCell.classList.add('selected');
      currentSelection.push(nextCell);
      anchorCell = nextCell;
      rangeEndCell = nextCell;
      persistState();
      nextCell.focus({preventScroll:true});
      nextCell.scrollIntoView({ block:'nearest', inline:'nearest', behavior:'smooth' });
    }
    return;
  }

  // QUICK EDIT: Arrow keys commit and move selection (no re-entering edit)
  if (editingCell && editMode === 'quick' && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
    e.preventDefault();
    const { row, col } = getCellCoords(editingCell);
    let targetRow = row, targetCol = col;
    switch(e.key){
      case 'ArrowUp':   targetRow = row - 1; break;
      case 'ArrowDown': targetRow = row + 1; break;
      case 'ArrowLeft': targetCol = col - 1; break;
      case 'ArrowRight':targetCol = col + 1; break;
    }
    if (targetRow >= 0 && targetCol >= 0) {
      const tag = (hasHeader && targetRow === 0 ? 'th' : 'td');
      const nextCell = table.querySelector(`${tag}[data-row="${targetRow}"][data-col="${targetCol}"]`);
      if (nextCell) {
        const commitAndMove = () => {
          clearSelection();
          nextCell.classList.add('selected');
          currentSelection.push(nextCell);
          anchorCell = nextCell;
          rangeEndCell = nextCell;
          persistState();
          nextCell.focus({preventScroll:true});
          nextCell.scrollIntoView({ block:'nearest', inline:'nearest', behavior:'smooth' });
        };
        const cellRef = editingCell;
        cellRef && cellRef.blur();
        setTimeout(commitAndMove, 0);
      } else {
        const cellRef = editingCell;
        cellRef && cellRef.blur();
      }
    } else {
      const cellRef = editingCell;
      cellRef && cellRef.blur();
    }
    return;
  }

  // DETAIL EDIT: Arrow Up/Down go to start/end of contents; Left/Right default caret move
  if (editingCell && editMode === 'detail' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault();
    if (e.key === 'ArrowUp') setCursorToStart(editingCell);
    if (e.key === 'ArrowDown') setCursorToEnd(editingCell);
    return;
  }

  if (editingCell && ((e.ctrlKey || e.metaKey) && e.key === 's')) {
    e.preventDefault();
    editingCell.blur();
    vscode.postMessage({ type: 'save' });
  }
  if (editingCell && e.key === 'Enter') {
    e.preventDefault();
    if (e.shiftKey) {
      if (!insertNewlineAtCaret(editingCell)) {
        appendVisibleNewlineAtEnd(editingCell);
      }
      return;
    }
    const { row, col } = getCellCoords(editingCell);
    editingCell.blur();
    const targetRow = row + 1;
    // Editing Enter commits and moves selection down (no auto-edit).
    const nextCell = ensureRenderedCellByCoords(targetRow, col);
    if (nextCell) {
      setSingleSelection(nextCell);
    } else {
      try {
        const st = vscode.getState() || {};
        vscode.setState({ ...st, anchorRow: targetRow, anchorCol: col });
      } catch {}
    }
  }
  if (editingCell && e.key === 'Tab') {
    e.preventDefault();
    const cell = editingCell;
    const { row, col } = getCellCoords(cell);
    const bounds = getDataColumnBounds();
    const firstDataRow = getFirstDataRow();
    const isBackward = !!e.shiftKey;
    let targetRow = row;
    let targetCol = col;
    let canMove = !!bounds;
    if (bounds) {
      targetCol = col + (isBackward ? -1 : 1);
      if (!isBackward && targetCol > bounds.maxCol) {
        targetRow += 1;
        targetCol = bounds.minCol;
      } else if (isBackward && targetCol < bounds.minCol) {
        if (targetRow <= firstDataRow) {
          canMove = false;
        } else {
          targetRow -= 1;
          targetCol = bounds.maxCol;
        }
      }
    }
    cell.blur();
    // Editing Tab commits and moves selection only (no auto-edit).
    const nextCell = canMove ? ensureRenderedCellByCoords(targetRow, targetCol) : null;
    if (nextCell) {
      setSingleSelection(nextCell);
    } else {
      setSingleSelection(cell);
    }
  }
  if (editingCell && e.key === 'Escape') {
    e.preventDefault(); editingCell.innerText = originalCellValue; editingCell.blur();
  }
  if (!editingCell && e.key === 'Escape') {
    clearSelection();
  }
});

document.addEventListener('paste', e => {
  if (csvFindReplace && csvFindReplace.isFindWidgetTarget(e.target)) {
    return;
  }
  if (editingCell) {
    return;
  }
  const clipboard = e.clipboardData;
  if (!clipboard) {
    return;
  }
  const text = clipboard.getData('text/plain');
  if (typeof text !== 'string' || text.length === 0) {
    return;
  }
  const anchor = getPasteAnchorCoords();
  if (!anchor) {
    return;
  }
  e.preventDefault();
  const selection = getDataSelectionBounds();
  vscode.postMessage({
    type: 'pasteCells',
    text,
    anchorRow: anchor.row,
    anchorCol: anchor.col,
    selection: selection || undefined
  });
});

const selectAllCells = () => { clearSelection(); document.querySelectorAll('td, th').forEach(cell => { cell.classList.add('selected'); currentSelection.push(cell); }); };

const setCursorToEnd = cell => { setTimeout(() => { 
  const range = document.createRange(); range.selectNodeContents(cell); range.collapse(false);
  const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
}, 10); };

const setCursorToStart = cell => { setTimeout(() => {
  const range = document.createRange(); range.selectNodeContents(cell); range.collapse(true);
  const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
}, 10); };

const setCursorAtPoint = (cell, x, y) => {
  let range;
  if(document.caretRangeFromPoint) { range = document.caretRangeFromPoint(x,y); }
  else if(document.caretPositionFromPoint) { let pos = document.caretPositionFromPoint(x,y); range = document.createRange(); range.setStart(pos.offsetNode, pos.offset); }
  if(range){ let sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range); }
};

const getDataColumnBounds = () => {
  const cols = Array.from(table.querySelectorAll('td[data-col], th[data-col]'))
    .map(el => parseInt(el.getAttribute('data-col') || 'NaN', 10))
    .filter(col => Number.isInteger(col) && col >= 0);
  if (!cols.length) {
    return null;
  }
  return { minCol: Math.min(...cols), maxCol: Math.max(...cols) };
};

const setSingleSelection = cell => {
  if (!cell) return;
  clearSelection();
  cell.classList.add('selected');
  currentSelection.push(cell);
  anchorCell = cell;
  rangeEndCell = cell;
  persistState();
  try { cell.focus({ preventScroll: true }); } catch { try { cell.focus(); } catch {} }
  cell.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
};

const NEWLINE_SENTINEL_ATTR = 'data-csv-newline-sentinel';
const removeNewlineSentinels = cell => {
  if (!cell) return;
  cell.querySelectorAll(`[${NEWLINE_SENTINEL_ATTR}="true"]`).forEach(node => node.remove());
};

const placeCaretBeforeSentinel = sentinel => {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  if (sentinel.firstChild) {
    range.setStart(sentinel.firstChild, 0);
  } else {
    range.setStartBefore(sentinel);
  }
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
};

const appendVisibleNewlineAtEnd = cell => {
  removeNewlineSentinels(cell);
  const sentinel = document.createElement('span');
  sentinel.setAttribute(NEWLINE_SENTINEL_ATTR, 'true');
  sentinel.textContent = '\u200B';
  cell.appendChild(document.createTextNode('\n'));
  cell.appendChild(sentinel);
  placeCaretBeforeSentinel(sentinel);
};

const isRangeAtEndOfCell = (cell, range) => {
  const probe = document.createRange();
  probe.selectNodeContents(cell);
  probe.setEnd(range.endContainer, range.endOffset);
  const caretOffset = probe.toString().length;
  return caretOffset >= (cell.textContent || '').length;
};

const insertNewlineAtCaret = cell => {
  removeNewlineSentinels(cell);
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  if (!cell.contains(range.commonAncestorContainer)) return false;
  const atEnd = range.collapsed && isRangeAtEndOfCell(cell, range);
  range.deleteContents();
  if (atEnd) {
    const sentinel = document.createElement('span');
    sentinel.setAttribute(NEWLINE_SENTINEL_ATTR, 'true');
    sentinel.textContent = '\u200B';
    const fragment = document.createDocumentFragment();
    fragment.appendChild(document.createTextNode('\n'));
    fragment.appendChild(sentinel);
    range.insertNode(fragment);
    placeCaretBeforeSentinel(sentinel);
    return true;
  }
  const newlineNode = document.createTextNode('\n');
  range.insertNode(newlineNode);
  range.setStartAfter(newlineNode);
  range.setEndAfter(newlineNode);
  sel.removeAllRanges();
  sel.addRange(range);
  return true;
};

const editCell = (cell, event, mode = 'detail') => {
  if(editingCell === cell) return;
  if(editingCell) editingCell.blur();
  hideCellPreview();
  const wasCompact = table.classList.contains('row-compact');
  if (wasCompact) restoreCompactNewlineMarkers(cell);
  cell.classList.remove('selected');
  originalCellValue = cell.textContent;
  editingCell = cell;
  editMode = mode;
  cell.classList.add('editing');
  cell.setAttribute('contenteditable', 'true');
  cell.focus();
  const onBlurHandler = () => {
    removeNewlineSentinels(cell);
    const value = cell.textContent;
    const coords = getCellCoords(cell);
    vscode.postMessage({ type: 'editCell', row: coords.row, col: coords.col, value: value });
    cell.removeAttribute('contenteditable');
    cell.classList.remove('editing');
    editingCell = null;
    editMode = null;
    cell.removeEventListener('blur', onBlurHandler);
    if (wasCompact) applyCompactNewlineMarkers(cell);
  };
  cell.addEventListener('blur', onBlurHandler);
  event ? setCursorAtPoint(cell, event.clientX, event.clientY) : setCursorToEnd(cell);
};

table.addEventListener('dblclick', e => {
  if (getSortBtnTarget(e.target)) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  const edgeTarget = getCellTarget(e.target);
  const edge = getResizeEdgeInfo(edgeTarget, e);
  if (edge) {
    e.preventDefault();
    e.stopPropagation();
    if (edge.axis === 'column') {
      resetColumnWidth(edge.index);
    } else {
      resetRowHeight(edge.index);
    }
    persistState();
    return;
  }
  const link = getLinkTarget(e.target);
  if (link) {
    e.preventDefault();
    // Ctrl/Cmd+click is handled by the click listener; do not enter edit mode here.
    if (e.ctrlKey || e.metaKey) {
      e.stopPropagation();
      return;
    }
  }
  const target = getCellTarget(e.target);
  if (!target) return;
  clearSelection();
  editCell(target, e);
});

const copySelectionToClipboard = () => {
  if (currentSelection.length === 0) return;

  // Only copy real data/header columns; skip serial index column (col === -1)
  const coords = currentSelection
    .map(cell => getCellCoords(cell))
    .filter(c => !isNaN(c.row) && !isNaN(c.col) && c.col >= 0);
  if (coords.length === 0) return;
  const minRow = Math.min(...coords.map(c => c.row)), maxRow = Math.max(...coords.map(c => c.row));
  const minCol = Math.min(...coords.map(c => c.col)), maxCol = Math.max(...coords.map(c => c.col));
  let csv = '';
  for(let r = minRow; r <= maxRow; r++){
    let rowVals = [];
    for(let c = minCol; c <= maxCol; c++){
      const selector = (hasHeader && r === 0 ? 'th' : 'td') + '[data-row="'+r+'"][data-col="'+c+'"]';
      const cell = table.querySelector(selector);
      // Prefer data-full-text so multiline/long values copy completely.
      rowVals.push(cell ? getFullCellText(cell) : '');
    }
    csv += rowVals.join(CSV_SEPARATOR) + '\n';
  }
  vscode.postMessage({ type: 'copyToClipboard', text: csv.trimEnd() });
};

window.addEventListener('message', event => {
  const message = event.data;
  if(message.type === 'focus'){
    if (anchorCell) {
      try { anchorCell.focus({ preventScroll: true }); } catch { try { anchorCell.focus(); } catch {} }
    } else {
      try { document.body.focus({ preventScroll: true }); } catch { try { document.body.focus(); } catch {} }
    }
  } else if (message.type === 'chunkData') {
    const requestId = Number(message.requestId);
    const start = Number(message.start);
    if (remoteChunkRequestInFlight) {
      if (!Number.isInteger(requestId) || requestId !== remoteChunkRequestSeq) {
        return;
      }
      if (!Number.isInteger(start) || start !== remoteChunkRequestedStart) {
        return;
      }
    }
    remoteChunkRequestInFlight = false;
    const requestedCount = remoteChunkRequestedCount;
    remoteChunkRequestedStart = -1;
    remoteChunkRequestedCount = 0;
    const html = typeof message.html === 'string' ? message.html : '';
    const nextStart = Number(message.nextStart);
    const done = !!message.done;

    if (USE_WINDOWED_SCROLL && typeof window.__csvOnWindowChunk === 'function') {
      window.__csvOnWindowChunk(start, html, requestedCount || 0);
      if (pendingEnsureTarget) ensureTargetStep();
      return;
    }

    if (html.length > 0) {
      csvChunks.push(html);
    }
    if (!done && Number.isInteger(nextStart) && nextStart >= 0) {
      remoteNextChunkStart = nextStart;
      remoteHasMoreChunks = true;
    } else {
      remoteNextChunkStart = -1;
      remoteHasMoreChunks = false;
    }
    if (csvChunks.length && pendingEnsureTarget) {
      ensureTargetStep();
    } else if (csvChunks.length && nearBottom()) {
      loadNextChunk();
    }
  } else if(message.type === 'updateCell'){
    isUpdating = true;
    const { row, col, value, rendered } = message;
    const cell = table.querySelector('td[data-row="'+row+'"][data-col="'+col+'"], th[data-row="'+row+'"][data-col="'+col+'"]');
    if (cell) {
      if (typeof rendered === 'string') {
        cell.innerHTML = rendered;
      } else {
        cell.textContent = value;
      }
      if (table.classList.contains('row-compact')) {
        applyCompactNewlineMarkers(cell);
      }
    }
    isUpdating = false;
    if (csvFindReplace && csvFindReplace.isOpen() && csvFindReplace.hasQuery()) {
      csvFindReplace.schedule(true);
    }
  } else if (message.type === 'pasteApplied') {
    const startRow = Number(message.startRow);
    const startCol = Number(message.startCol);
    const endRow = Number(message.endRow);
    const endCol = Number(message.endCol);
    if (
      !Number.isInteger(startRow) || !Number.isInteger(startCol) ||
      !Number.isInteger(endRow) || !Number.isInteger(endCol) ||
      startRow < 0 || startCol < 0 || endRow < startRow || endCol < startCol
    ) {
      return;
    }
    const startCell = ensureRenderedCellByCoords(startRow, startCol);
    const endCell = ensureRenderedCellByCoords(endRow, endCol);
    if (!startCell || !endCell) {
      return;
    }
    anchorCell = startCell;
    rangeEndCell = endCell;
    selectRange({ row: startRow, col: startCol }, { row: endRow, col: endCol });
    persistState();
    try { startCell.focus({ preventScroll: true }); } catch { try { startCell.focus(); } catch {} }
    endCell.scrollIntoView({ block:'nearest', inline:'nearest', behavior:'smooth' });
  } else if (message.type === 'filterSortResult') {
    // Re-render the first filtered/sorted page. Large results continue through
    // the same remote chunk protocol as initial rendering, avoiding a giant DOM
    // rebuild for 50MB-class files.
    const rows = Array.isArray(message.rows) ? message.rows : [];
    const addSerialIndex = !!message.addSerialIndex;
    const tbody = table ? table.querySelector('tbody') : null;
    csvChunks = [];
    remoteChunkRequestInFlight = false;
    remoteChunkRequestedStart = -1;
    pendingEnsureTarget = null;
    const nextStart = Number(message.nextChunkStart);
    if (message.hasRemoteChunks && Number.isInteger(nextStart) && nextStart >= 0) {
      remoteNextChunkStart = nextStart;
      remoteHasMoreChunks = true;
    } else {
      remoteNextChunkStart = -1;
      remoteHasMoreChunks = false;
    }
    if (tbody) {
      const html = rows.map(r => {
        const cells = [];
        if (addSerialIndex) {
          cells.push('<td tabindex="0" data-row="' + r.absRow + '" data-col="-1">' + r.displayIdx + '</td>');
        }
        const rcells = Array.isArray(r.cells) ? r.cells : [];
        for (let c = 0; c < rcells.length; c++) {
          const cell = rcells[c] || { value: '', rendered: '' };
          const rendered = typeof cell.rendered === 'string' && cell.rendered.length > 0 ? cell.rendered : (cell.value || '');
          cells.push('<td tabindex="0" data-row="' + r.absRow + '" data-col="' + c + '"><div class="cell-body">' + rendered + '</div></td>');
        }
        return '<tr>' + cells.join('') + '</tr>';
      }).join('');
      tbody.innerHTML = html;
      if (table.classList.contains('row-compact')) {
        applyCompactNewlineMarkers(tbody);
      }
      applySizeStateToRenderedCells();
      primeChunkObserver();
    }
    // Sync sort indicator with the authoritative state coming back from host.
    if (typeof message.sortCol === 'number' && message.sortDir) {
      currentSortCol = message.sortCol;
      currentSortAsc = message.sortDir === 'asc';
    } else {
      currentSortCol = null;
      currentSortAsc = true;
    }
    try { updateSortHeaderIndicator(); } catch {}
    try { window.dispatchEvent(new CustomEvent('csvFilterSortResult', { detail: message })); } catch {}
    if (csvFindReplace && csvFindReplace.isOpen() && csvFindReplace.hasQuery()) {
      csvFindReplace.schedule(true);
    }
  } else if (message.type === 'findMatchesResult') {
    if (csvFindReplace) csvFindReplace.handleFindMatchesResult(message);
  }
});

// After initial restoreState, if there's a pending edit request, perform it
const maybeResumePendingEdit = () => {
  try {
    const st = vscode.getState() || {};
    if (st && typeof st.anchorRow === 'number' && typeof st.anchorCol === 'number' && st.pendingEdit === 'detail') {
      const tag = (hasHeader && st.anchorRow === 0 ? 'th' : 'td');
      const sel = table.querySelector(`${tag}[data-row="${st.anchorRow}"][data-col="${st.anchorCol}"]`);
      if (sel) {
        editCell(sel, undefined, 'detail');
        // clear pending flag
        const next = { ...st };
        delete next.pendingEdit;
        vscode.setState(next);
      }
    }
  } catch {}
};

// Try after load and after visibility/focus restores
setTimeout(maybeResumePendingEdit, 0);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(maybeResumePendingEdit, 0); });
window.addEventListener('focus', () => { setTimeout(maybeResumePendingEdit, 0); }, { passive: true });

document.addEventListener('keydown', e => {
  if (csvFindReplace && csvFindReplace.isOpen()) {
    return;
  }
  if(!editingCell && e.key === 'Escape'){
    clearSelection();
  }
});

try { updateSortHeaderIndicator(); } catch {}

window.CsvWebviewBridge = {
  postMessage: msg => vscode.postMessage(msg),
  getSortState: () => ({ currentSortCol, currentSortAsc }),
  applyCompactNewlineMarkers,
  restoreCompactNewlineMarkers,
};
