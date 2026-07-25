/* ------------------------------------------------------------------------ *
 * Floating panel: global filter input + column filters + row-height cycle.
 *
 * Depends on the small CsvWebviewBridge exposed by main.js.
 * ------------------------------------------------------------------------ */
(function initFloatPanel() {
  const bridge = window.CsvWebviewBridge;
  if (!bridge) return;

  const searchInput = document.getElementById('csvGlobalSearch');
  const clearBtn    = document.getElementById('csvClearFilter');
  const rhBtn       = document.getElementById('csvRowHeightToggle');
  const filterStatus = document.getElementById('csvFilterStatus');
  const columnToggle = document.getElementById('csvColumnFilterToggle');
  const columnPopover = document.getElementById('csvColumnFilterPopover');
  const columnInput = document.getElementById('csvColumnFilterColumn');
  const columnOptions = document.getElementById('csvColumnFilterOptions');
  const columnModeSelect = document.getElementById('csvColumnFilterMode');
  const columnValueInput = document.getElementById('csvColumnFilterValue');
  const columnIgnoreCase = document.getElementById('csvColumnFilterIgnoreCase');
  const columnIgnoreWhitespace = document.getElementById('csvColumnFilterIgnoreWhitespace');
  const columnAddBtn = document.getElementById('csvColumnFilterAdd');
  const columnChips = document.getElementById('csvColumnFilterChips');
  const columnClearBtn = document.getElementById('csvColumnFilterClear');

  const ROW_HEIGHT_CYCLE = ['compact', 'wrap'];
  const ROW_HEIGHT_LABEL = { compact: '紧凑', wrap: '自然折行' };
  const readJsonScript = (id, fallback) => {
    const el = document.getElementById(id);
    if (!el) return fallback;
    try { return JSON.parse(el.textContent || ''); } catch { return fallback; }
  };
  const initialLabels = readJsonScript('__csvColumnLabels', []);
  let columnLabels = Array.isArray(initialLabels) ? initialLabels : [];
  let columnFilters = normalizeColumnFilters(readJsonScript('__csvColumnFilters', {}));
  let selectedColumnIndex = 0;
  let activeColumnOptionIndex = 0;
  if (columnOptions && columnOptions.parentElement !== document.body) {
    document.body.appendChild(columnOptions);
  }

  const applyRowHeightClass = mode => {
    const tbl = document.querySelector('#csv-root table');
    if (!tbl) return;
    const prev = ROW_HEIGHT_CYCLE.find(m => tbl.classList.contains(`row-${m}`));
    for (const m of ROW_HEIGHT_CYCLE) tbl.classList.remove(`row-${m}`);
    tbl.classList.add(`row-${mode}`);
    if (mode === 'compact') {
      bridge.applyCompactNewlineMarkers(tbl);
    } else if (mode !== 'compact' && prev === 'compact') {
      bridge.restoreCompactNewlineMarkers(tbl);
    }
  };

  if (rhBtn) {
    rhBtn.addEventListener('click', () => {
      const cur  = rhBtn.getAttribute('data-mode') || 'compact';
      const idx  = ROW_HEIGHT_CYCLE.indexOf(cur);
      const next = ROW_HEIGHT_CYCLE[(idx + 1) % ROW_HEIGHT_CYCLE.length];
      rhBtn.setAttribute('data-mode', next);
      rhBtn.textContent = ROW_HEIGHT_LABEL[next];
      applyRowHeightClass(next);
      bridge.postMessage({ type: 'setRowHeightMode', mode: next });
    });
  }

  // 初始加载时如果已是紧凑模式，也处理换行符
  const initMode = rhBtn ? (rhBtn.getAttribute('data-mode') || 'compact') : 'compact';
  if (initMode === 'compact') applyRowHeightClass('compact');

  // chunk动态加载时，如果当前是紧凑模式，也处理新行的换行符
  window.addEventListener('csvChunkLoaded', () => {
    const tbl = document.querySelector('#csv-root table');
    if (tbl && tbl.classList.contains('row-compact')) {
      bridge.applyCompactNewlineMarkers(tbl);
    }
  });

  // Throttle search input to avoid re-filtering on every keystroke for large CSVs.
  const FILTER_DEBOUNCE_MS = 200;
  let filterTimer = null;
  function normalizeColumnFilters(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const next = {};
    for (const [key, value] of Object.entries(raw)) {
      if (!/^\d+$/.test(String(key))) continue;
      const condition = normalizeColumnFilterCondition(value);
      if (!condition) continue;
      next[String(Number(key))] = condition;
    }
    return next;
  }
  function normalizeColumnFilterCondition(raw) {
    if (typeof raw === 'string') {
      const text = raw.trim();
      if (!text) return null;
      return { value: text, mode: 'contains', ignoreCase: true, ignoreWhitespace: false };
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = typeof raw.value === 'string' ? raw.value.trim() : '';
    if (!value) return null;
    return {
      value,
      mode: raw.mode === 'equals' ? 'equals' : 'contains',
      ignoreCase: raw.ignoreCase !== false,
      ignoreWhitespace: raw.ignoreWhitespace === true,
    };
  }
  const describeCondition = condition => {
    const parts = [condition.mode === 'equals' ? '等于' : '包含'];
    if (condition.ignoreCase) parts.push('忽略大小写');
    if (condition.ignoreWhitespace) parts.push('忽略空格');
    return parts.join('/');
  };
  const getColumnLabel = col => {
    const idx = Number(col);
    const label = columnLabels[idx] || `列 ${idx + 1}`;
    return `${idx + 1}. ${label}`;
  };
  const getColumnQuery = () => (columnInput ? String(columnInput.value || '').trim().toLowerCase() : '');
  /** Build the dropdown list. Empty / exact-selected label → all columns; typing filters. No hard cap. */
  const getColumnCandidates = (opts = {}) => {
    const all = columnLabels.map((label, index) => ({
      index,
      label: String(label || '').trim() || `列 ${index + 1}`,
      display: getColumnLabel(index)
    }));
    let query = opts.showAll ? '' : getColumnQuery();
    // Click/focus keeps the selected label in the input; treat that as "browse all", not a filter.
    if (query) {
      const selectedDisplay = getColumnLabel(selectedColumnIndex).toLowerCase();
      if (query === selectedDisplay) query = '';
    }
    if (!query) return all;
    return all.filter(item => {
      const humanIndex = String(item.index + 1);
      const zeroIndex = String(item.index);
      return humanIndex.includes(query) ||
        zeroIndex === query ||
        item.label.toLowerCase().includes(query) ||
        item.display.toLowerCase().includes(query);
    });
  };
  const setSelectedColumn = (index, updateInput = true) => {
    if (!columnInput) return;
    const max = Math.max(0, columnLabels.length - 1);
    selectedColumnIndex = Number.isInteger(index) ? Math.min(max, Math.max(0, index)) : 0;
    columnInput.setAttribute('data-selected-col', String(selectedColumnIndex));
    if (updateInput) columnInput.value = getColumnLabel(selectedColumnIndex);
  };
  const closeColumnOptions = () => {
    if (!columnOptions || !columnInput) return;
    columnOptions.hidden = true;
    columnInput.setAttribute('aria-expanded', 'false');
  };
  const positionColumnOptions = () => {
    if (!columnOptions || !columnInput) return;
    const rect = columnInput.getBoundingClientRect();
    const width = Math.min(360, Math.max(rect.width, Math.min(280, window.innerWidth - 32)));
    const left = Math.max(16, Math.min(rect.left, window.innerWidth - width - 16));
    // Match CSS max-height so long column lists scroll instead of being clipped.
    const maxListHeight = Math.min(Math.floor(window.innerHeight * 0.5), 420);
    const estimatedHeight = Math.min(maxListHeight, columnOptions.scrollHeight || maxListHeight);
    const topAbove = rect.top - estimatedHeight - 6;
    const top = topAbove >= 8 ? topAbove : Math.min(window.innerHeight - estimatedHeight - 8, rect.bottom + 6);
    columnOptions.style.left = `${Math.round(left)}px`;
    columnOptions.style.top = `${Math.max(8, Math.round(top))}px`;
    columnOptions.style.width = `${Math.round(width)}px`;
    columnOptions.style.maxHeight = `${maxListHeight}px`;
  };
  const renderColumnOptions = (opts = {}) => {
    if (!columnOptions || !columnInput) return;
    const candidates = getColumnCandidates(opts);
    columnOptions.textContent = '';
    if (!candidates.length) {
      const empty = document.createElement('div');
      empty.className = 'csv-column-option';
      empty.textContent = '无匹配列';
      columnOptions.appendChild(empty);
      columnOptions.hidden = false;
      columnInput.setAttribute('aria-expanded', 'true');
      positionColumnOptions();
      return;
    }
    activeColumnOptionIndex = Math.min(Math.max(0, activeColumnOptionIndex), candidates.length - 1);
    candidates.forEach((item, idx) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = `csv-column-option${idx === activeColumnOptionIndex ? ' active' : ''}`;
      option.setAttribute('role', 'option');
      option.setAttribute('data-col', String(item.index));
      option.textContent = item.display;
      option.addEventListener('mousedown', e => e.preventDefault());
      option.addEventListener('click', () => {
        setSelectedColumn(item.index);
        closeColumnOptions();
        if (columnValueInput) columnValueInput.focus();
      });
      columnOptions.appendChild(option);
    });
    columnOptions.hidden = false;
    columnInput.setAttribute('aria-expanded', 'true');
    positionColumnOptions();
  };
  const resolveTypedColumn = () => {
    if (!columnInput) return selectedColumnIndex;
    const raw = String(columnInput.value || '').trim();
    if (!raw) {
      setSelectedColumn(selectedColumnIndex);
      return selectedColumnIndex;
    }
    const currentDisplay = getColumnLabel(selectedColumnIndex);
    if (raw === currentDisplay) return selectedColumnIndex;
    const exactZeroBased = Number(raw);
    if (/^\d+$/.test(raw)) {
      const idx = exactZeroBased >= 1 ? exactZeroBased - 1 : exactZeroBased;
      if (Number.isInteger(idx) && idx >= 0 && idx < columnLabels.length) {
        setSelectedColumn(idx);
        return idx;
      }
    }
    const candidates = getColumnCandidates();
    if (candidates.length) {
      const picked = candidates[Math.min(activeColumnOptionIndex, candidates.length - 1)];
      setSelectedColumn(picked.index);
      return picked.index;
    }
    setSelectedColumn(selectedColumnIndex);
    return selectedColumnIndex;
  };

  /** Load an existing column filter into the form for editing. */
  const editColumnFilter = (colKey) => {
    const col = String(colKey);
    const condition = columnFilters[col];
    if (!condition) return;
    const idx = Number(col);
    if (!Number.isInteger(idx) || idx < 0) return;
    setSelectedColumn(idx);
    if (columnModeSelect) columnModeSelect.value = condition.mode === 'equals' ? 'equals' : 'contains';
    if (columnIgnoreCase) columnIgnoreCase.checked = condition.ignoreCase !== false;
    if (columnIgnoreWhitespace) columnIgnoreWhitespace.checked = !!condition.ignoreWhitespace;
    if (columnValueInput) {
      columnValueInput.value = condition.value || '';
      columnValueInput.focus();
      columnValueInput.select();
    }
    closeColumnOptions();
  };

  const renderColumnFilterChips = () => {
    if (!columnChips) return;
    columnChips.textContent = '';
    const entries = Object.entries(columnFilters)
      .sort((a, b) => Number(a[0]) - Number(b[0]));
    for (const [col, condition] of entries) {
      const chip = document.createElement('span');
      chip.className = 'csv-filter-chip';
      chip.title = '点击编辑此过滤条件';
      chip.style.cursor = 'pointer';
      const text = document.createElement('span');
      text.textContent = `${getColumnLabel(col)} ${describeCondition(condition)}: ${condition.value}`;
      text.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        editColumnFilter(col);
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.title = '删除这个过滤条件并刷新';
      remove.setAttribute('aria-label', `删除 ${getColumnLabel(col)} 过滤并刷新`);
      remove.textContent = '×';
      remove.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        delete columnFilters[col];
        renderColumnFilterChips();
        sendFilter(searchInput ? searchInput.value : '', true);
      });
      chip.append(text, remove);
      columnChips.appendChild(chip);
    }
    if (columnClearBtn) {
      columnClearBtn.style.display = entries.length > 0 ? '' : 'none';
    }
  };
  const syncFilterStatus = () => {
    if (!filterStatus) return;
    const colCount = Object.keys(columnFilters).length;
    const hasGlobal = searchInput && searchInput.value.length > 0;
    const parts = [];
    if (hasGlobal) parts.push(`全局:"${searchInput.value}"`);
    if (colCount > 0) parts.push(`${colCount} 个列过滤`);
    filterStatus.textContent = parts.join(' · ');
  };
  let searchLoadingTimer = null;
  const setSearchLoading = (on) => {
    if (!filterStatus) return;
    if (on) {
      filterStatus.textContent = '搜索中…';
    } else {
      // Cancel any pending loading indicator
      if (searchLoadingTimer) { clearTimeout(searchLoadingTimer); searchLoadingTimer = null; }
      syncFilterStatus();
    }
  };
  const sendFilter = (globalSearch, immediate) => {
    syncFilterStatus();
    const sortState = bridge.getSortState();
    const payload = {
      type: 'filterSort',
      globalSearch: globalSearch,
      columnFilters: { ...columnFilters },
      sortCol: (typeof sortState.currentSortCol === 'number' ? sortState.currentSortCol : -1),
      sortDir: (sortState.currentSortCol === null ? null : (sortState.currentSortAsc ? 'asc' : 'desc')),
    };
    if (immediate) {
      if (filterTimer) { clearTimeout(filterTimer); filterTimer = null; }
      bridge.postMessage(payload);
    } else {
      if (filterTimer) clearTimeout(filterTimer);
      filterTimer = setTimeout(() => bridge.postMessage(payload), FILTER_DEBOUNCE_MS);
    }
  };
  const addOrUpdateColumnFilter = () => {
    if (!columnInput || !columnValueInput) return;
    const col = String(resolveTypedColumn());
    if (!/^\d+$/.test(col)) return;
    const value = columnValueInput.value.trim();
    if (value) {
      columnFilters[col] = {
        value,
        mode: columnModeSelect && columnModeSelect.value === 'equals' ? 'equals' : 'contains',
        ignoreCase: columnIgnoreCase ? columnIgnoreCase.checked : true,
        ignoreWhitespace: columnIgnoreWhitespace ? columnIgnoreWhitespace.checked : false,
      };
      columnValueInput.value = '';
    } else {
      delete columnFilters[col];
    }
    renderColumnFilterChips();
    sendFilter(searchInput ? searchInput.value : '', true);
    closeColumnOptions();
    columnValueInput.focus();
  };

  const syncClearVisibility = () => {
    if (!clearBtn || !searchInput) return;
    clearBtn.style.display = searchInput.value.length > 0 ? '' : 'none';
  };

  if (searchInput) {
    // Only search on Enter — no debounce on keystroke to avoid lag/jump for large files.
    searchInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (filterTimer) { clearTimeout(filterTimer); filterTimer = null; }
        const value = searchInput.value;
        if (value) setSearchLoading(true);
        sendFilter(value, /*immediate*/ true);
      }
    });
    searchInput.addEventListener('input', () => {
      syncClearVisibility();
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (!searchInput) return;
      searchInput.value = '';
      syncClearVisibility();
      if (filterTimer) { clearTimeout(filterTimer); filterTimer = null; }
      setSearchLoading(false);
      sendFilter('', /*immediate*/ true);
      searchInput.focus();
    });
  }
  if (columnToggle && columnPopover) {
    columnToggle.addEventListener('click', () => {
      const nextHidden = !columnPopover.hidden;
      columnPopover.hidden = nextHidden;
      columnToggle.setAttribute('aria-expanded', String(!nextHidden));
      if (!nextHidden && columnValueInput) columnValueInput.focus();
    });
  }
  if (columnInput) {
    setSelectedColumn(selectedColumnIndex);
    columnInput.addEventListener('focus', () => {
      columnInput.select();
      activeColumnOptionIndex = 0;
      // Open with full list (selected label is not treated as a search query).
      renderColumnOptions({ showAll: true });
    });
    columnInput.addEventListener('input', () => {
      activeColumnOptionIndex = 0;
      renderColumnOptions();
    });
    columnInput.addEventListener('keydown', e => {
      const candidates = getColumnCandidates();
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeColumnOptionIndex = candidates.length ? (activeColumnOptionIndex + 1) % candidates.length : 0;
        renderColumnOptions();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeColumnOptionIndex = candidates.length ? (activeColumnOptionIndex - 1 + candidates.length) % candidates.length : 0;
        renderColumnOptions();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        resolveTypedColumn();
        closeColumnOptions();
        if (columnValueInput) columnValueInput.focus();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setSelectedColumn(selectedColumnIndex);
        closeColumnOptions();
      }
    });
    columnInput.addEventListener('blur', () => {
      setTimeout(() => {
        setSelectedColumn(selectedColumnIndex);
        closeColumnOptions();
      }, 120);
    });
    window.addEventListener('resize', () => {
      if (!columnOptions || columnOptions.hidden) return;
      positionColumnOptions();
    }, { passive: true });
    window.addEventListener('scroll', () => {
      if (!columnOptions || columnOptions.hidden) return;
      positionColumnOptions();
    }, { passive: true });
  }
  if (columnAddBtn) {
    columnAddBtn.addEventListener('click', addOrUpdateColumnFilter);
  }
  if (columnValueInput) {
    columnValueInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addOrUpdateColumnFilter();
      } else if (e.key === 'Escape' && columnPopover) {
        columnPopover.hidden = true;
        if (columnToggle) columnToggle.setAttribute('aria-expanded', 'false');
      }
    });
  }
  if (columnClearBtn) {
    columnClearBtn.addEventListener('click', () => {
      columnFilters = {};
      renderColumnFilterChips();
      sendFilter(searchInput ? searchInput.value : '', true);
    });
  }

  // When user focuses a data cell in the table, auto-select that column for filtering.
  document.addEventListener('focusin', e => {
    const target = e.target;
    if (!target || typeof target.closest !== 'function') return;
    // Ignore focus inside the filter panel itself
    if (target.closest('#csvFloatPanel') || target.closest('#csvColumnFilterOptions')) return;
    const cell = target.closest('td[data-col], th[data-col]');
    if (!cell) return;
    const col = parseInt(cell.getAttribute('data-col') || '', 10);
    if (!Number.isInteger(col) || col < 0) return;
    if (col === selectedColumnIndex) return;
    setSelectedColumn(col);
  }, true);

  window.addEventListener('csvFilterSortResult', e => {
    const detail = e.detail || {};
    if (Array.isArray(detail.columnLabels)) {
      columnLabels = detail.columnLabels;
      setSelectedColumn(selectedColumnIndex);
    }
    columnFilters = normalizeColumnFilters(detail.columnFilters);
    // Restore global search from extension state (survives webview re-render)
    const savedGlobal = (typeof detail.globalSearch === 'string') ? detail.globalSearch : '';
    if (searchInput) searchInput.value = savedGlobal;
    syncClearVisibility();
    setSearchLoading(false);
    renderColumnFilterChips();
    syncFilterStatus();
  });

  window.CsvFilterPanelBridge = {
    setColumn: (index) => setSelectedColumn(index),
    editColumnFilter,
  };

  renderColumnFilterChips();
  setSelectedColumn(selectedColumnIndex);
  syncFilterStatus();
})();
