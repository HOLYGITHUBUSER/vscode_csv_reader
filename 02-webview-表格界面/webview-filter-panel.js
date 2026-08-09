/* Per-header sort/filter popovers + compact active-filter/row-height footer. */
(function initFilterPanel() {
  const bridge = window.CsvWebviewBridge;
  if (!bridge) return;

  const rhBtn = document.getElementById('csvRowHeightToggle');
  const activeFilters = document.getElementById('csvActiveFilters');
  const filterDivider = document.getElementById('csvPanelDivider');
  const columnChips = document.getElementById('csvColumnFilterChips');

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

  const columnLabel = index => `${index + 1}. ${String(columnLabels[index] || `列 ${index + 1}`)}`;

  const sendFilter = () => {
    const sortState = bridge.getSortState();
    bridge.postMessage({
      type: 'filterSort',
      globalSearch: '',
      columnFilters: { ...columnFilters },
      sortCol: typeof sortState.currentSortCol === 'number' ? sortState.currentSortCol : -1,
      sortDir: sortState.currentSortCol === null ? null : (sortState.currentSortAsc ? 'asc' : 'desc'),
    });
  };

  let headerMenu = null;
  const closeHeaderMenu = () => {
    if (headerMenu) headerMenu.remove();
    headerMenu = null;
  };

  const styleMenu = (menu, kind) => {
    Object.assign(menu.style, {
      position: 'fixed',
      zIndex: '1300',
      boxSizing: 'border-box',
      width: kind === 'filter' ? '288px' : '180px',
      padding: kind === 'filter' ? '10px' : '4px',
      border: '1px solid var(--vscode-menu-border, #666)',
      borderRadius: '6px',
      background: 'var(--vscode-menu-background, #252526)',
      color: 'var(--vscode-menu-foreground, #f0f0f0)',
      boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
      font: 'inherit',
    });
  };

  const styleField = field => {
    Object.assign(field.style, {
      boxSizing: 'border-box',
      height: '28px',
      border: '1px solid var(--vscode-input-border, #666)',
      borderRadius: '4px',
      background: 'var(--vscode-input-background, #3c3c3c)',
      color: 'var(--vscode-input-foreground, #f0f0f0)',
      font: 'inherit',
      outline: 'none',
    });
  };

  const createActionButton = (label, action, primary) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.setAttribute('data-header-action', action);
    Object.assign(button.style, {
      height: '28px',
      padding: '0 12px',
      border: primary ? '1px solid var(--vscode-button-border, transparent)' : '1px solid var(--vscode-button-secondaryBackground, #555)',
      borderRadius: '4px',
      background: primary
        ? 'var(--vscode-button-background, #0e639c)'
        : 'var(--vscode-button-secondaryBackground, #3a3d41)',
      color: primary
        ? 'var(--vscode-button-foreground, #fff)'
        : 'var(--vscode-button-secondaryForeground, #fff)',
      cursor: 'pointer',
      font: 'inherit',
    });
    return button;
  };

  const addSortItem = (menu, label, action, handler) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.textContent = label;
    item.setAttribute('role', 'menuitem');
    item.setAttribute('data-header-action', action);
    Object.assign(item.style, {
      display: 'block',
      width: '100%',
      padding: '6px 10px',
      border: '0',
      borderRadius: '4px',
      background: 'transparent',
      color: 'inherit',
      textAlign: 'left',
      cursor: 'pointer',
      font: 'inherit',
    });
    item.addEventListener('mouseenter', () => {
      item.style.background = 'var(--vscode-menu-selectionBackground, #094771)';
    });
    item.addEventListener('mouseleave', () => { item.style.background = 'transparent'; });
    item.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      closeHeaderMenu();
      handler();
    });
    menu.appendChild(item);
  };

  const renderChips = () => {
    const entries = Object.entries(columnFilters).sort((a, b) => Number(a[0]) - Number(b[0]));
    if (columnChips) {
      columnChips.textContent = '';
      entries.forEach(([col, condition]) => {
        const chip = document.createElement('span');
        chip.className = 'csv-filter-chip';

        const mode = condition.mode === 'equals' ? '等于' : '包含';
        const options = [mode, condition.ignoreCase ? '忽略大小写' : '区分大小写'];
        if (condition.ignoreWhitespace) options.push('忽略空格');
        const summaryText = `${columnLabel(Number(col))} · ${options.join(' · ')}: ${condition.value}`;

        const summary = document.createElement('span');
        summary.textContent = summaryText;
        summary.title = summaryText;
        chip.appendChild(summary);

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = '×';
        remove.title = `删除 ${columnLabel(Number(col))} 的过滤`;
        remove.setAttribute('aria-label', remove.title);
        remove.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          delete columnFilters[col];
          renderChips();
          sendFilter();
        });
        chip.appendChild(remove);
        columnChips.appendChild(chip);
      });
    }
    if (activeFilters) activeFilters.hidden = entries.length === 0;
    if (filterDivider) filterDivider.hidden = entries.length === 0;
    updateHeaderButtons();
  };

  const appendFilterEditor = (menu, col) => {
    const key = String(col);
    const existing = columnFilters[key];

    const title = document.createElement('div');
    title.textContent = `过滤：${columnLabel(col)}`;
    Object.assign(title.style, {
      marginBottom: '8px',
      fontWeight: '600',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    });
    menu.appendChild(title);

    const valueInput = document.createElement('input');
    valueInput.type = 'text';
    valueInput.value = existing ? existing.value : '';
    valueInput.placeholder = '输入过滤词';
    valueInput.setAttribute('aria-label', `${columnLabel(col)} 过滤词`);
    valueInput.setAttribute('data-header-filter-input', '');
    styleField(valueInput);
    Object.assign(valueInput.style, {
      display: 'block',
      width: '100%',
      padding: '0 8px',
      marginBottom: '8px',
    });
    menu.appendChild(valueInput);

    const modeRow = document.createElement('div');
    Object.assign(modeRow.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      marginBottom: '8px',
    });

    const modeLabel = document.createElement('span');
    modeLabel.textContent = '匹配方式';
    modeLabel.style.flex = '1 1 auto';
    modeRow.appendChild(modeLabel);

    const modeSelect = document.createElement('select');
    modeSelect.setAttribute('aria-label', '匹配方式');
    modeSelect.setAttribute('data-header-filter-mode', '');
    const contains = document.createElement('option');
    contains.value = 'contains';
    contains.textContent = '包含';
    const equals = document.createElement('option');
    equals.value = 'equals';
    equals.textContent = '等于';
    modeSelect.append(contains, equals);
    modeSelect.value = existing && existing.mode === 'equals' ? 'equals' : 'contains';
    styleField(modeSelect);
    Object.assign(modeSelect.style, {
      width: '110px',
      padding: '0 6px',
    });
    modeRow.appendChild(modeSelect);
    menu.appendChild(modeRow);

    const optionRow = document.createElement('div');
    Object.assign(optionRow.style, {
      display: 'flex',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: '8px 12px',
      marginBottom: '10px',
    });

    const makeCheckbox = (labelText, dataAttribute, checked) => {
      const label = document.createElement('label');
      Object.assign(label.style, {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        cursor: 'pointer',
      });
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = checked;
      checkbox.setAttribute(dataAttribute, '');
      label.append(checkbox, document.createTextNode(labelText));
      optionRow.appendChild(label);
      return checkbox;
    };

    const ignoreCase = makeCheckbox(
      '忽略大小写',
      'data-header-filter-ignore-case',
      existing ? existing.ignoreCase : true,
    );
    const ignoreWhitespace = makeCheckbox(
      '忽略空格',
      'data-header-filter-ignore-whitespace',
      existing ? existing.ignoreWhitespace : false,
    );
    menu.appendChild(optionRow);

    const actionRow = document.createElement('div');
    Object.assign(actionRow.style, {
      display: 'flex',
      justifyContent: 'flex-end',
      gap: '8px',
    });
    const deleteFilter = existing
      ? createActionButton('删除过滤', 'filter-delete', false)
      : null;
    if (deleteFilter) {
      deleteFilter.style.marginRight = 'auto';
      deleteFilter.style.color = 'var(--vscode-errorForeground, #f48771)';
      actionRow.appendChild(deleteFilter);
    }
    const cancel = createActionButton('取消', 'filter-cancel', false);
    const apply = createActionButton(existing ? '更新' : '应用', 'filter-apply', true);
    apply.disabled = !valueInput.value.trim();
    apply.style.opacity = apply.disabled ? '0.5' : '1';
    apply.style.cursor = apply.disabled ? 'default' : 'pointer';
    actionRow.append(cancel, apply);
    menu.appendChild(actionRow);

    const syncApplyState = () => {
      apply.disabled = !valueInput.value.trim();
      apply.style.opacity = apply.disabled ? '0.5' : '1';
      apply.style.cursor = apply.disabled ? 'default' : 'pointer';
    };

    const applyFilter = () => {
      const value = valueInput.value.trim();
      if (!value) return;
      columnFilters[key] = {
        value,
        mode: modeSelect.value === 'equals' ? 'equals' : 'contains',
        ignoreCase: ignoreCase.checked,
        ignoreWhitespace: ignoreWhitespace.checked,
      };
      renderChips();
      sendFilter();
      closeHeaderMenu();
    };

    valueInput.addEventListener('input', syncApplyState);
    valueInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        applyFilter();
      }
    });
    cancel.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      closeHeaderMenu();
    });
    if (deleteFilter) {
      deleteFilter.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        delete columnFilters[key];
        renderChips();
        sendFilter();
        closeHeaderMenu();
      });
    }
    apply.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      applyFilter();
    });

    return valueInput;
  };

  const openHeaderMenu = (kind, col, anchor) => {
    closeHeaderMenu();
    const menu = document.createElement('div');
    menu.id = 'csvHeaderActionMenu';
    menu.setAttribute('data-menu-kind', kind);
    menu.setAttribute('role', kind === 'filter' ? 'dialog' : 'menu');
    if (kind === 'filter') menu.setAttribute('aria-label', `过滤 ${columnLabel(col)}`);
    styleMenu(menu, kind);

    let focusTarget = null;
    if (kind === 'filter') {
      focusTarget = appendFilterEditor(menu, col);
    } else {
      addSortItem(menu, '升序 A → Z', 'sort-asc', () => bridge.sortColumn(col, true));
      addSortItem(menu, '降序 Z → A', 'sort-desc', () => bridge.sortColumn(col, false));
      addSortItem(menu, '恢复原始顺序', 'sort-reset', () => bridge.resetSort());
    }

    menu.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeHeaderMenu();
        if (anchor && typeof anchor.focus === 'function') anchor.focus();
      }
    });

    document.body.appendChild(menu);
    const rect = anchor && typeof anchor.getBoundingClientRect === 'function'
      ? anchor.getBoundingClientRect()
      : { left: 8, bottom: 8 };
    const width = kind === 'filter' ? 288 : 180;
    const viewportWidth = Number(window.innerWidth) || 1024;
    menu.style.left = `${Math.max(8, Math.min(rect.left, viewportWidth - width - 8))}px`;
    menu.style.top = `${Math.max(8, rect.bottom + 4)}px`;
    headerMenu = menu;

    if (focusTarget) {
      focusTarget.focus();
      focusTarget.select();
    } else {
      const first = menu.querySelector('button');
      if (first) first.focus();
    }
  };

  function updateHeaderButtons() {
    const table = document.querySelector('#csv-root table');
    if (!table) return;
    table.querySelectorAll('thead th[data-col]').forEach(th => {
      const col = Number(th.getAttribute('data-col'));
      if (!Number.isInteger(col) || col < 0) return;
      const controls = th.querySelector(':scope > .th-content') || th;
      const existingButtons = Array.from(th.querySelectorAll('.csv-header-filter-btn'));
      let btn = existingButtons.shift() || null;
      existingButtons.forEach(extra => extra.remove());
      if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'csv-header-filter-btn';
        btn.addEventListener('mousedown', event => {
          event.preventDefault();
          event.stopPropagation();
        });
        btn.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          const current = event.currentTarget;
          const currentCol = Number(current.getAttribute('data-col-filter-btn'));
          openHeaderMenu('filter', currentCol, current);
        });
      }
      btn.setAttribute('data-col-filter-btn', String(col));
      btn.setAttribute('aria-label', `过滤 ${columnLabel(col)}`);
      btn.title = `过滤 ${columnLabel(col)}`;
      if (btn.parentElement !== controls) controls.appendChild(btn);
      const active = !!columnFilters[String(col)];
      btn.textContent = '⌛︎';
      btn.classList.toggle('active', active);
    });
  }

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
  window.addEventListener('csvFilterSortResult', event => {
    const detail = event.detail || {};
    if (Array.isArray(detail.columnLabels)) columnLabels = detail.columnLabels;
    columnFilters = normalizeFilters(detail.columnFilters);
    renderChips();
  });

  window.CsvFilterPanelBridge = {
    openSortMenu: (col, anchor) => openHeaderMenu('sort', Number(col), anchor),
  };

  document.addEventListener('mousedown', event => {
    if (!headerMenu || headerMenu.contains(event.target)) return;
    const target = event.target && event.target.closest
      ? event.target.closest('.sort-btn, .csv-header-filter-btn')
      : null;
    if (!target) closeHeaderMenu();
  });
  window.addEventListener('blur', closeHeaderMenu);

  renderChips();
})();
