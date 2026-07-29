/* Lightweight floating filter panel + per-header filter buttons. */
(function initFloatPanel() {
  const bridge = window.CsvWebviewBridge;
  if (!bridge) return;

  const searchInput = document.getElementById('csvGlobalSearch');
  const clearBtn = document.getElementById('csvClearFilter');
  const rhBtn = document.getElementById('csvRowHeightToggle');
  const filterStatus = document.getElementById('csvFilterStatus');
  const columnToggle = document.getElementById('csvColumnFilterToggle');
  const columnPopover = document.getElementById('csvColumnFilterPopover');
  const columnInput = document.getElementById('csvColumnFilterColumn');
  const columnModeSelect = document.getElementById('csvColumnFilterMode');
  const columnValueInput = document.getElementById('csvColumnFilterValue');
  const columnIgnoreCase = document.getElementById('csvColumnFilterIgnoreCase');
  const columnIgnoreWhitespace = document.getElementById('csvColumnFilterIgnoreWhitespace');
  const columnAddBtn = document.getElementById('csvColumnFilterAdd');
  const columnChips = document.getElementById('csvColumnFilterChips');
  const columnClearBtn = document.getElementById('csvColumnFilterClear');

  const readJsonScript = (id, fallback) => {
    const el = document.getElementById(id);
    if (!el) return fallback;
    try { return JSON.parse(el.textContent || ''); } catch { return fallback; }
  };

  const normalizeCondition = raw => {
    if (typeof raw === 'string') {
      const value = raw.trim();
      return value ? { value, mode: 'contains', ignoreCase: true, ignoreWhitespace: false } : null;
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
  };

  const normalizeFilters = raw => {
    const out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    for (const [key, value] of Object.entries(raw)) {
      if (!/^\d+$/.test(key)) continue;
      const condition = normalizeCondition(value);
      if (condition) out[String(Number(key))] = condition;
    }
    return out;
  };

  let columnLabels = readJsonScript('__csvColumnLabels', []);
  if (!Array.isArray(columnLabels)) columnLabels = [];
  let columnFilters = normalizeFilters(readJsonScript('__csvColumnFilters', {}));
  let selectedColumnIndex = 0;

  const columnLabel = index => `${index + 1}. ${String(columnLabels[index] || `列 ${index + 1}`)}`;
  const setSelectedColumn = index => {
    const max = Math.max(0, columnLabels.length - 1);
    selectedColumnIndex = Math.min(max, Math.max(0, Number(index) || 0));
    if (columnInput) {
      columnInput.value = columnLabel(selectedColumnIndex);
      columnInput.setAttribute('data-selected-col', String(selectedColumnIndex));
    }
  };

  const syncStatus = () => {
    if (!filterStatus) return;
    const parts = [];
    if (searchInput && searchInput.value) parts.push(`全局:"${searchInput.value}"`);
    const count = Object.keys(columnFilters).length;
    if (count) parts.push(`${count} 个列过滤`);
    filterStatus.textContent = parts.join(' · ');
  };

  const sendFilter = () => {
    const sortState = bridge.getSortState();
    bridge.postMessage({
      type: 'filterSort',
      globalSearch: searchInput ? searchInput.value : '',
      columnFilters: { ...columnFilters },
      sortCol: typeof sortState.currentSortCol === 'number' ? sortState.currentSortCol : -1,
      sortDir: sortState.currentSortCol === null ? null : (sortState.currentSortAsc ? 'asc' : 'desc'),
    });
    syncStatus();
  };

  const updateHeaderButtons = () => {
    const table = document.querySelector('#csv-root table');
    if (!table) return;
    table.querySelectorAll('thead th[data-col]').forEach(th => {
      const col = Number(th.getAttribute('data-col'));
      if (!Number.isInteger(col) || col < 0) return;
      let btn = th.querySelector(':scope > .csv-header-filter-btn');
      if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'csv-header-filter-btn';
        btn.setAttribute('data-col-filter-btn', String(col));
        btn.setAttribute('aria-label', `筛选 ${columnLabel(col)}`);
        btn.title = `筛选 ${columnLabel(col)}`;
        btn.textContent = '⌄';
        Object.assign(btn.style, {
          float: 'right', marginLeft: '6px', border: '0', background: 'transparent',
          color: 'inherit', cursor: 'pointer', opacity: '0.65', padding: '0 2px', font: 'inherit'
        });
        btn.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
        btn.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          setSelectedColumn(col);
          const existing = columnFilters[String(col)];
          if (existing && columnValueInput) {
            columnValueInput.value = existing.value;
            if (columnModeSelect) columnModeSelect.value = existing.mode;
            if (columnIgnoreCase) columnIgnoreCase.checked = existing.ignoreCase;
            if (columnIgnoreWhitespace) columnIgnoreWhitespace.checked = existing.ignoreWhitespace;
          } else if (columnValueInput) {
            columnValueInput.value = '';
          }
          if (columnPopover) columnPopover.hidden = false;
          if (columnToggle) columnToggle.setAttribute('aria-expanded', 'true');
          if (columnValueInput) { columnValueInput.focus(); columnValueInput.select(); }
        });
        th.appendChild(btn);
      }
      const active = !!columnFilters[String(col)];
      btn.textContent = active ? '▼' : '⌄';
      btn.style.opacity = active ? '1' : '0.65';
      btn.style.color = active ? '#0a84ff' : 'inherit';
    });
  };

  const renderChips = () => {
    if (columnChips) {
      columnChips.textContent = '';
      Object.entries(columnFilters).sort((a, b) => Number(a[0]) - Number(b[0])).forEach(([col, condition]) => {
        const chip = document.createElement('span');
        chip.className = 'csv-filter-chip';
        chip.textContent = `${columnLabel(Number(col))} ${condition.mode === 'equals' ? '等于' : '包含'}: ${condition.value} `;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = '×';
        remove.title = '清除此列过滤';
        remove.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          delete columnFilters[col];
          renderChips();
          sendFilter();
        });
        chip.appendChild(remove);
        columnChips.appendChild(chip);
      });
    }
    if (columnClearBtn) columnClearBtn.style.display = Object.keys(columnFilters).length ? '' : 'none';
    updateHeaderButtons();
    syncStatus();
  };

  const applyColumnFilter = () => {
    if (!columnValueInput) return;
    const key = String(selectedColumnIndex);
    const value = columnValueInput.value.trim();
    if (!value) {
      delete columnFilters[key];
    } else {
      columnFilters[key] = {
        value,
        mode: columnModeSelect && columnModeSelect.value === 'equals' ? 'equals' : 'contains',
        ignoreCase: columnIgnoreCase ? columnIgnoreCase.checked : true,
        ignoreWhitespace: columnIgnoreWhitespace ? columnIgnoreWhitespace.checked : false,
      };
    }
    renderChips();
    sendFilter();
  };

  if (searchInput) {
    searchInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); sendFilter(); }
    });
    searchInput.addEventListener('input', () => {
      if (clearBtn) clearBtn.style.display = searchInput.value ? '' : 'none';
    });
  }
  if (clearBtn) clearBtn.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';
    clearBtn.style.display = 'none';
    sendFilter();
  });
  if (columnToggle && columnPopover) columnToggle.addEventListener('click', () => {
    columnPopover.hidden = !columnPopover.hidden;
    columnToggle.setAttribute('aria-expanded', String(!columnPopover.hidden));
    if (!columnPopover.hidden && columnValueInput) columnValueInput.focus();
  });
  if (columnAddBtn) columnAddBtn.addEventListener('click', applyColumnFilter);
  if (columnValueInput) columnValueInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); applyColumnFilter(); }
    if (e.key === 'Escape' && columnPopover) columnPopover.hidden = true;
  });
  if (columnClearBtn) columnClearBtn.addEventListener('click', () => {
    columnFilters = {};
    renderChips();
    sendFilter();
  });

  if (rhBtn) rhBtn.addEventListener('click', () => {
    const table = document.querySelector('#csv-root table');
    const next = (rhBtn.getAttribute('data-mode') || 'compact') === 'compact' ? 'wrap' : 'compact';
    rhBtn.setAttribute('data-mode', next);
    rhBtn.textContent = next === 'compact' ? '紧凑' : '自然折行';
    if (table) {
      table.classList.remove('row-compact', 'row-wrap');
      table.classList.add(`row-${next}`);
      if (next === 'compact') bridge.applyCompactNewlineMarkers(table);
      else bridge.restoreCompactNewlineMarkers(table);
    }
    bridge.postMessage({ type: 'setRowHeightMode', mode: next });
  });

  window.addEventListener('csvChunkLoaded', updateHeaderButtons);
  window.addEventListener('csvFilterSortResult', e => {
    const detail = e.detail || {};
    if (Array.isArray(detail.columnLabels)) columnLabels = detail.columnLabels;
    columnFilters = normalizeFilters(detail.columnFilters);
    if (searchInput && typeof detail.globalSearch === 'string') searchInput.value = detail.globalSearch;
    renderChips();
  });

  window.CsvFilterPanelBridge = {
    setColumn: setSelectedColumn,
    editColumnFilter: col => {
      const index = Number(col);
      setSelectedColumn(index);
      const condition = columnFilters[String(index)];
      if (condition && columnValueInput) columnValueInput.value = condition.value;
    },
  };

  setSelectedColumn(0);
  renderChips();
})();
