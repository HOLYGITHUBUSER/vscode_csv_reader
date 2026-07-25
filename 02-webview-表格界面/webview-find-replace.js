/* ------------------------------------------------------------------------ *
 * Floating find/replace widget.
 *
 * Exposes a small factory consumed by webview-main.js so shared table state stays
 * explicit instead of leaking through ad-hoc globals.
 * ------------------------------------------------------------------------ */
(function initFindReplaceFactory() {
  window.createCsvFindReplace = function createCsvFindReplace(deps) {
    const {
      vscode,
      table,
      getElementTarget,
      ensureRenderedCellByCoords,
      getRenderedCellByCoords,
      getFocusFallback,
    } = deps;

    const findReplaceWidget = document.getElementById('findReplaceWidget');
    const replaceToggleGutter = document.getElementById('replaceToggleGutter');
    const replaceToggle = document.getElementById('replaceToggle');
    const findInput = document.getElementById('findInput');
    const replaceInput = document.getElementById('replaceInput');
    const findStatus = document.getElementById('findStatus');
    const findPrev = document.getElementById('findPrev');
    const findNext = document.getElementById('findNext');
    const findMenuButton = document.getElementById('findMenuButton');
    const findOverflowMenu = document.getElementById('findOverflowMenu');
    const findClose = document.getElementById('findClose');
    const findCaseToggle = document.getElementById('findCaseToggle');
    const findWordToggle = document.getElementById('findWordToggle');
    const findRegexToggle = document.getElementById('findRegexToggle');
    const replaceCaseToggle = document.getElementById('replaceCaseToggle');
    const replaceOne = document.getElementById('replaceOne');
    const replaceAll = document.getElementById('replaceAll');
    const findOverflowPreserveCase = document.getElementById('findOverflowPreserveCase');

    const findReplaceState = {
      open: false,
      replaceExpanded: false,
      matchCase: false,
      wholeWord: false,
      regex: false,
      preserveCase: false,
      invalidRegex: false
    };
    let findMatches = [];
    let currentMatchIndex = -1;
    let findDebounce = null;
    let findFocusBeforeOpen = null;
    let findRequestSeq = 0;
    let latestFindRequestId = 0;
    const pendingFindRequests = new Map();
    let findMatchKeySet = new Set();

    const escapeRegexLiteral = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const getFindMatchKey = (row, col) => `${row}:${col}`;
    const isWidgetTarget = target => {
      const el = getElementTarget(target);
      return !!(el && el.closest('#findReplaceWidget'));
    };
    const clearFindHighlights = () => {
      document.querySelectorAll('.highlight, .active-match').forEach(el => {
        el.classList.remove('highlight');
        el.classList.remove('active-match');
      });
    };
    const hideFindOverflowMenu = () => {
      findOverflowMenu.classList.remove('open');
    };
    const setReplaceExpanded = expanded => {
      findReplaceState.replaceExpanded = expanded;
      findReplaceWidget.classList.toggle('replace-collapsed', !expanded);
      findReplaceWidget.classList.toggle('replace-expanded', expanded);
      replaceToggle.setAttribute('aria-expanded', String(expanded));
      replaceToggle.innerText = expanded ? '⌄' : '›';
    };
    const syncFindToggleUi = () => {
      findCaseToggle.setAttribute('aria-pressed', String(findReplaceState.matchCase));
      findWordToggle.setAttribute('aria-pressed', String(findReplaceState.wholeWord));
      findRegexToggle.setAttribute('aria-pressed', String(findReplaceState.regex));
      replaceCaseToggle.setAttribute('aria-pressed', String(findReplaceState.preserveCase));
    };
    const updateFindStatus = () => {
      const query = findInput.value;
      if (!query || query.length === 0 || findMatches.length === 0) {
        findStatus.innerText = findReplaceState.invalidRegex ? 'Invalid regex' : 'No results';
        return;
      }
      findStatus.innerText = `${currentMatchIndex + 1} of ${findMatches.length}`;
    };
    const updateFindControls = () => {
      const hasQuery = findInput.value.length > 0;
      const hasMatches = findMatches.length > 0 && !findReplaceState.invalidRegex;
      findPrev.disabled = !hasMatches;
      findNext.disabled = !hasMatches;
      replaceOne.disabled = !hasQuery || !hasMatches;
      replaceAll.disabled = !hasQuery || !hasMatches;
    };
    const getFindPattern = () => {
      const query = findInput.value;
      if (!query) return null;
      let source = findReplaceState.regex ? query : escapeRegexLiteral(query);
      if (findReplaceState.wholeWord) {
        source = `\\b(?:${source})\\b`;
      }
      return source;
    };
    const buildFindRegex = global => {
      const source = getFindPattern();
      if (!source) return null;
      const flags = `${global ? 'g' : ''}${findReplaceState.matchCase ? '' : 'i'}`;
      try {
        return new RegExp(source, flags);
      } catch {
        return null;
      }
    };
    const getRenderedFindCells = () => {
      return Array.from(table.querySelectorAll('td[data-col], th[data-col]'));
    };
    const applyFindHighlightsToRendered = () => {
      if (!findMatchKeySet.size) {
        return;
      }
      getRenderedFindCells().forEach(cell => {
        const row = parseInt(cell.getAttribute('data-row') || 'NaN', 10);
        const col = parseInt(cell.getAttribute('data-col') || 'NaN', 10);
        if (Number.isNaN(row) || Number.isNaN(col) || col < 0) {
          return;
        }
        if (findMatchKeySet.has(getFindMatchKey(row, col))) {
          cell.classList.add('highlight');
        }
      });
    };
    const setActiveFindMatch = (index, shouldScroll = true) => {
      document.querySelectorAll('.active-match').forEach(el => el.classList.remove('active-match'));
      if (!findMatches.length) {
        currentMatchIndex = -1;
        updateFindStatus();
        updateFindControls();
        return;
      }
      const normalized = ((index % findMatches.length) + findMatches.length) % findMatches.length;
      currentMatchIndex = normalized;
      const match = findMatches[currentMatchIndex];
      const cell = match ? ensureRenderedCellByCoords(match.row, match.col) : null;
      if (cell) {
        cell.classList.add('highlight');
        cell.classList.add('active-match');
        if (shouldScroll) {
          cell.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
        }
      }
      updateFindStatus();
      updateFindControls();
    };
    const runFind = (preserveIndex = false) => {
      const query = findInput.value;
      const priorIndex = currentMatchIndex;
      const requestId = ++findRequestSeq;
      latestFindRequestId = requestId;
      pendingFindRequests.set(requestId, { preserveIndex, priorIndex });

      clearFindHighlights();
      findMatches = [];
      findMatchKeySet = new Set();
      currentMatchIndex = -1;
      findReplaceState.invalidRegex = false;
      if (!query) {
        updateFindStatus();
        updateFindControls();
        return;
      }

      vscode.postMessage({
        type: 'findMatches',
        requestId,
        query,
        options: {
          matchCase: findReplaceState.matchCase,
          wholeWord: findReplaceState.wholeWord,
          regex: findReplaceState.regex
        }
      });
      updateFindStatus();
      updateFindControls();
    };
    const scheduleFind = (preserveIndex = false) => {
      if (findDebounce) clearTimeout(findDebounce);
      findDebounce = setTimeout(() => {
        runFind(preserveIndex);
      }, 150);
    };
    const navigateFind = reverse => {
      if (!findMatches.length) return;
      const delta = reverse ? -1 : 1;
      setActiveFindMatch(currentMatchIndex + delta);
    };
    const preserveReplacementCase = (replacement, matched) => {
      if (!replacement || !matched) return replacement;
      if (matched === matched.toUpperCase()) return replacement.toUpperCase();
      if (matched === matched.toLowerCase()) return replacement.toLowerCase();
      const first = matched.charAt(0);
      const rest = matched.slice(1);
      if (first === first.toUpperCase() && rest === rest.toLowerCase()) {
        return replacement.charAt(0).toUpperCase() + replacement.slice(1).toLowerCase();
      }
      return replacement;
    };
    const replaceInText = (text, replaceAllMatches) => {
      const regex = buildFindRegex(replaceAllMatches);
      if (!regex) return text;
      const replacementText = replaceInput.value;
      if (!findReplaceState.preserveCase) {
        return text.replace(regex, replacementText);
      }
      return text.replace(regex, matched => preserveReplacementCase(replacementText, matched));
    };
    const replaceCurrentMatch = () => {
      if (!findMatches.length || findReplaceState.invalidRegex) return;
      const match = findMatches[currentMatchIndex];
      if (!match) {
        runFind(true);
        return;
      }
      const original = String(match.value ?? '');
      const next = replaceInText(original, false);
      if (next === original) {
        navigateFind(false);
        return;
      }
      const cell = ensureRenderedCellByCoords(match.row, match.col);
      if (cell) {
        cell.textContent = next;
      }
      vscode.postMessage({ type: 'editCell', row: match.row, col: match.col, value: next });
      runFind(true);
    };
    const replaceAllMatches = () => {
      if (findReplaceState.invalidRegex || !findInput.value || !findMatches.length) return;
      const seen = new Set();
      if (!findMatches.length) return;
      const replacements = [];
      findMatches.forEach(match => {
        if (!match) return;
        const key = getFindMatchKey(match.row, match.col);
        if (seen.has(key)) return;
        seen.add(key);
        const original = String(match.value ?? '');
        const next = replaceInText(original, true);
        if (next !== original) {
          const cell = getRenderedCellByCoords(match.row, match.col);
          if (cell) {
            cell.textContent = next;
          }
          replacements.push({ row: match.row, col: match.col, value: next });
        }
      });
      if (replacements.length > 0) {
        vscode.postMessage({ type: 'replaceCells', replacements });
      }
      runFind(false);
    };
    const openFindReplace = expandReplace => {
      findFocusBeforeOpen = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      findReplaceState.open = true;
      findReplaceWidget.classList.add('open');
      setReplaceExpanded(expandReplace);
      syncFindToggleUi();
      hideFindOverflowMenu();
      try { findInput.focus({ preventScroll: true }); } catch { try { findInput.focus(); } catch {} }
      findInput.select();
      runFind(true);
    };
    const closeFindReplace = () => {
      if (findDebounce) {
        clearTimeout(findDebounce);
        findDebounce = null;
      }
      pendingFindRequests.clear();
      latestFindRequestId = 0;
      findReplaceState.open = false;
      findReplaceWidget.classList.remove('open');
      hideFindOverflowMenu();
      clearFindHighlights();
      findMatches = [];
      currentMatchIndex = -1;
      findReplaceState.invalidRegex = false;
      updateFindStatus();
      updateFindControls();
      const fallback = typeof getFocusFallback === 'function' ? getFocusFallback() : document.body;
      const focusTarget = (findFocusBeforeOpen && findFocusBeforeOpen.isConnected)
        ? findFocusBeforeOpen
        : fallback;
      try { focusTarget.focus({ preventScroll: true }); } catch { try { focusTarget.focus(); } catch {} }
    };
    const handleMatchesResult = message => {
      if (!findReplaceState.open) {
        return;
      }
      const requestId = Number(message.requestId);
      const requestState = pendingFindRequests.get(requestId);
      pendingFindRequests.delete(requestId);
      if (!Number.isInteger(requestId) || requestId !== latestFindRequestId) {
        return;
      }

      findReplaceState.invalidRegex = !!message.invalidRegex;
      findMatches = Array.isArray(message.matches)
        ? message.matches
          .map(raw => {
            const row = Number(raw?.row);
            const col = Number(raw?.col);
            if (!Number.isInteger(row) || row < 0 || !Number.isInteger(col) || col < 0) {
              return null;
            }
            return { row, col, value: String(raw?.value ?? '') };
          })
          .filter(Boolean)
        : [];
      findMatchKeySet = new Set(findMatches.map(match => getFindMatchKey(match.row, match.col)));

      clearFindHighlights();
      applyFindHighlightsToRendered();
      if (findMatches.length > 0) {
        const preserveIndex = !!requestState?.preserveIndex;
        const priorIndex = Number.isInteger(requestState?.priorIndex) ? requestState.priorIndex : -1;
        const nextIndex = preserveIndex && priorIndex >= 0
          ? Math.min(priorIndex, findMatches.length - 1)
          : 0;
        setActiveFindMatch(nextIndex);
      } else {
        currentMatchIndex = -1;
        updateFindStatus();
        updateFindControls();
      }
    };

    findInput.addEventListener('input', () => scheduleFind(false));
    findInput.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        closeFindReplace();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        navigateFind(e.shiftKey);
        return;
      }
      if (e.key === 'F3') {
        e.preventDefault();
        navigateFind(e.shiftKey);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        navigateFind(e.shiftKey);
      }
    });
    replaceInput.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        closeFindReplace();
        return;
      }
      if (e.key === 'F3') {
        e.preventDefault();
        navigateFind(e.shiftKey);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        replaceCurrentMatch();
      }
    });
    replaceToggleGutter.addEventListener('click', () => {
      setReplaceExpanded(!findReplaceState.replaceExpanded);
    });
    findCaseToggle.addEventListener('click', () => {
      findReplaceState.matchCase = !findReplaceState.matchCase;
      syncFindToggleUi();
      runFind(true);
    });
    findWordToggle.addEventListener('click', () => {
      findReplaceState.wholeWord = !findReplaceState.wholeWord;
      syncFindToggleUi();
      runFind(true);
    });
    findRegexToggle.addEventListener('click', () => {
      findReplaceState.regex = !findReplaceState.regex;
      syncFindToggleUi();
      runFind(true);
    });
    replaceCaseToggle.addEventListener('click', () => {
      findReplaceState.preserveCase = !findReplaceState.preserveCase;
      syncFindToggleUi();
    });
    findPrev.addEventListener('click', () => navigateFind(true));
    findNext.addEventListener('click', () => navigateFind(false));
    findClose.addEventListener('click', closeFindReplace);
    findMenuButton.addEventListener('click', e => {
      e.stopPropagation();
      findOverflowMenu.classList.toggle('open');
    });
    replaceOne.addEventListener('click', replaceCurrentMatch);
    replaceAll.addEventListener('click', replaceAllMatches);
    findOverflowPreserveCase.addEventListener('click', () => {
      findReplaceState.preserveCase = !findReplaceState.preserveCase;
      syncFindToggleUi();
      hideFindOverflowMenu();
    });
    document.addEventListener('mousedown', e => {
      if (!isWidgetTarget(e.target)) {
        hideFindOverflowMenu();
        return;
      }
      const el = getElementTarget(e.target);
      if (el && !el.closest('#findMenuButton') && !el.closest('#findOverflowMenu')) {
        hideFindOverflowMenu();
      }
    });
    syncFindToggleUi();
    updateFindStatus();
    updateFindControls();
    window.addEventListener('csvChunkLoaded', () => {
      if (!findReplaceState.open || findMatches.length === 0) {
        return;
      }
      applyFindHighlightsToRendered();
      if (currentMatchIndex >= 0 && currentMatchIndex < findMatches.length) {
        const active = findMatches[currentMatchIndex];
        const cell = getRenderedCellByCoords(active.row, active.col);
        if (cell) {
          cell.classList.add('active-match');
        }
      }
    });
    window.addEventListener('csvFilterSortResult', () => {
      if (findReplaceState.open && findInput.value) {
        scheduleFind(true);
      }
    });

    return {
      close: closeFindReplace,
      handleFindMatchesResult: handleMatchesResult,
      hasQuery: () => findInput.value.length > 0,
      isOpen: () => findReplaceState.open,
      isFindWidgetTarget: isWidgetTarget,
      navigate: navigateFind,
      open: openFindReplace,
      schedule: scheduleFind,
    };
  };
})();
