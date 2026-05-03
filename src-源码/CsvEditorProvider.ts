import Papa from 'papaparse';
import * as vscode from 'vscode';
import * as path from 'path';
import {
  escapeCss,
  escapeHtml,
  estimateColumnDataType,
  formatCellContent,
  getColumnColor,
  getMultilineCellTitleAttr,
  hslToHex,
  isAllowedExternalScheme,
  isAllowedExternalUrl,
  isDate,
  linkifyUrls
} from './csvCellFormat';
import {
  CsvColumnFilterCondition,
  CsvFilterSortState,
  applyFilterSortToRows,
  createDefaultFilterSortState,
  normalizeColumnFilters
} from './csvFilterSort';
import { applyFieldUpdatesPreservingFormat } from './csvFormat';
import {
  generateTableAndChunks as generateCsvTableAndChunks,
  renderChunkFromState as renderCsvChunkFromState
} from './csvRender';
import {
  BUILTIN_SEPARATORS_BY_EXTENSION,
  DEFAULT_SEPARATOR as DEFAULT_CSV_SEPARATOR,
  DEFAULT_SEPARATOR_MODE as DEFAULT_CSV_SEPARATOR_MODE,
  getSeparatorSettings,
  normalizeExtension,
  normalizeSeparator,
  resolveInheritedSeparator,
  serializeSeparatorSettings
} from './csvSeparator';
import {
  ChunkRenderState,
  ChunkResponse,
  PasteApplyResult,
  PastePlan,
  PasteSelectionBounds,
  SeparatorMode,
  SeparatorSettings
} from './csvTypes';

// Per-document controller. Manages one webview + document.
class CsvEditorController {
  // Note: Global registry lives on CsvEditorProvider (wrapper)

  private static readonly BYTES_PER_MB = 1024 * 1024;
  private static readonly DEFAULT_MAX_FILE_SIZE_MB = 100;
  private static readonly LARGE_FILE_CONTINUE_THIS_TIME = 'Continue This Time';
  private static readonly LARGE_FILE_IGNORE_FOREVER = 'Ignore Forever';

  private isUpdatingDocument = false;
  private isSaving = false;
  private currentWebviewPanel: vscode.WebviewPanel | undefined;
  private document!: vscode.TextDocument;
  private separatorCache: { version: number; configKey: string; separator: string } | undefined;
  private isDiffContext = false;
  private chunkRenderState: ChunkRenderState | undefined;
  private filterSortState: CsvFilterSortState = createDefaultFilterSortState();
  /**
   * Full text of the document taken right before the first sortColumn that
   * followed the most recent non-sort edit. Consumed (and cleared) by
   * resetSort to restore the pre-sort order in a single WorkspaceEdit.
   */
  private sortSnapshotText: string | null = null;

  constructor(private readonly context: vscode.ExtensionContext) {}

  // (no static helpers here; see wrapper CsvEditorProvider)

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    this.document = document;

    const config = vscode.workspace.getConfiguration('csv', this.document.uri);
    if (!config.get<boolean>('enabled', true)) {
      // When disabled, immediately hand off to the default editor and close this tab
      await this.openWithDefaultEditorAndClose(webviewPanel, document.uri);
      return;
    }

    const proceed = await this.confirmLargeFileOpen(config, webviewPanel, _token);
    if (!proceed) {
      return;
    }

    this.currentWebviewPanel = webviewPanel;
    CsvEditorProvider.editors.push(this);

    webviewPanel.webview.options = {
      enableScripts: true,
      // Use file path for compatibility with older VS Code types (no Uri.joinPath)
      localResourceRoots: [vscode.Uri.file(path.join(this.context.extensionPath, 'media-媒体'))]
    };

    this.refreshDiffContext(webviewPanel);
    this.updateWebviewContent();

    if (webviewPanel.active) {
      CsvEditorProvider.currentActive = this;
    }

    webviewPanel.webview.postMessage({ type: 'focus' });
    webviewPanel.onDidChangeViewState(e => {
      if (e.webviewPanel.active) {
        const diffChanged = this.refreshDiffContext(e.webviewPanel);
        if (diffChanged) {
          this.updateWebviewContent();
        }
        e.webviewPanel.webview.postMessage({ type: 'focus' });
        CsvEditorProvider.currentActive = this;
      }
    });

    webviewPanel.webview.onDidReceiveMessage(async e => {
      // Any mutation other than sort/resetSort invalidates the "original order"
      // snapshot: otherwise cycling back to original would also undo the edit.
      const mutations = new Set([
        'editCell', 'replaceCells', 'pasteCells',
        'insertColumn', 'insertColumns', 'deleteColumn', 'deleteColumns',
        'insertRow', 'insertRows', 'deleteRow', 'deleteRows',
        'reorderColumns', 'reorderRows',
      ]);
      if (mutations.has(e.type)) {
        this.sortSnapshotText = null;
      }

      switch (e.type) {
        case 'editCell':
          this.updateDocument(e.row, e.col, e.value);
          break;
        case 'replaceCells':
          await this.replaceCells(e.replacements);
          break;
        case 'pasteCells':
          await this.pasteCells(e.text, e.anchorRow, e.anchorCol, e.selection);
          break;
        case 'requestChunk':
          await this.requestChunk(e.start, e.requestId);
          break;
        case 'findMatches':
          await this.findMatches(e.requestId, e.query, e.options);
          break;
        case 'save':
          await this.handleSave();
          break;
        case 'copyToClipboard':
          await vscode.env.clipboard.writeText(e.text);
          console.log('CSV: Copied to clipboard');
          break;
        case 'insertColumn':
          await this.insertColumn(e.index);
          break;
        case 'insertColumns':
          await this.insertColumns(e.index, e.count);
          break;
        case 'deleteColumn':
          await this.deleteColumn(e.index);
          break;
        case 'deleteColumns':
          await this.deleteColumns(e.indices);
          break;
        case 'insertRow':
          await this.insertRow(e.index);
          break;
        case 'insertRows':
          await this.insertRows(e.index, e.count);
          break;
        case 'deleteRow':
          await this.deleteRow(e.index);
          break;
        case 'deleteRows':
          await this.deleteRows(e.indices);
          break;
        case 'reorderColumns':
          await this.reorderColumns(e.indices, e.beforeIndex);
          break;
        case 'reorderRows':
          await this.reorderRows(e.indices, e.beforeIndex);
          break;
        case 'sortColumn':
          await this.sortColumn(e.index, e.ascending);
          break;
        case 'resetSort':
          await this.resetSort();
          break;
        case 'openLink':
          await this.openLinkExternally(e.url);
          break;
        case 'filterSort':
          this.handleFilterSort(e.globalSearch, e.columnFilters, e.sortCol, e.sortDir);
          break;
        case 'setRowHeightMode': {
          const mode = e.mode === 'compact' ? 'compact'
            : e.mode === 'wrap' ? 'wrap'
            : 'compact';
          const cfg = vscode.workspace.getConfiguration('csv');
          await cfg.update('rowHeightMode', mode, vscode.ConfigurationTarget.Global);
          break;
        }
      }
    });

    const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
      if (
        e.document.uri.toString() === document.uri.toString() &&
        !this.isUpdatingDocument &&
        !this.isSaving
      ) {
        setTimeout(() => this.updateWebviewContent(), 250);
      }
    });

    webviewPanel.onDidDispose(() => {
      changeDocumentSubscription.dispose();
      CsvEditorProvider.editors = CsvEditorProvider.editors.filter(ed => ed !== this);
      this.currentWebviewPanel = undefined;
    });
  }

  private getMaxFileSizeLimitMb(config: vscode.WorkspaceConfiguration): number {
    const raw = Number(config.get<number>('maxFileSizeMB', CsvEditorController.DEFAULT_MAX_FILE_SIZE_MB));
    if (!Number.isFinite(raw) || raw <= 0) {
      return 0;
    }
    return raw;
  }

  private shouldPromptForLargeFile(fileSizeBytes: number, maxFileSizeMB: number): boolean {
    if (!Number.isFinite(fileSizeBytes) || fileSizeBytes < 0) {
      return false;
    }
    if (!Number.isFinite(maxFileSizeMB) || maxFileSizeMB <= 0) {
      return false;
    }
    const thresholdBytes = Math.floor(maxFileSizeMB * CsvEditorController.BYTES_PER_MB);
    return fileSizeBytes > thresholdBytes;
  }

  private formatSizeMb(fileSizeBytes: number): string {
    if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0) {
      return '0.0';
    }
    return (fileSizeBytes / CsvEditorController.BYTES_PER_MB).toFixed(1);
  }

  private async openWithDefaultEditorAndClose(webviewPanel: vscode.WebviewPanel, uri: vscode.Uri): Promise<void> {
    try {
      const opts: any = {
        viewColumn: webviewPanel.viewColumn,
        preserveFocus: !webviewPanel.active,
        preview: webviewPanel.active ? webviewPanel.active : false
      };
      await vscode.commands.executeCommand('vscode.openWith', uri, 'default', opts);
    } finally {
      try { webviewPanel.dispose(); } catch {}
    }
  }

  private async confirmLargeFileOpen(
    config: vscode.WorkspaceConfiguration,
    webviewPanel: vscode.WebviewPanel,
    token: vscode.CancellationToken
  ): Promise<boolean> {
    const maxFileSizeMB = this.getMaxFileSizeLimitMb(config);
    if (maxFileSizeMB <= 0) {
      return true;
    }

    let sizeBytes = 0;
    try {
      const stat = await vscode.workspace.fs.stat(this.document.uri);
      sizeBytes = Number(stat.size);
    } catch (err) {
      console.warn(`CSV: unable to stat file size for ${this.document.uri.toString()}`, err);
      return true;
    }

    if (token.isCancellationRequested) {
      return false;
    }
    if (!this.shouldPromptForLargeFile(sizeBytes, maxFileSizeMB)) {
      return true;
    }

    const fileLabel = path.basename(this.document.uri.fsPath || this.document.uri.path || this.document.uri.toString());
    const selected = await vscode.window.showWarningMessage(
      `CSV: "${fileLabel}" is ${this.formatSizeMb(sizeBytes)} MB and exceeds the csv.maxFileSizeMB limit (${maxFileSizeMB} MB).`,
      {
        modal: true,
        detail: 'Opening large files in CSV view can be slow and block the editor.'
      },
      CsvEditorController.LARGE_FILE_CONTINUE_THIS_TIME,
      CsvEditorController.LARGE_FILE_IGNORE_FOREVER
    );

    if (selected === CsvEditorController.LARGE_FILE_CONTINUE_THIS_TIME) {
      return true;
    }
    if (selected === CsvEditorController.LARGE_FILE_IGNORE_FOREVER) {
      await vscode.workspace
        .getConfiguration('csv')
        .update('maxFileSizeMB', 0, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage('CSV: Large-file prompt disabled (csv.maxFileSizeMB = 0).');
      return true;
    }

    try { webviewPanel.dispose(); } catch {}
    return false;
  }

  public refresh() {
    const config = vscode.workspace.getConfiguration('csv', this.document.uri);
    if (!config.get<boolean>('enabled', true)) {
      this.currentWebviewPanel?.dispose();
      vscode.commands.executeCommand('vscode.openWith', this.document.uri, 'default');
    } else {
      if (this.currentWebviewPanel) {
        this.forceReload();
      }
    }
  }

  private forceReload() {
    if (!this.currentWebviewPanel) return;
    const panel = this.currentWebviewPanel;
    // First, blank the DOM to ensure a full script/style reinit on next set
    panel.webview.html = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body></body></html>';
    setTimeout(() => {
      try {
        this.updateWebviewContent();
      } catch (err) {
        console.error('CSV: forceReload failed', err);
      }
    }, 0);
  }

  public isActive(): boolean {
    return !!this.currentWebviewPanel?.active;
  }

  private refreshDiffContext(webviewPanel: vscode.WebviewPanel): boolean {
    const next = this.isLikelyDiffContext(webviewPanel, this.document.uri);
    const changed = next !== this.isDiffContext;
    this.isDiffContext = next;
    return changed;
  }

  private isLikelyDiffContext(webviewPanel: vscode.WebviewPanel, uri: vscode.Uri): boolean {
    if (uri.scheme === 'git') {
      return true;
    }

    const title = webviewPanel.title || '';
    if (title.includes('↔')) {
      return true;
    }

    const key = uri.toString();
    const tabGroups = (vscode.window as any)?.tabGroups?.all;
    if (!Array.isArray(tabGroups)) {
      return false;
    }
    for (const group of tabGroups) {
      const activeTab: any = group?.activeTab;
      const input: any = activeTab?.input;
      const original: unknown = input?.original;
      const modified: unknown = input?.modified;
      if (original instanceof vscode.Uri && modified instanceof vscode.Uri) {
        if (original.toString() === key || modified.toString() === key) {
          return true;
        }
      }
    }
    return false;
  }

  private static resolveEffectiveColumnColorMode(
    baseMode: string,
    isDiffContext: boolean,
    useThemeForegroundInDiff: boolean
  ): 'type' | 'theme' {
    const normalizedBase: 'type' | 'theme' = baseMode === 'theme' ? 'theme' : 'type';
    if (isDiffContext && useThemeForegroundInDiff) {
      return 'theme';
    }
    return normalizedBase;
  }

  private static normalizeFontSize(value: unknown): number | undefined {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return undefined;
    }
    return Math.round(parsed * 100) / 100;
  }

  private static resolveEffectiveFontSize(csvFontSize: unknown, editorFontSize: unknown): number {
    return (
      CsvEditorController.normalizeFontSize(csvFontSize) ??
      CsvEditorController.normalizeFontSize(editorFontSize) ??
      14
    );
  }

  public getDocumentUri(): vscode.Uri {
    return this.document.uri;
  }

  public getCurrentSeparator(): string {
    return this.getSeparator();
  }

  // ───────────── Document Editing Methods ─────────────

  private async updateDocument(row: number, col: number, value: string) {
    this.isUpdatingDocument = true;
    let structuralChange = false;
    let applied = false;
    try {
      const separator = this.getSeparator();
      const oldText = this.document.getText();
      const result = Papa.parse(oldText, { dynamicTyping: false, delimiter: separator });
      const data = result.data as string[][];
      const hadRows = data.length;
      const hadColsAtRow = (data[row] ? data[row].length : 0);
      const previousValue =
        row < hadRows && col < hadColsAtRow
          ? String(data[row][col] ?? '')
          : undefined;

      const { data: nextData, trimmed, createdRow, createdCol } = this.mutateDataForEdit(data, row, col, value);
      structuralChange = !!(trimmed || createdRow || createdCol || row >= hadRows || col >= hadColsAtRow);

      if (!structuralChange && previousValue === value) {
        return;
      }

      let newCsvText: string | undefined;
      if (!structuralChange) {
        newCsvText = CsvEditorProvider.applyFieldUpdatesPreservingFormat(
          oldText,
          separator,
          [{ row, col, value: String(value ?? '') }]
        );
      }
      if (newCsvText === undefined) {
        newCsvText = Papa.unparse(nextData, { delimiter: separator });
      }

      if (newCsvText === oldText) {
        return;
      }

      const fullRange = new vscode.Range(
        0, 0,
        this.document.lineCount,
        this.document.lineCount ? this.document.lineAt(this.document.lineCount - 1).text.length : 0
      );
      const edit = new vscode.WorkspaceEdit();
      edit.replace(this.document.uri, fullRange, newCsvText);
      await vscode.workspace.applyEdit(edit);
      applied = true;
    } finally {
      this.isUpdatingDocument = false;
    }

    if (!applied) {
      return;
    }

    console.log(`CSV: Updated row ${row + 1}, column ${col + 1} to "${value}"`);
    const config = vscode.workspace.getConfiguration('csv', this.document.uri);
    const clickableLinks = config.get<boolean>('clickableLinks', true);
    const rendered = this.formatCellContent(value ?? '', clickableLinks);
    this.currentWebviewPanel?.webview.postMessage({ type: 'updateCell', row, col, value, rendered });

    // Trigger a full re-render if structure may have changed (new row/col created)
    if (structuralChange) {
      try { this.updateWebviewContent(); } catch (e) { console.error('CSV: refresh failed after structural edit', e); }
    }
  }

  private async replaceCells(replacements: unknown): Promise<void> {
    if (!Array.isArray(replacements) || replacements.length === 0) {
      return;
    }
    this.isUpdatingDocument = true;
    try {
      const separator = this.getSeparator();
      const oldText = this.document.getText();
      const result = Papa.parse(oldText, { dynamicTyping: false, delimiter: separator });
      const data = result.data as string[][];
      const updates: Array<{ row: number; col: number; value: string }> = [];

      let changed = false;
      for (const replacement of replacements) {
        if (!replacement || typeof replacement !== 'object') {
          continue;
        }
        const row = Number((replacement as any).row);
        const col = Number((replacement as any).col);
        if (!Number.isInteger(row) || row < 0 || !Number.isInteger(col) || col < 0) {
          continue;
        }
        if (row >= data.length) {
          continue;
        }
        if (col >= (data[row]?.length ?? 0)) {
          continue;
        }
        const raw = (replacement as any).value;
        const nextValue = raw === undefined || raw === null ? '' : String(raw);
        if ((data[row][col] ?? '') === nextValue) {
          continue;
        }
        data[row][col] = nextValue;
        updates.push({ row, col, value: nextValue });
        changed = true;
      }
      if (!changed) {
        return;
      }

      let newCsvText = CsvEditorProvider.applyFieldUpdatesPreservingFormat(oldText, separator, updates);
      if (newCsvText === undefined) {
        newCsvText = Papa.unparse(data, { delimiter: separator });
      }
      if (newCsvText === oldText) {
        return;
      }

      const fullRange = new vscode.Range(
        0, 0,
        this.document.lineCount,
        this.document.lineCount ? this.document.lineAt(this.document.lineCount - 1).text.length : 0
      );
      const edit = new vscode.WorkspaceEdit();
      edit.replace(this.document.uri, fullRange, newCsvText);
      await vscode.workspace.applyEdit(edit);

      this.updateWebviewContent();
    } finally {
      this.isUpdatingDocument = false;
    }
  }

  private parseClipboardMatrix(text: string): string[][] {
    if (!text || text.length === 0) {
      return [];
    }
    const parsed = Papa.parse(text, { dynamicTyping: false, delimiter: '' });
    const rowsRaw = Array.isArray(parsed.data) ? parsed.data : [];
    const matrix: string[][] = rowsRaw.map(rawRow => {
      if (Array.isArray(rawRow)) {
        return rawRow.map(cell => String(cell ?? ''));
      }
      return [String(rawRow ?? '')];
    });
    while (matrix.length > 0 && matrix[matrix.length - 1].every(value => value === '')) {
      matrix.pop();
    }
    if (matrix.length === 0) {
      return [];
    }
    const width = matrix.reduce((max, row) => Math.max(max, row.length), 0);
    if (width <= 0) {
      return [];
    }
    matrix.forEach(row => {
      while (row.length < width) {
        row.push('');
      }
    });
    return matrix;
  }

  private static parsePasteSelectionBounds(raw: unknown): PasteSelectionBounds | undefined {
    if (!raw || typeof raw !== 'object') {
      return undefined;
    }
    const minRow = Number((raw as any).minRow);
    const maxRow = Number((raw as any).maxRow);
    const minCol = Number((raw as any).minCol);
    const maxCol = Number((raw as any).maxCol);
    if (
      !Number.isInteger(minRow) || minRow < 0 ||
      !Number.isInteger(maxRow) || maxRow < minRow ||
      !Number.isInteger(minCol) || minCol < 0 ||
      !Number.isInteger(maxCol) || maxCol < minCol
    ) {
      return undefined;
    }
    return {
      minRow,
      maxRow,
      minCol,
      maxCol,
      rectangular: !!(raw as any).rectangular
    };
  }

  private static computePastePlan(
    matrix: string[][],
    anchorRow: number,
    anchorCol: number,
    selection: PasteSelectionBounds | undefined
  ): PastePlan | undefined {
    const height = matrix.length;
    const width = height > 0 ? Math.max(0, matrix[0].length) : 0;
    if (height <= 0 || width <= 0) {
      return undefined;
    }
    const canFillSelection = !!selection
      && selection.rectangular
      && (selection.maxRow > selection.minRow || selection.maxCol > selection.minCol)
      && height === 1
      && width === 1;
    if (canFillSelection) {
      return {
        startRow: selection.minRow,
        startCol: selection.minCol,
        endRow: selection.maxRow,
        endCol: selection.maxCol,
        fillSelection: true
      };
    }
    return {
      startRow: anchorRow,
      startCol: anchorCol,
      endRow: anchorRow + height - 1,
      endCol: anchorCol + width - 1,
      fillSelection: false
    };
  }

  private static applyPasteMatrixToData(
    data: string[][],
    matrix: string[][],
    anchorRow: number,
    anchorCol: number,
    selection: PasteSelectionBounds | undefined
  ): PasteApplyResult {
    const plan = CsvEditorController.computePastePlan(matrix, anchorRow, anchorCol, selection);
    if (!plan) {
      return {
        changed: false,
        structuralChange: false,
        updates: [],
        plan: {
          startRow: anchorRow,
          startCol: anchorCol,
          endRow: anchorRow,
          endCol: anchorCol,
          fillSelection: false
        }
      };
    }

    const updates: Array<{ row: number; col: number; value: string }> = [];
    let changed = false;
    let structuralChange = false;

    const setCellValue = (row: number, col: number, nextValue: string) => {
      const hasRow = row >= 0 && row < data.length;
      const hasCol = hasRow && col >= 0 && col < data[row].length;
      const prevValue = hasCol ? String(data[row][col] ?? '') : '';
      if (prevValue === nextValue) {
        return;
      }
      if (!hasRow || !hasCol) {
        structuralChange = true;
      }
      while (data.length <= row) {
        data.push([]);
      }
      while (data[row].length <= col) {
        data[row].push('');
      }
      data[row][col] = nextValue;
      updates.push({ row, col, value: nextValue });
      changed = true;
    };

    if (plan.fillSelection) {
      const value = String(matrix[0][0] ?? '');
      for (let row = plan.startRow; row <= plan.endRow; row++) {
        for (let col = plan.startCol; col <= plan.endCol; col++) {
          setCellValue(row, col, value);
        }
      }
    } else {
      for (let r = 0; r < matrix.length; r++) {
        for (let c = 0; c < matrix[r].length; c++) {
          setCellValue(plan.startRow + r, plan.startCol + c, String(matrix[r][c] ?? ''));
        }
      }
    }

    return { changed, structuralChange, updates, plan };
  }

  private async pasteCells(
    rawText: unknown,
    rawAnchorRow: unknown,
    rawAnchorCol: unknown,
    rawSelection: unknown
  ): Promise<void> {
    const text = typeof rawText === 'string' ? rawText : '';
    if (!text) {
      return;
    }
    const anchorRow = Number(rawAnchorRow);
    const anchorCol = Number(rawAnchorCol);
    if (!Number.isInteger(anchorRow) || anchorRow < 0 || !Number.isInteger(anchorCol) || anchorCol < 0) {
      return;
    }
    const matrix = this.parseClipboardMatrix(text);
    if (!matrix.length || !matrix[0].length) {
      return;
    }
    const selection = CsvEditorController.parsePasteSelectionBounds(rawSelection);

    this.isUpdatingDocument = true;
    try {
      const separator = this.getSeparator();
      const oldText = this.document.getText();
      const result = Papa.parse(oldText, { dynamicTyping: false, delimiter: separator });
      const data = result.data as string[][];

      const pasteResult = CsvEditorController.applyPasteMatrixToData(data, matrix, anchorRow, anchorCol, selection);
      if (!pasteResult.changed) {
        return;
      }

      let newCsvText: string | undefined;
      if (!pasteResult.structuralChange) {
        newCsvText = CsvEditorProvider.applyFieldUpdatesPreservingFormat(oldText, separator, pasteResult.updates);
      }
      if (newCsvText === undefined) {
        newCsvText = Papa.unparse(data, { delimiter: separator });
      }
      if (newCsvText === oldText) {
        return;
      }

      const fullRange = new vscode.Range(
        0, 0,
        this.document.lineCount,
        this.document.lineCount ? this.document.lineAt(this.document.lineCount - 1).text.length : 0
      );
      const edit = new vscode.WorkspaceEdit();
      edit.replace(this.document.uri, fullRange, newCsvText);
      await vscode.workspace.applyEdit(edit);

      this.updateWebviewContent();
      this.currentWebviewPanel?.webview.postMessage({
        type: 'pasteApplied',
        startRow: pasteResult.plan.startRow,
        startCol: pasteResult.plan.startCol,
        endRow: pasteResult.plan.endRow,
        endCol: pasteResult.plan.endCol
      });
    } finally {
      this.isUpdatingDocument = false;
    }
  }

  private renderChunkFromState(state: ChunkRenderState, start: number): ChunkResponse {
    if (!Number.isInteger(start) || start < 0) {
      return { html: '', nextStart: -1, done: true };
    }
    return renderCsvChunkFromState(state, start, {
      formatCellContent: (text, linkify) => this.formatCellContent(text, linkify),
      getMultilineCellTitleAttr: text => this.getMultilineCellTitleAttr(text)
    });
  }

  private async requestChunk(rawStart: unknown, requestId: unknown): Promise<void> {
    if (!this.currentWebviewPanel || !this.chunkRenderState) {
      return;
    }
    const start = Number(rawStart);
    if (!Number.isInteger(start) || start < 0) {
      this.currentWebviewPanel.webview.postMessage({
        type: 'chunkData',
        requestId,
        start: -1,
        html: '',
        nextStart: -1,
        done: true
      });
      return;
    }
    const response = this.renderChunkFromState(this.chunkRenderState, start);
    this.currentWebviewPanel.webview.postMessage({
      type: 'chunkData',
      requestId,
      start,
      html: response.html,
      nextStart: response.nextStart,
      done: response.done
    });
  }

  private escapeFindRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private buildFindRegex(query: string, options: { regex: boolean; wholeWord: boolean; matchCase: boolean }): RegExp | undefined {
    if (!query) return undefined;
    const useRegex = !!options.regex;
    const wholeWord = !!options.wholeWord;
    const matchCase = !!options.matchCase;
    let source = useRegex ? query : this.escapeFindRegex(query);
    if (wholeWord) {
      source = `\\b(?:${source})\\b`;
    }
    const flags = matchCase ? 'g' : 'gi';
    try {
      return new RegExp(source, flags);
    } catch {
      return undefined;
    }
  }

  private async findMatches(requestId: unknown, query: unknown, options: unknown): Promise<void> {
    if (!this.currentWebviewPanel) {
      return;
    }

    const requestQuery = typeof query === 'string' ? query : '';
    const optsRaw = (options && typeof options === 'object') ? options as any : {};
    const opts = {
      regex: !!optsRaw.regex,
      wholeWord: !!optsRaw.wholeWord,
      matchCase: !!optsRaw.matchCase
    };

    const postResult = (payload: { matches: Array<{ row: number; col: number; value: string }>; invalidRegex: boolean }) => {
      this.currentWebviewPanel?.webview.postMessage({
        type: 'findMatchesResult',
        requestId,
        matches: payload.matches,
        invalidRegex: payload.invalidRegex
      });
    };

    if (!requestQuery) {
      postResult({ matches: [], invalidRegex: false });
      return;
    }

    const regex = this.buildFindRegex(requestQuery, opts);
    if (!regex) {
      postResult({ matches: [], invalidRegex: true });
      return;
    }

    const separator = this.getSeparator();
    const parsed = Papa.parse(this.document.getText(), { dynamicTyping: false, delimiter: separator });
    const data = this.trimTrailingEmptyRows((parsed.data || []) as string[][]);
    const hiddenRows = this.getHiddenRows();
    const offset = Math.min(Math.max(0, hiddenRows), data.length);
    const matches: Array<{ row: number; col: number; value: string }> = [];

    for (let row = offset; row < data.length; row++) {
      const current = data[row] || [];
      for (let col = 0; col < current.length; col++) {
        const value = String(current[col] ?? '');
        regex.lastIndex = 0;
        if (regex.test(value)) {
          matches.push({ row, col, value });
        }
      }
    }

    postResult({ matches, invalidRegex: false });
  }

  // Apply an edit to a 2D data array, enforcing virtual row/cell invariants.
  // - Empty edits on non-existent virtual row/col are ignored
  // - Non-empty edits expand rows/cols as needed
  // - When editing the last row, trailing empty rows are trimmed
  private mutateDataForEdit(data: string[][], row: number, col: number, value: string): { data: string[][]; trimmed: boolean; createdRow: boolean; createdCol: boolean } {
    // Work on the same array instance (callers pass freshly parsed data)
    const hadRows = data.length;
    const hadColsAtRow = (data[row] ? data[row].length : 0);
    const wasEditingLastRow = row >= (data.length - 1);

    const rowExists = row < data.length;
    const colExists = rowExists && col < (data[row]?.length ?? 0);

    if (value === '') {
      if (!rowExists) {
        return { data, trimmed: false, createdRow: false, createdCol: false };
      }
      if (!colExists) {
        return { data, trimmed: false, createdRow: false, createdCol: false };
      }
      data[row][col] = '';
    } else {
      while (data.length <= row) data.push([]);
      while (data[row].length <= col) data[row].push('');
      data[row][col] = value;
    }

    let trimmed = false;
    if (wasEditingLastRow) {
      const isRowEmpty = (arr: string[] | undefined) => {
        if (!arr || arr.length === 0) return true;
        for (let i = 0; i < arr.length; i++) {
          if ((arr[i] ?? '') !== '') return false;
        }
        return true;
      };
      while (data.length > 0 && isRowEmpty(data[data.length - 1])) {
        data.pop();
        trimmed = true;
      }
    }

    return {
      data,
      trimmed,
      createdRow: value !== '' && row >= hadRows,
      createdCol: value !== '' && col >= hadColsAtRow
    };
  }

  private async handleSave() {
    this.isSaving = true;
    try {
      const success = await this.document.save();
      console.log(success ? 'CSV: Document saved' : 'CSV: Failed to save document');
    } catch (error) {
      console.error('CSV: Error saving document', error);
    } finally {
      this.isSaving = false;
    }
  }

  private async insertColumn(index: number) {
    this.isUpdatingDocument = true;
    const separator = this.getSeparator();
    const text = this.document.getText();
    const result = Papa.parse(text, { dynamicTyping: false, delimiter: separator });
    const data = result.data as string[][];
    for (const row of data) {
      if (index > row.length) {
        while (row.length < index) row.push('');
      }
      row.splice(index, 0, '');
    }
    const newText = Papa.unparse(data, { delimiter: separator });
    const fullRange = new vscode.Range(
      0, 0,
      this.document.lineCount,
      this.document.lineCount ? this.document.lineAt(this.document.lineCount - 1).text.length : 0
    );
    const edit = new vscode.WorkspaceEdit();
    edit.replace(this.document.uri, fullRange, newText);
    await vscode.workspace.applyEdit(edit);
    this.isUpdatingDocument = false;
    this.updateWebviewContent();
  }

  private async insertColumns(index: number, count: number) {
    if (count <= 0) return;
    this.isUpdatingDocument = true;
    const separator = this.getSeparator();
    const text = this.document.getText();
    const result = Papa.parse(text, { dynamicTyping: false, delimiter: separator });
    const data = result.data as string[][];
    for (let k = 0; k < count; k++) {
      for (const row of data) {
        if (index > row.length) {
          while (row.length < index) row.push('');
        }
        row.splice(index, 0, '');
      }
    }
    const newText = Papa.unparse(data, { delimiter: separator });
    const fullRange = new vscode.Range(
      0, 0,
      this.document.lineCount,
      this.document.lineCount ? this.document.lineAt(this.document.lineCount - 1).text.length : 0
    );
    const edit = new vscode.WorkspaceEdit();
    edit.replace(this.document.uri, fullRange, newText);
    await vscode.workspace.applyEdit(edit);
    this.isUpdatingDocument = false;
    this.updateWebviewContent();
  }

  private async deleteColumn(index: number) {
    this.isUpdatingDocument = true;
    const separator = this.getSeparator();
    const text = this.document.getText();
    const result = Papa.parse(text, { dynamicTyping: false, delimiter: separator });
    const data = result.data as string[][];
    for (const row of data) {
      if (index < row.length) {
        row.splice(index, 1);
      }
    }
    const newText = Papa.unparse(data, { delimiter: separator });
    const fullRange = new vscode.Range(
      0, 0,
      this.document.lineCount,
      this.document.lineCount ? this.document.lineAt(this.document.lineCount - 1).text.length : 0
    );
    const edit = new vscode.WorkspaceEdit();
    edit.replace(this.document.uri, fullRange, newText);
    await vscode.workspace.applyEdit(edit);
    this.isUpdatingDocument = false;
    this.updateWebviewContent();
  }

  private async deleteColumns(indices: number[]) {
    if (!indices || !indices.length) return;
    this.isUpdatingDocument = true;
    const separator = this.getSeparator();
    const text = this.document.getText();
    const result = Papa.parse(text, { dynamicTyping: false, delimiter: separator });
    const data = result.data as string[][];
    const sorted = [...indices].sort((a,b)=>b-a);
    for (const idx of sorted) {
      for (const row of data) {
        if (idx < row.length) {
          row.splice(idx, 1);
        }
      }
    }
    const newText = Papa.unparse(data, { delimiter: separator });
    const fullRange = new vscode.Range(
      0, 0,
      this.document.lineCount,
      this.document.lineCount ? this.document.lineAt(this.document.lineCount - 1).text.length : 0
    );
    const edit = new vscode.WorkspaceEdit();
    edit.replace(this.document.uri, fullRange, newText);
    await vscode.workspace.applyEdit(edit);
    this.isUpdatingDocument = false;
    this.updateWebviewContent();
  }

  private async sortColumn(index: number, ascending: boolean) {
    this.isUpdatingDocument = true;

    const config       = vscode.workspace.getConfiguration('csv', this.document.uri);
    const separator    = this.getSeparator();
    const hidden       = this.getHiddenRows();

    const text   = this.document.getText();
    // First sort since the last non-sort mutation? Snapshot so user can later
    // cycle back to "original" order via resetSort.
    if (this.sortSnapshotText === null) {
      this.sortSnapshotText = text;
    }
    const result = Papa.parse(text, { dynamicTyping: false, delimiter: separator });
    // Exclude virtual/trailing empty rows from sort input
    const rows   = this.trimTrailingEmptyRows(result.data as string[][]);
    const treatHeader  = this.getEffectiveHeader(rows, this.getHiddenRows());

    const offset = Math.min(Math.max(0, hidden), rows.length);
    let header: string[] = [];
    let body:   string[][] = [];

    if (treatHeader && offset < rows.length) {
      header = rows[offset];
      body   = rows.slice(offset + 1);
    } else {
      body   = rows.slice(offset);
    }

    const cmp = (a: string, b: string) => {
      const sa = (a ?? '').trim();
      const sb = (b ?? '').trim();
      const aEmpty = sa === '';
      const bEmpty = sb === '';
      if (aEmpty && bEmpty) return 0;
      if (aEmpty) return 1; // empty sorts last
      if (bEmpty) return -1;

      // Dates take precedence over numeric compare (avoid parseFloat on ISO)
      const aIsDate = this.isDate(sa);
      const bIsDate = this.isDate(sb);
      if (aIsDate && bIsDate) {
        const da = Date.parse(sa);
        const db = Date.parse(sb);
        if (!isNaN(da) && !isNaN(db)) return da - db;
      }

      const na = parseFloat(sa), nb = parseFloat(sb);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return sa.localeCompare(sb, undefined, { sensitivity: 'base' });
    };

    body.sort((r1, r2) => {
      const diff = cmp(r1[index] ?? '', r2[index] ?? '');
      return ascending ? diff : -diff;
    });

    const prefix = rows.slice(0, offset);
    const combined = treatHeader ? [...prefix, header, ...body] : [...prefix, ...body];

    // Sanitize before unparse: ensure undefined/null/NaN become empty strings
    const sanitized: string[][] = combined.map(r => r.map((v: any) => {
      if (v === undefined || v === null) return '';
      const t = typeof v;
      if (t === 'number') {
        return Number.isNaN(v) ? '' : String(v);
      }
      const s = String(v);
      return s.toLowerCase() === 'nan' ? '' : s;
    }));

    const newCsv = Papa.unparse(sanitized, { delimiter: separator });

    const fullRange = new vscode.Range(
      0, 0,
      this.document.lineCount,
      this.document.lineCount ? this.document.lineAt(this.document.lineCount - 1).text.length : 0
    );

    const edit = new vscode.WorkspaceEdit();
    edit.replace(this.document.uri, fullRange, newCsv);
    await vscode.workspace.applyEdit(edit);

    this.isUpdatingDocument = false;
    this.updateWebviewContent();
    console.log(`CSV: Sorted column ${index + 1} (${ascending ? 'A-Z' : 'Z-A'})`);
  }

  /**
   * Restore the document text captured by the most recent snapshot taken by
   * sortColumn, undoing any sort applied since that snapshot. No-op if we
   * don't have a snapshot (e.g. user never sorted).
   */
  private async resetSort(): Promise<void> {
    const snapshot = this.sortSnapshotText;
    if (snapshot === null) {
      return;
    }
    this.isUpdatingDocument = true;
    try {
      if (this.document.getText() !== snapshot) {
        const fullRange = new vscode.Range(
          0, 0,
          this.document.lineCount,
          this.document.lineCount ? this.document.lineAt(this.document.lineCount - 1).text.length : 0
        );
        const edit = new vscode.WorkspaceEdit();
        edit.replace(this.document.uri, fullRange, snapshot);
        await vscode.workspace.applyEdit(edit);
      }
      this.sortSnapshotText = null;
    } finally {
      this.isUpdatingDocument = false;
      this.updateWebviewContent();
      console.log('CSV: Reset sort to original order');
    }
  }

  private async insertRow(index: number) {
    this.isUpdatingDocument = true;
    const separator = this.getSeparator();
    const text = this.document.getText();
    const result = Papa.parse(text, { dynamicTyping: false, delimiter: separator });
    const data = result.data as string[][];
    const numColumns = data.reduce((max, r) => Math.max(max, r.length), 0);
    const newRow = Array(numColumns).fill('');
    if (index > data.length) {
      while (data.length < index) data.push(Array(numColumns).fill(''));
    }
    data.splice(index, 0, newRow);
    const newText = Papa.unparse(data, { delimiter: separator });
    const fullRange = new vscode.Range(
      0, 0,
      this.document.lineCount,
      this.document.lineCount ? this.document.lineAt(this.document.lineCount - 1).text.length : 0
    );
    const edit = new vscode.WorkspaceEdit();
    edit.replace(this.document.uri, fullRange, newText);
    await vscode.workspace.applyEdit(edit);
    this.isUpdatingDocument = false;
    this.updateWebviewContent();
  }

  private async insertRows(index: number, count: number) {
    if (count <= 0) return;
    this.isUpdatingDocument = true;
    const separator = this.getSeparator();
    const text = this.document.getText();
    const result = Papa.parse(text, { dynamicTyping: false, delimiter: separator });
    const data = result.data as string[][];
    const numColumns = data.reduce((max, r) => Math.max(max, r.length), 0);
    for (let k = 0; k < count; k++) {
      const newRow = Array(numColumns).fill('');
      if (index > data.length) {
        while (data.length < index) data.push(Array(numColumns).fill(''));
      }
      data.splice(index, 0, newRow);
    }
    const newText = Papa.unparse(data, { delimiter: separator });
    const fullRange = new vscode.Range(
      0, 0,
      this.document.lineCount,
      this.document.lineCount ? this.document.lineAt(this.document.lineCount - 1).text.length : 0
    );
    const edit = new vscode.WorkspaceEdit();
    edit.replace(this.document.uri, fullRange, newText);
    await vscode.workspace.applyEdit(edit);
    this.isUpdatingDocument = false;
    this.updateWebviewContent();
  }

  private async deleteRow(index: number) {
    this.isUpdatingDocument = true;
    const separator = this.getSeparator();
    const text = this.document.getText();
    const result = Papa.parse(text, { dynamicTyping: false, delimiter: separator });
    const data = result.data as string[][];
    if (index < data.length) {
      data.splice(index, 1);
    }
    const newText = Papa.unparse(data, { delimiter: separator });
    const fullRange = new vscode.Range(
      0, 0,
      this.document.lineCount,
      this.document.lineCount ? this.document.lineAt(this.document.lineCount - 1).text.length : 0
    );
    const edit = new vscode.WorkspaceEdit();
    edit.replace(this.document.uri, fullRange, newText);
    await vscode.workspace.applyEdit(edit);
    this.isUpdatingDocument = false;
    this.updateWebviewContent();
  }

  private async deleteRows(indices: number[]) {
    if (!indices || !indices.length) return;
    this.isUpdatingDocument = true;
    const separator = this.getSeparator();
    const text = this.document.getText();
    const result = Papa.parse(text, { dynamicTyping: false, delimiter: separator });
    const data = result.data as string[][];
    const sorted = [...indices].sort((a,b)=>b-a);
    for (const idx of sorted) {
      if (idx < data.length) {
        data.splice(idx, 1);
      }
    }
    const newText = Papa.unparse(data, { delimiter: separator });
    const fullRange = new vscode.Range(
      0, 0,
      this.document.lineCount,
      this.document.lineCount ? this.document.lineAt(this.document.lineCount - 1).text.length : 0
    );
    const edit = new vscode.WorkspaceEdit();
    edit.replace(this.document.uri, fullRange, newText);
    await vscode.workspace.applyEdit(edit);
    this.isUpdatingDocument = false;
    this.updateWebviewContent();
  }

  private normalizeIndices(indices: unknown, maxExclusive: number): number[] {
    if (!Array.isArray(indices) || maxExclusive <= 0) return [];
    const seen = new Set<number>();
    const out: number[] = [];
    for (const raw of indices) {
      const num = Number(raw);
      if (!Number.isFinite(num)) continue;
      const idx = Math.trunc(num);
      if (idx < 0 || idx >= maxExclusive || seen.has(idx)) continue;
      seen.add(idx);
      out.push(idx);
    }
    out.sort((a, b) => a - b);
    return out;
  }

  private reorderByIndices<T>(items: T[], indices: unknown, beforeIndex: unknown): { reordered: T[]; changed: boolean } {
    const selected = this.normalizeIndices(indices, items.length);
    if (!selected.length) {
      return { reordered: [...items], changed: false };
    }

    const before = Number(beforeIndex);
    const safeBefore = Number.isFinite(before) ? Math.trunc(before) : items.length;
    const clampedBefore = Math.min(Math.max(safeBefore, 0), items.length);

    const selectedSet = new Set(selected);
    const moving = selected.map(i => items[i]);
    const remaining = items.filter((_, i) => !selectedSet.has(i));
    const removedBefore = selected.filter(i => i < clampedBefore).length;
    const insertAt = Math.min(Math.max(clampedBefore - removedBefore, 0), remaining.length);
    const reordered = [...remaining.slice(0, insertAt), ...moving, ...remaining.slice(insertAt)];

    let changed = false;
    for (let i = 0; i < items.length; i++) {
      if (reordered[i] !== items[i]) {
        changed = true;
        break;
      }
    }
    return { reordered, changed };
  }

  private async reorderColumns(indices: unknown, beforeIndex: unknown) {
    this.isUpdatingDocument = true;
    try {
      const separator = this.getSeparator();
      const text = this.document.getText();
      const result = Papa.parse(text, { dynamicTyping: false, delimiter: separator });
      const data = result.data as string[][];
      const numColumns = data.reduce((max, row) => Math.max(max, row.length), 0);
      if (numColumns <= 0) return;

      const sourceOrder = Array.from({ length: numColumns }, (_, i) => i);
      const { reordered: columnOrder, changed } = this.reorderByIndices(sourceOrder, indices, beforeIndex);
      if (!changed) return;

      const reorderedData = data.map(row => {
        const normalized = Array.from({ length: numColumns }, (_, i) => row[i] ?? '');
        const next = columnOrder.map(colIdx => normalized[colIdx] ?? '');
        while (next.length > 0 && next[next.length - 1] === '') {
          next.pop();
        }
        return next;
      });

      const newText = Papa.unparse(reorderedData, { delimiter: separator });
      const fullRange = new vscode.Range(
        0, 0,
        this.document.lineCount,
        this.document.lineCount ? this.document.lineAt(this.document.lineCount - 1).text.length : 0
      );
      const edit = new vscode.WorkspaceEdit();
      edit.replace(this.document.uri, fullRange, newText);
      await vscode.workspace.applyEdit(edit);
      this.updateWebviewContent();
    } finally {
      this.isUpdatingDocument = false;
    }
  }

  private async reorderRows(indices: unknown, beforeIndex: unknown) {
    this.isUpdatingDocument = true;
    try {
      const separator = this.getSeparator();
      const text = this.document.getText();
      const result = Papa.parse(text, { dynamicTyping: false, delimiter: separator });
      const data = result.data as string[][];
      if (!data.length) return;

      const { reordered, changed } = this.reorderByIndices(data, indices, beforeIndex);
      if (!changed) return;

      const newText = Papa.unparse(reordered, { delimiter: separator });
      const fullRange = new vscode.Range(
        0, 0,
        this.document.lineCount,
        this.document.lineCount ? this.document.lineAt(this.document.lineCount - 1).text.length : 0
      );
      const edit = new vscode.WorkspaceEdit();
      edit.replace(this.document.uri, fullRange, newText);
      await vscode.workspace.applyEdit(edit);
      this.updateWebviewContent();
    } finally {
      this.isUpdatingDocument = false;
    }
  }

  // ───────────── Webview Rendering ─────────────

  private updateWebviewContent() {
    if (!this.currentWebviewPanel) return;

    const webview = this.currentWebviewPanel.webview;
    const config = vscode.workspace.getConfiguration('csv', this.document.uri);
    const addSerialIndex = CsvEditorProvider.getSerialIndexForUri(this.context, this.document.uri);
    const separator = this.getSeparator();
    const hiddenRows = this.getHiddenRows();

    let parsed;
    try {
      parsed = Papa.parse(this.document.getText(), { dynamicTyping: false, delimiter: separator });
      console.log(`CSV: Parsed CSV data with ${parsed.data.length} rows`);
    } catch (error) {
      console.error('CSV: Error parsing CSV content', error);
      parsed = { data: [] };
    }

    const fontFamily =
      config.get<string>('fontFamily') ||
      vscode.workspace.getConfiguration('editor').get<string>('fontFamily', 'Menlo');
    const fontSize = CsvEditorController.resolveEffectiveFontSize(
      config.get<number>('fontSize', 0),
      vscode.workspace.getConfiguration('editor').get<number>('fontSize', 14)
    );

    const cellPadding = config.get<number>('cellPadding', 4);
    const rawData = this.trimTrailingEmptyRows((parsed.data || []) as string[][]);
    const treatHeader = this.getEffectiveHeader(rawData, hiddenRows);
    const offset = Math.min(Math.max(0, hiddenRows), rawData.length);
    const data = this.applyFilterSort(rawData, offset, treatHeader);
    const columnLabels = this.getColumnLabels(rawData, offset, treatHeader);
    const clickableLinks = config.get<boolean>('clickableLinks', true);
    const configuredColumnColorMode = config.get<string>('columnColorMode', 'type');
    const diffUseThemeForeground = config.get<boolean>('diffUseThemeForeground', true);
    const columnColorMode = CsvEditorController.resolveEffectiveColumnColorMode(
      configuredColumnColorMode,
      this.isDiffContext,
      diffUseThemeForeground
    );
    const columnColorPalette = config.get<string>('columnColorPalette', 'default');
    const showTrailingEmptyRow = config.get<boolean>('showTrailingEmptyRow', true);
    const mouseWheelZoomEnabled = config.get<boolean>('mouseWheelZoom', true);
    const mouseWheelZoomInvert = config.get<boolean>('mouseWheelZoomInvert', false);
    const rowHeightModeRaw = config.get<string>('rowHeightMode', 'compact');
    const rowHeightMode: 'compact' | 'wrap' =
      rowHeightModeRaw === 'compact' ? 'compact'
      : rowHeightModeRaw === 'wrap' ? 'wrap'
      : 'compact';

    const { tableHtml, chunksJson, colorCss, nextChunkStart, hasRemoteChunks, chunkState } =
      this.generateTableAndChunks(
        data,
        treatHeader,
        addSerialIndex,
        hiddenRows,
        clickableLinks,
        columnColorMode,
        columnColorPalette,
        showTrailingEmptyRow,
        /* maxSerializedChunks */ 0
      );
    this.chunkRenderState = chunkState;

    const nonce = this.getNonce();

    this.currentWebviewPanel.webview.html = this.wrapHtml({
      webview,
      nonce,
      fontFamily,
      fontSize,
      cellPadding,
      separator,
      tableHtml,
      chunksJson,
      extraColumnColorCss: colorCss,
      nextChunkStart,
      hasRemoteChunks,
      mouseWheelZoomEnabled,
      mouseWheelZoomInvert,
      rowHeightMode,
      columnLabels,
      columnFilters: this.filterSortState.columnFilters
    });
  }

  private generateTableAndChunks(
    data: string[][],
    treatHeader: boolean,
    addSerialIndex: boolean,
    hiddenRows: number,
    clickableLinks: boolean,
    columnColorMode: string,
    columnColorPalette: string,
    showTrailingEmptyRow: boolean,
    maxSerializedChunks: number = Number.MAX_SAFE_INTEGER
  ): {
    tableHtml: string;
    chunksJson: string;
    colorCss: string;
    nextChunkStart: number;
    hasRemoteChunks: boolean;
    chunkState: ChunkRenderState | undefined;
  } {
    return generateCsvTableAndChunks({
      data,
      treatHeader,
      addSerialIndex,
      hiddenRows,
      clickableLinks,
      columnColorMode,
      columnColorPalette,
      showTrailingEmptyRow,
      maxSerializedChunks,
      isDark: vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark,
      helpers: {
        formatCellContent: (text, linkify) => this.formatCellContent(text, linkify),
        getMultilineCellTitleAttr: text => this.getMultilineCellTitleAttr(text),
        computeColumnWidths: rows => this.computeColumnWidths(rows),
        estimateColumnDataType: column => this.estimateColumnDataType(column),
        getColumnColor: (type, isDark, columnIndex, palette) => this.getColumnColor(type, isDark, columnIndex, palette)
      }
    });
  }

  private getEffectiveHeader(_data: string[][], _hiddenRows: number): boolean {
    const map = this.context.workspaceState.get<Record<string, boolean>>(CsvEditorProvider.headerKey, {});
    const key = this.document.uri.toString();
    if (key in map) return map[key];
    return true;
  }

  private wrapHtml(args: {
    webview: vscode.Webview;
    nonce: string;
    fontFamily: string;
    fontSize: number;
    cellPadding: number;
    separator: string;
    tableHtml: string;
    chunksJson: string;
    extraColumnColorCss: string;
    nextChunkStart: number;
    hasRemoteChunks: boolean;
    mouseWheelZoomEnabled: boolean;
    mouseWheelZoomInvert: boolean;
    rowHeightMode: 'compact' | 'wrap';
    columnLabels: string[];
    columnFilters: Record<string, CsvColumnFilterCondition | string>;
  }): string {
    const { webview, nonce, fontFamily, fontSize, cellPadding, separator, tableHtml, chunksJson, extraColumnColorCss, nextChunkStart, hasRemoteChunks, mouseWheelZoomEnabled, mouseWheelZoomInvert, rowHeightMode, columnLabels, columnFilters } = args;
    const isDark = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark;
    // Build script URI using file path for compatibility (older APIs may lack Uri.joinPath)
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.file(path.join(this.context.extensionPath, 'media-媒体', 'main.js'))
    );
    const findReplaceScriptUri = webview.asWebviewUri(
      vscode.Uri.file(path.join(this.context.extensionPath, 'media-媒体', 'webviewFindReplace.js'))
    );
    const filterPanelScriptUri = webview.asWebviewUri(
      vscode.Uri.file(path.join(this.context.extensionPath, 'media-媒体', 'webviewFilterPanel.js'))
    );

    // Safe separator transport (assumes single character; see assumptions)
    const sepCode = (separator && separator.length > 0) ? separator.codePointAt(0)! : ','.codePointAt(0)!;
    const columnOptionsHtml = columnLabels.map((label, index) => {
      const shown = label.trim() || `列 ${index + 1}`;
      return `<option value="${index}">${this.escapeHtml(`${index + 1}. ${shown}`)}</option>`;
    }).join('');
    const columnLabelsJson = JSON.stringify(columnLabels);
    const columnFiltersJson = JSON.stringify(columnFilters || {});

    return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none'; img-src ${webview.cspSource} https:; style-src 'unsafe-inline' ${webview.cspSource}; script-src 'nonce-${nonce}' ${webview.cspSource};">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CSV</title>
    <style nonce="${nonce}">
      body { font-family: ${this.escapeCss(fontFamily)}; font-size: ${fontSize}px; margin: 0; padding: 0; user-select: none; }
      .table-container { overflow: auto; height: 100vh; }
      table { border-collapse: collapse; width: max-content; }
      th, td { padding: ${cellPadding}px 8px; border: 1px solid ${isDark ? '#555' : '#ccc'}; font-size: inherit; vertical-align: top; }
      th { background-color: ${isDark ? '#1e1e1e' : '#ffffff'}; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
      td { overflow: hidden; }
      td .cell-body { display: block; white-space: pre-wrap; overflow-wrap: anywhere; }
      table.row-compact td .cell-body { white-space: nowrap !important; overflow: hidden !important; text-overflow: ellipsis !important; max-height: ${Math.max(18, Math.round(fontSize * 1.4))}px; }
      td.editing .cell-body { max-height: none !important; overflow: visible !important; white-space: pre-wrap !important; }
      td.selected, th.selected { background-color: ${isDark ? '#333333' : '#cce0ff'} !important; }
      td.editing, th.editing { overflow: visible !important; white-space: pre-wrap !important; overflow-wrap: anywhere !important; max-width: none !important; }
      .highlight { background-color: ${isDark ? '#2a2a2a' : '#fefefe'} !important; }
      .active-match { background-color: ${isDark ? '#444444' : '#ffffcc'} !important; }
      .csv-link { color: ${isDark ? '#6cb6ff' : '#0066cc'}; text-decoration: underline; cursor: pointer; }
      .csv-link:hover { color: ${isDark ? '#8ecfff' : '#0044aa'}; }
      #findReplaceWidget {
        position: fixed;
        top: 12px;
        right: 20px;
        width: 592px;
        min-width: 592px;
        max-width: 592px;
        background: #171717;
        border: 1px solid #2a2a2a;
        border-radius: 8px;
        padding: 10px;
        box-shadow: 0 6px 18px rgba(0,0,0,0.45);
        z-index: 1200;
        display: none;
        align-items: stretch;
        color: #d4d4d4;
        font-family: ${this.escapeCss(fontFamily)};
        font-size: inherit;
      }
      #findReplaceWidget.open { display: flex; }
      #findReplaceWidget .fr-gutter {
        width: 24px;
        min-width: 24px;
        border-radius: 6px;
        background: #2a2b2b;
        border-right: 1px solid #1f1f1f;
        margin-right: 10px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      #findReplaceWidget .fr-content {
        flex: 1 1 auto;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      #findReplaceWidget.replace-collapsed .fr-row-replace { display: none; }
      #findReplaceWidget .fr-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      #findReplaceWidget .fr-row-find .fr-input-wrap {
        flex: 0 0 calc(25ch + 118px);
        width: calc(25ch + 118px);
      }
      #findReplaceWidget .fr-row-replace .fr-input-wrap {
        flex: 0 0 calc(25ch + 54px);
        width: calc(25ch + 54px);
      }
      #findReplaceWidget .fr-input-wrap {
        position: relative;
        flex: 1 1 auto;
        min-width: 0;
      }
      #findReplaceWidget .fr-input {
        width: 100%;
        height: 36px;
        box-sizing: border-box;
        border: 1px solid #2a2a2a;
        border-radius: 6px;
        background: #1c1c1c;
        color: #d4d4d4;
        padding-left: 10px;
        font-size: inherit;
        outline: none;
      }
      #findReplaceWidget .fr-input::placeholder { color: #6a6a6a; }
      #findReplaceWidget .fr-input:focus {
        border-color: #3a3a3a;
        box-shadow: 0 0 0 2px rgba(255,255,255,0.06);
      }
      #findInput { padding-right: 118px; }
      #replaceInput { padding-right: 54px; }
      #findReplaceWidget .fr-inline-toggles {
        position: absolute;
        right: 6px;
        top: 50%;
        transform: translateY(-50%);
        display: flex;
        align-items: center;
        gap: 4px;
        padding-left: 6px;
        border-left: 1px solid rgba(42,42,42,0.75);
      }
      #findReplaceWidget .fr-toggle-btn {
        min-width: 24px;
        height: 24px;
        border: 0;
        border-radius: 4px;
        background: transparent;
        color: rgba(189,189,189,0.8);
        font-size: 0.86em;
        cursor: pointer;
        padding: 0 4px;
      }
      #findReplaceWidget .fr-toggle-btn:hover { background: rgba(255,255,255,0.04); color: #e6e6e6; }
      #findReplaceWidget .fr-toggle-btn[aria-pressed="true"] {
        color: #e6e6e6;
        box-shadow: inset 0 -2px 0 #e6e6e6;
      }
      #findReplaceWidget .fr-status {
        min-width: 84px;
        text-align: right;
        color: #d0d0d0;
        font-size: inherit;
      }
      #findReplaceWidget .fr-divider {
        width: 1px;
        height: 22px;
        background: #2a2a2a;
      }
      #findReplaceWidget .fr-icon-btn,
      #findReplaceWidget .fr-action-btn,
      #findReplaceWidget .fr-caret-btn {
        width: 28px;
        height: 28px;
        border: 1px solid transparent;
        border-radius: 4px;
        background: transparent;
        color: #bdbdbd;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0;
      }
      #findReplaceWidget .fr-icon-btn:hover,
      #findReplaceWidget .fr-action-btn:hover,
      #findReplaceWidget .fr-caret-btn:hover {
        background: rgba(255,255,255,0.05);
        color: #e6e6e6;
      }
      #findReplaceWidget .fr-icon-btn[disabled],
      #findReplaceWidget .fr-action-btn[disabled] {
        color: #6a6a6a;
        cursor: default;
        pointer-events: none;
      }
      #findReplaceWidget .fr-close-btn:hover { background: rgba(255,255,255,0.08); color: #ffffff; }
      #findReplaceWidget .fr-actions {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      #findReplaceWidget .fr-overflow-menu {
        position: absolute;
        top: 48px;
        right: 44px;
        min-width: 200px;
        background: #202020;
        border: 1px solid #2f2f2f;
        border-radius: 6px;
        box-shadow: 0 10px 24px rgba(0,0,0,0.45);
        padding: 4px;
        display: none;
      }
      #findReplaceWidget .fr-overflow-menu.open { display: block; }
      #findReplaceWidget .fr-overflow-item {
        width: 100%;
        border: 0;
        background: transparent;
        color: #d4d4d4;
        border-radius: 4px;
        text-align: left;
        padding: 6px 8px;
        cursor: pointer;
        font-size: inherit;
      }
      #findReplaceWidget .fr-overflow-item:hover { background: rgba(255,255,255,0.05); }
      #contextMenu { position: absolute; display: none; background: ${isDark ? '#2d2d2d' : '#ffffff'}; border: 1px solid ${isDark ? '#555' : '#ccc'}; z-index: 10000; font-family: ${this.escapeCss(fontFamily)}; font-size: inherit; }
      #contextMenu div { padding: 4px 12px; cursor: pointer; }
      #contextMenu div:hover { background: ${isDark ? '#3d3d3d' : '#eeeeee'}; }

      /* Per-column computed colors */
      ${extraColumnColorCss}
      /* Header content wrapper: label + sort button side by side, TH itself stays a table-cell */
      th[data-col] .th-content {
        display: inline-flex;
        align-items: center;
        width: 100%;
        gap: 4px;
        min-width: 0;
      }
      th[data-col] .th-label {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      th[data-col] .sort-btn {
        flex: 0 0 auto;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        margin-right: 2px;
        cursor: pointer;
        user-select: none;
        border-radius: 4px;
        border: 1.5px solid ${isDark ? '#7a7a7a' : '#666'};
        background-color: ${isDark ? '#3a3a3a' : '#f0f0f0'};
        color: ${isDark ? '#e0e0e0' : '#333'} !important;
        font-size: 12px;
        font-weight: 700;
        line-height: 1;
        text-align: center;
        box-shadow: 0 1px 0 rgba(0,0,0,0.1);
        transition: background-color 0.1s, border-color 0.1s;
      }
      th[data-col] .sort-btn::before { content: "\\2195"; display: inline-block; }
      th[data-col] .sort-btn:hover {
        background-color: ${isDark ? '#4a4a4a' : '#d8e4fb'};
        border-color: #0a84ff;
        color: #0a84ff !important;
      }
      th.sort-asc .sort-btn,
      th.sort-desc .sort-btn {
        background-color: #0a84ff;
        border-color: #0a84ff;
        color: #ffffff !important;
      }
      th.sort-asc .sort-btn::before { content: "\\25B2"; }
      th.sort-desc .sort-btn::before { content: "\\25BC"; }
      #csvFloatPanel:hover,
      #csvFloatPanel:focus-within { opacity: 1; }
      #csvColumnFilterPopover[hidden] { display: none !important; }
      #csvFloatPanel > * { flex:0 0 auto; }
      #csvColumnFilterChips { min-width:0; }
      .csv-filter-chip { display:inline-flex;align-items:center;gap:4px;max-width:220px;flex:0 0 auto;border:1px solid ${isDark?'#555':'#ccc'};border-radius:999px;background:${isDark?'#252525':'#eef3ff'};color:${isDark?'#ddd':'#222'};padding:2px 6px;font-size:0.85em; }
      .csv-filter-chip span { overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
      .csv-filter-chip button { border:0;background:transparent;color:inherit;cursor:pointer;font-size:1.1em;line-height:1;padding:0 2px; }
    </style>
  </head>
  <body>
    <div id="csv-root" class="table-container" data-sepcode="${sepCode}" data-fontsize="${fontSize}" data-wheelzoomenabled="${mouseWheelZoomEnabled ? '1' : '0'}" data-wheelzoominvert="${mouseWheelZoomInvert ? '1' : '0'}" data-nextchunkstart="${nextChunkStart >= 0 ? nextChunkStart : ''}" data-hasmorechunks="${hasRemoteChunks ? '1' : '0'}">
      ${tableHtml.replace('<table>', `<table class="row-${rowHeightMode}">`)}
    </div>

    <div id="csvFloatPanel" style="position:fixed;right:16px;bottom:16px;z-index:1150;display:flex;align-items:center;flex-wrap:nowrap;gap:8px;max-width:calc(100vw - 32px);overflow-x:auto;overflow-y:hidden;white-space:nowrap;padding:6px 10px;border:1px solid ${isDark?'#555':'#ccc'};border-radius:6px;background:${isDark?'rgba(30,30,30,0.92)':'rgba(255,255,255,0.96)'};backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);box-shadow:0 4px 12px rgba(0,0,0,0.25);opacity:0.88;transition:opacity 0.15s ease;font-size:inherit;">
      <span style="font-weight:600;color:${isDark?'#ccc':'#333'};">过滤:</span>
      <span style="color:${isDark?'#888':'#999'};font-size:0.85em;" id="csvFilterStatus"></span>
      <select id="csvColumnFilterColumn" style="height:24px;min-width:120px;max-width:220px;border:1px solid ${isDark?'#555':'#ccc'};border-radius:3px;background:${isDark?'#2d2d2d':'#f5f5f5'};color:${isDark?'#d4d4d4':'#333'};font-size:inherit;">
        ${columnOptionsHtml}
      </select>
      <select id="csvColumnFilterMode" title="匹配方式" style="height:24px;border:1px solid ${isDark?'#555':'#ccc'};border-radius:3px;background:${isDark?'#2d2d2d':'#f5f5f5'};color:${isDark?'#d4d4d4':'#333'};font-size:inherit;">
        <option value="contains">包含</option>
        <option value="equals">等于</option>
      </select>
      <input id="csvColumnFilterValue" type="text" placeholder="过滤词，Enter 添加" style="height:24px;width:150px;border:1px solid ${isDark?'#555':'#ccc'};border-radius:3px;background:${isDark?'#2d2d2d':'#f5f5f5'};color:${isDark?'#d4d4d4':'#333'};padding:0 6px;font-size:inherit;outline:none;">
      <label title="匹配时忽略大小写" style="display:inline-flex;align-items:center;gap:3px;color:${isDark?'#ccc':'#333'};font-size:0.9em;"><input id="csvColumnFilterIgnoreCase" type="checkbox" checked>忽略大小写</label>
      <label title="匹配时删除所有空白字符再比较" style="display:inline-flex;align-items:center;gap:3px;color:${isDark?'#ccc':'#333'};font-size:0.9em;"><input id="csvColumnFilterIgnoreWhitespace" type="checkbox">忽略空格</label>
      <button id="csvColumnFilterAdd" type="button" style="height:24px;border:1px solid ${isDark?'#555':'#ccc'};border-radius:3px;background:${isDark?'#2d2d2d':'#f5f5f5'};color:${isDark?'#d4d4d4':'#333'};cursor:pointer;font-size:inherit;padding:0 8px;">添加</button>
      <button id="csvColumnFilterClear" type="button" style="height:24px;border:1px solid ${isDark?'#555':'#ccc'};border-radius:3px;background:${isDark?'#2d2d2d':'#f5f5f5'};color:${isDark?'#d4d4d4':'#333'};cursor:pointer;font-size:inherit;padding:0 8px;display:none;">清空</button>
      <div id="csvColumnFilterChips" style="display:flex;flex-wrap:nowrap;gap:6px;max-width:min(360px,35vw);overflow-x:auto;overflow-y:hidden;"></div>
      <span style="flex:0 0 auto;width:1px;height:18px;background:${isDark?'#555':'#ccc'};margin:0 2px;"></span>
      <span style="font-weight:600;color:${isDark?'#ccc':'#333'};">行高:</span>
      <button id="csvRowHeightToggle" type="button" data-mode="${rowHeightMode}" style="height:24px;border:1px solid ${isDark?'#555':'#ccc'};border-radius:3px;background:${isDark?'#2d2d2d':'#f5f5f5'};color:${isDark?'#d4d4d4':'#333'};cursor:pointer;font-size:inherit;padding:0 8px;" title="点击切换 紧凑 ↔ 自然折行（也可拖动行底边手动调整）">${rowHeightMode === 'compact' ? '紧凑' : '自然折行'}</button>
    </div>

    <script id="__csvChunks" type="application/json" nonce="${nonce}">${chunksJson}</script>
    <script id="__csvColumnLabels" type="application/json" nonce="${nonce}">${this.escapeHtml(columnLabelsJson)}</script>
    <script id="__csvColumnFilters" type="application/json" nonce="${nonce}">${this.escapeHtml(columnFiltersJson)}</script>

    <div id="findReplaceWidget" class="replace-collapsed" role="group" aria-label="Find and Replace">
      <div id="replaceToggleGutter" class="fr-gutter">
        <button id="replaceToggle" class="fr-caret-btn" type="button" aria-label="Toggle Replace" aria-expanded="false">›</button>
      </div>
      <div class="fr-content">
        <div class="fr-row fr-row-find">
          <div class="fr-input-wrap">
            <input id="findInput" class="fr-input" type="text" placeholder="Find" aria-label="Find">
            <div class="fr-inline-toggles">
              <button id="findCaseToggle" class="fr-toggle-btn" type="button" aria-label="Match Case" aria-pressed="false" title="Match Case">Aa</button>
              <button id="findWordToggle" class="fr-toggle-btn" type="button" aria-label="Match Whole Word" aria-pressed="false" title="Match Whole Word">ab</button>
              <button id="findRegexToggle" class="fr-toggle-btn" type="button" aria-label="Use Regular Expression" aria-pressed="false" title="Use Regular Expression">.*</button>
            </div>
          </div>
          <div id="findStatus" class="fr-status">No results</div>
          <div class="fr-divider" aria-hidden="true"></div>
          <button id="findPrev" class="fr-icon-btn" type="button" aria-label="Previous Match" title="Previous Match" disabled>↑</button>
          <button id="findNext" class="fr-icon-btn" type="button" aria-label="Next Match" title="Next Match" disabled>↓</button>
          <button id="findMenuButton" class="fr-icon-btn" type="button" aria-label="More Find Options" title="More Find Options">☰</button>
          <button id="findClose" class="fr-icon-btn fr-close-btn" type="button" aria-label="Close Find and Replace" title="Close">✕</button>
        </div>
        <div class="fr-row fr-row-replace">
          <div class="fr-input-wrap">
            <input id="replaceInput" class="fr-input" type="text" placeholder="Replace" aria-label="Replace">
            <div class="fr-inline-toggles">
              <button id="replaceCaseToggle" class="fr-toggle-btn" type="button" aria-label="Preserve Case" aria-pressed="false" title="Preserve Case">AB</button>
            </div>
          </div>
          <div class="fr-actions">
            <button id="replaceOne" class="fr-action-btn" type="button" aria-label="Replace" title="Replace" disabled>↵</button>
            <button id="replaceAll" class="fr-action-btn" type="button" aria-label="Replace All" title="Replace All" disabled>⇅</button>
          </div>
        </div>
        <div id="findOverflowMenu" class="fr-overflow-menu" role="menu" aria-label="Find Options">
          <button id="findOverflowSelection" class="fr-overflow-item" type="button" role="menuitem">Find in selection</button>
          <button id="findOverflowDiacritics" class="fr-overflow-item" type="button" role="menuitem">Match diacritics</button>
          <button id="findOverflowPreserveCase" class="fr-overflow-item" type="button" role="menuitem">Toggle preserve case</button>
        </div>
      </div>
    </div>
    <div id="contextMenu"></div>

    <script nonce="${nonce}" src="${findReplaceScriptUri}"></script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
    <script nonce="${nonce}" src="${filterPanelScriptUri}"></script>
  </body>
</html>`;
  }

  // ───────────── Utilities ─────────────

  private computeColumnWidths(data: string[][]): number[] {
    const numColumns = data.reduce((max, row) => Math.max(max, row.length), 0);
    const widths = Array(numColumns).fill(0);
    for (const row of data) {
      for (let i = 0; i < numColumns; i++){
        widths[i] = Math.max(widths[i], (row[i] || '').length);
      }
    }
    console.log(`CSV: Column widths: ${widths}`);
    return widths;
  }

  private getSeparator(): string {
    const stored = CsvEditorProvider.getSeparatorForUri(this.context, this.document.uri);
    if (stored && stored.length) return stored;

    const settings = CsvEditorProvider.getSeparatorSettings(this.document.uri);
    const configKey = CsvEditorProvider.serializeSeparatorSettings(settings);
    const version = this.document.version;
    if (
      this.separatorCache &&
      this.separatorCache.version === version &&
      this.separatorCache.configKey === configKey
    ) {
      return this.separatorCache.separator;
    }

    const filePath = this.document?.uri.fsPath || this.document?.uri.path || '';
    const text = this.document.getText();
    const separator = CsvEditorProvider.resolveInheritedSeparator(filePath, text, settings);
    this.separatorCache = { version, configKey, separator };
    return separator;
  }

  private getHiddenRows(): number {
    return CsvEditorProvider.getHiddenRowsForUri(this.context, this.document.uri);
  }

  private getColumnLabels(data: string[][], offset: number, hasHeader: boolean): string[] {
    const header = hasHeader && data[offset] ? data[offset] : undefined;
    const maxCols = data.reduce((max, row) => Math.max(max, row.length), 0);
    return Array.from({ length: maxCols }, (_, index) => {
      const label = header?.[index]?.trim();
      return label || `列 ${index + 1}`;
    });
  }

  private escapeHtml(text: string): string {
    return escapeHtml(text);
  }

  private isAllowedExternalScheme(scheme: string): boolean {
    return isAllowedExternalScheme(scheme);
  }

  private isAllowedExternalUrl(rawUrl: unknown): rawUrl is string {
    return isAllowedExternalUrl(rawUrl);
  }

  private async openLinkExternally(rawUrl: unknown): Promise<void> {
    if (!this.isAllowedExternalUrl(rawUrl)) {
      return;
    }
    const uri = vscode.Uri.parse(rawUrl);
    await vscode.env.openExternal(uri);
  }

  private handleFilterSort(
    globalSearch: unknown,
    columnFilters: unknown,
    sortCol: unknown,
    sortDir: unknown
  ): void {
    this.filterSortState = {
      globalSearch: typeof globalSearch === 'string' ? globalSearch : '',
      columnFilters: normalizeColumnFilters(columnFilters),
      sortCol: typeof sortCol === 'number' ? sortCol : -1,
      sortDir: (sortDir === 'asc' || sortDir === 'desc') ? sortDir : null
    };
    this.sendFilterSortResult();
  }

  private sendFilterSortResult(): void {
    if (!this.currentWebviewPanel) return;

    const config = vscode.workspace.getConfiguration('csv', this.document.uri);
    const separator = this.getSeparator();
    const hiddenRows = this.getHiddenRows();
    const clickableLinks = config.get<boolean>('clickableLinks', true);

    let parsed;
    try {
      parsed = Papa.parse(this.document.getText(), { dynamicTyping: false, delimiter: separator });
    } catch {
      parsed = { data: [] };
    }

    const rawData = this.trimTrailingEmptyRows((parsed.data || []) as string[][]);
    const treatHeader = this.getEffectiveHeader(rawData, hiddenRows);

    const offset = Math.min(Math.max(0, hiddenRows), rawData.length);
    const data = this.applyFilterSort(rawData, offset, treatHeader);
    const columnLabels = this.getColumnLabels(rawData, offset, treatHeader);
    const addSerialIndex = CsvEditorProvider.getSerialIndexForUri(this.context, this.document.uri);
    const showTrailingEmptyRow = config.get<boolean>('showTrailingEmptyRow', true);
    const configuredColumnColorMode = config.get<string>('columnColorMode', 'type');
    const configuredColumnColorPalette = config.get<string>('columnColorPalette', 'default');
    const columnColorMode = CsvEditorController.resolveEffectiveColumnColorMode(
      configuredColumnColorMode,
      this.isDiffContext,
      config.get<boolean>('diffUseThemeForeground', true)
    );
    const isDark = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark;
    const chunkMeta = this.generateTableAndChunks(
      data,
      treatHeader,
      addSerialIndex,
      hiddenRows,
      clickableLinks,
      columnColorMode,
      configuredColumnColorPalette,
      showTrailingEmptyRow,
      0
    );
    this.chunkRenderState = chunkMeta.chunkState;

    const bodyStart = treatHeader ? offset + 1 : offset;
    const bodyRows = data.slice(bodyStart);
    const initialRowCount = this.chunkRenderState
      ? Math.min(this.chunkRenderState.chunkRows, bodyRows.length)
      : bodyRows.length;
    const initialBodyRows = bodyRows.slice(0, initialRowCount);
    const includeTrailingEmptyRow = !this.chunkRenderState && (showTrailingEmptyRow || bodyRows.length === 0);

    const rows: Array<{ cells: Array<{ value: string; rendered: string }>; absRow: number; displayIdx: number }> = [];
    for (let r = 0; r < initialBodyRows.length; r++) {
      const row = initialBodyRows[r];
      const absRow = bodyStart + r;
      const cells = row.map(cell => ({
        value: cell || '',
        rendered: this.formatCellContent(cell || '', clickableLinks)
      }));
      rows.push({ cells, absRow, displayIdx: r + 1 });
    }

    if (includeTrailingEmptyRow) {
      const absRow = bodyStart + initialBodyRows.length;
      const numCols = rawData.reduce((max, r) => Math.max(max, r.length), 0) || 1;
      const cells = Array.from({ length: numCols }, () => ({ value: '', rendered: '' }));
      rows.push({ cells, absRow, displayIdx: initialBodyRows.length + 1 });
    }

    this.currentWebviewPanel.webview.postMessage({
      type: 'filterSortResult',
      rows,
      sortCol: this.filterSortState.sortCol,
      sortDir: this.filterSortState.sortDir,
      addSerialIndex,
      isDark,
      columnLabels,
      columnFilters: this.filterSortState.columnFilters,
      nextChunkStart: chunkMeta.nextChunkStart,
      hasRemoteChunks: chunkMeta.hasRemoteChunks
    });
  }

  private applyFilterSort(data: string[][], offset: number, hasHeader: boolean): string[][] {
    return applyFilterSortToRows(data, offset, hasHeader, this.filterSortState);
  }

  private linkifyUrls(escapedText: string): string {
    return linkifyUrls(escapedText);
  }

  private formatCellContent(text: string, linkify: boolean): string {
    return formatCellContent(text, linkify);
  }

  private getMultilineCellTitleAttr(text: string): string {
    return getMultilineCellTitleAttr(text);
  }

  private escapeCss(text: string): string {
    return escapeCss(text);
  }

  private isDate(value: string): boolean {
    return isDate(value);
  }

  private estimateColumnDataType(column: string[]): string {
    return estimateColumnDataType(column);
  }

  private getColumnColor(type: string, isDark: boolean, columnIndex: number, palette: 'default' | 'cool' | 'warm' = 'default'): string {
    return getColumnColor(type, isDark, columnIndex, palette);
  }

  private hslToHex(h: number, s: number, l: number): string {
    return hslToHex(h, s, l);
  }

  private getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++){
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }

  private trimTrailingEmptyRows(rows: string[][]): string[][] {
    const isEmpty = (r: string[] | undefined) => {
      if (!r || r.length === 0) return true;
      for (let i = 0; i < r.length; i++) {
        if ((r[i] ?? '') !== '') return false;
      }
      return true;
    };
    let end = rows.length;
    while (end > 0 && isEmpty(rows[end - 1])) {
      end--;
    }
    return rows.slice(0, end);
  }
}

// Wrapper provider: one instance registered with VS Code.
export class CsvEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'csv.editor';
  public static editors: CsvEditorController[] = [];
  public static currentActive: CsvEditorController | undefined;
  public static readonly hiddenRowsKey = 'csv.hiddenRows';
  public static readonly headerKey     = 'csv.headerByUri';
  public static readonly serialKey     = 'csv.serialIndexByUri';
  public static readonly sepKey        = 'csv.separatorByUri';
  private static readonly DEFAULT_SEPARATOR = DEFAULT_CSV_SEPARATOR;
  private static readonly DEFAULT_SEPARATOR_MODE: SeparatorMode = DEFAULT_CSV_SEPARATOR_MODE;
  private static readonly BUILTIN_SEPARATORS_BY_EXTENSION: Record<string, string> = BUILTIN_SEPARATORS_BY_EXTENSION;

  private static normalizeExtension(rawExt: string): string {
    return normalizeExtension(rawExt);
  }

  private static normalizeSeparator(rawSep: unknown): string | undefined {
    return normalizeSeparator(rawSep);
  }

  public static getSeparatorSettings(uri: vscode.Uri): SeparatorSettings {
    return getSeparatorSettings(uri);
  }

  public static serializeSeparatorSettings(settings: SeparatorSettings): string {
    return serializeSeparatorSettings(settings);
  }

  public static resolveInheritedSeparator(filePath: string, text: string, settings: SeparatorSettings): string {
    return resolveInheritedSeparator(filePath, text, settings);
  }

  public static applyFieldUpdatesPreservingFormat(
    text: string,
    delimiter: string,
    updates: Array<{ row: number; col: number; value: string }>
  ): string | undefined {
    return applyFieldUpdatesPreservingFormat(text, delimiter, updates);
  }

  constructor(private readonly context: vscode.ExtensionContext) {}

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    console.log(`CSV(reg): creating controller for ${document.uri.toString()}`);
    const controller = new CsvEditorController(this.context);
    // Track active controller
    webviewPanel.onDidChangeViewState(e => {
      if (e.webviewPanel.active) {
        CsvEditorProvider.currentActive = controller;
      }
    });
    await controller.resolveCustomTextEditor(document, webviewPanel, _token);
  }

  public static getActiveProvider(): CsvEditorController | undefined {
    return CsvEditorProvider.currentActive || CsvEditorProvider.editors.find(ed => ed.isActive());
  }

  public static getHiddenRowsForUri(context: vscode.ExtensionContext, uri: vscode.Uri): number {
    const map = context.workspaceState.get<Record<string, number>>(CsvEditorProvider.hiddenRowsKey, {});
    const n = map[uri.toString()] ?? 0;
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }

  public static async setHiddenRowsForUri(context: vscode.ExtensionContext, uri: vscode.Uri, n: number): Promise<void> {
    const map = { ...(context.workspaceState.get<Record<string, number>>(CsvEditorProvider.hiddenRowsKey, {})) };
    if (!Number.isFinite(n) || n <= 0) {
      delete map[uri.toString()];
    } else {
      map[uri.toString()] = Math.floor(n);
    }
    await context.workspaceState.update(CsvEditorProvider.hiddenRowsKey, map);
  }

  public static getHeaderForUri(context: vscode.ExtensionContext, uri: vscode.Uri): boolean {
    const map = context.workspaceState.get<Record<string, boolean>>(CsvEditorProvider.headerKey, {});
    const key = uri.toString();
    if (key in map) return map[key];
    return true;
  }

  public static hasHeaderOverride(context: vscode.ExtensionContext, uri: vscode.Uri): boolean {
    const map = context.workspaceState.get<Record<string, boolean>>(CsvEditorProvider.headerKey, {});
    return uri.toString() in map;
  }

  public static async setHeaderForUri(context: vscode.ExtensionContext, uri: vscode.Uri, val: boolean): Promise<void> {
    const map = context.workspaceState.get<Record<string, boolean>>(CsvEditorProvider.headerKey, {});
    map[uri.toString()] = val;
    await context.workspaceState.update(CsvEditorProvider.headerKey, map);
  }

  public static getSerialIndexForUri(context: vscode.ExtensionContext, uri: vscode.Uri): boolean {
    const map = context.workspaceState.get<Record<string, boolean>>(CsvEditorProvider.serialKey, {});
    return map[uri.toString()] ?? true; // default true
  }

  public static async setSerialIndexForUri(context: vscode.ExtensionContext, uri: vscode.Uri, val: boolean): Promise<void> {
    const map = { ...(context.workspaceState.get<Record<string, boolean>>(CsvEditorProvider.serialKey, {})) };
    map[uri.toString()] = !!val; // always persist explicit override
    await context.workspaceState.update(CsvEditorProvider.serialKey, map);
  }

  public static getSeparatorForUri(context: vscode.ExtensionContext, uri: vscode.Uri): string | undefined {
    const map = context.workspaceState.get<Record<string, string>>(CsvEditorProvider.sepKey, {});
    return map[uri.toString()];
  }

  public static async setSeparatorForUri(context: vscode.ExtensionContext, uri: vscode.Uri, sep: string | undefined): Promise<void> {
    const map = { ...(context.workspaceState.get<Record<string, string>>(CsvEditorProvider.sepKey, {})) };
    if (!sep || sep.length === 0) { delete map[uri.toString()]; } else { map[uri.toString()] = sep; }
    await context.workspaceState.update(CsvEditorProvider.sepKey, map);
  }

  // Test helpers to access internal utilities without VS Code runtime
  public static __test = {
    /**
     * Pure state-machine mirror of the sort-snapshot logic embedded in
     * CsvEditorController.sortColumn / resetSort. Used by unit tests to make
     * sure: (1) the first sort after a non-sort edit captures the snapshot,
     * (2) subsequent sorts reuse the same snapshot, (3) any mutation clears
     * it, and (4) resetSort restores and clears the snapshot.
     */
    sortSnapshotMachine() {
      let snapshot: string | null = null;
      return {
        get snapshot() { return snapshot; },
        onSort(currentText: string) {
          if (snapshot === null) { snapshot = currentText; }
        },
        onMutation() {
          snapshot = null;
        },
        onReset(): { restored: string | null } {
          if (snapshot === null) { return { restored: null }; }
          const restored = snapshot;
          snapshot = null;
          return { restored };
        },
      };
    },
    // Pure helper mirroring sort behavior; returns combined rows after sort.
    sortByColumn(rows: string[][], index: number, ascending: boolean, treatHeader: boolean, hiddenRows: number): string[][] {
      // Trim trailing empty rows like runtime before sorting
      const isEmpty = (r: string[] | undefined) => {
        if (!r || r.length === 0) return true;
        for (let i = 0; i < r.length; i++) { if ((r[i] ?? '') !== '') return false; }
        return true;
      };
      let end = rows.length;
      while (end > 0 && isEmpty(rows[end - 1])) { end--; }
      const trimmed = rows.slice(0, end);

      const offset = Math.min(Math.max(0, hiddenRows), trimmed.length);
      let header: string[] = [];
      let body:   string[][] = [];
      if (treatHeader && offset < trimmed.length) {
        header = trimmed[offset];
        body   = trimmed.slice(offset + 1);
      } else {
        body   = trimmed.slice(offset);
      }
      const isDateStr = (v: string) => {
        const s = (v ?? '').trim();
        if (!s) return false;
        const isoDate = /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
        const isoSlash = /^\d{4}\/\d{2}\/\d{2}$/;
        return isoDate.test(s) || isoSlash.test(s);
      };
      const cmp = (a: string, b: string) => {
        const sa = (a ?? '').trim();
        const sb = (b ?? '').trim();
        const aEmpty = sa === '';
        const bEmpty = sb === '';
        if (aEmpty && bEmpty) return 0;
        if (aEmpty) return 1; // empty sorts last
        if (bEmpty) return -1;
        if (isDateStr(sa) && isDateStr(sb)) {
          const da = Date.parse(sa);
          const db = Date.parse(sb);
          if (!isNaN(da) && !isNaN(db)) return da - db;
        }
        const na = parseFloat(sa), nb = parseFloat(sb);
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        return sa.localeCompare(sb, undefined, { sensitivity: 'base' });
      };
      body.sort((r1, r2) => {
        const diff = cmp(r1[index] ?? '', r2[index] ?? '');
        return ascending ? diff : -diff;
      });
      const prefix = trimmed.slice(0, offset);

      // Apply same sanitation used before unparse in runtime path
      const combined = (treatHeader ? [...prefix, header, ...body] : [...prefix, ...body]).map(r => r.map((v: any) => {
        if (v === undefined || v === null) return '';
        const t = typeof v;
        if (t === 'number') return Number.isNaN(v) ? '' : String(v);
        const s = String(v);
        return s.toLowerCase() === 'nan' ? '' : s;
      }));
      return combined;
    },
    computeColumnWidths(data: string[][]): number[] {
      const c: any = new (CsvEditorController as any)({} as any);
      return c.computeColumnWidths(data);
    },
    normalizeColumnFilters(columnFilters: unknown, maxColumns?: number): Record<string, CsvColumnFilterCondition> {
      return normalizeColumnFilters(columnFilters, maxColumns);
    },
    applyFilterSortToRows(
      data: string[][],
      offset: number,
      hasHeader: boolean,
      filterSortState: CsvFilterSortState
    ): string[][] {
      return applyFilterSortToRows(data, offset, hasHeader, filterSortState);
    },
    reorderIndexOrder(length: number, indices: number[], beforeIndex: number): number[] {
      const c: any = new (CsvEditorController as any)({} as any);
      const n = Number.isFinite(length) ? Math.max(0, Math.trunc(length)) : 0;
      const base = Array.from({ length: n }, (_, i) => i);
      const result = c.reorderByIndices(base, indices, beforeIndex);
      return result.reordered;
    },
    reorderRows(rows: string[][], indices: number[], beforeIndex: number): string[][] {
      const c: any = new (CsvEditorController as any)({} as any);
      const result = c.reorderByIndices(rows, indices, beforeIndex);
      return result.reordered;
    },
    reorderColumns(rows: string[][], indices: number[], beforeIndex: number): string[][] {
      const c: any = new (CsvEditorController as any)({} as any);
      const numColumns = rows.reduce((max, row) => Math.max(max, row.length), 0);
      const sourceOrder = Array.from({ length: numColumns }, (_, i) => i);
      const orderResult = c.reorderByIndices(sourceOrder, indices, beforeIndex);
      return rows.map((row: string[]) => {
        const normalized = Array.from({ length: numColumns }, (_, i) => row[i] ?? '');
        const next = orderResult.reordered.map((colIdx: number) => normalized[colIdx] ?? '');
        while (next.length > 0 && next[next.length - 1] === '') {
          next.pop();
        }
        return next;
      });
    },
    mutateDataForEdit(data: string[][], row: number, col: number, value: string): { data: string[][]; trimmed: boolean; createdRow: boolean; createdCol: boolean } {
      const c: any = new (CsvEditorController as any)({} as any);
      return c.mutateDataForEdit(data, row, col, value);
    },
    isDate(v: string): boolean {
      const c: any = new (CsvEditorController as any)({} as any);
      return c.isDate(v);
    },
    estimateColumnDataType(col: string[]): string {
      const c: any = new (CsvEditorController as any)({} as any);
      return c.estimateColumnDataType(col);
    },
    getColumnColor(t: string, dark: boolean, i: number, palette: 'default' | 'cool' | 'warm' = 'default'): string {
      const c: any = new (CsvEditorController as any)({} as any);
      return c.getColumnColor(t, dark, i, palette);
    },
    resolveEffectiveColumnColorMode(baseMode: string, isDiffContext: boolean, diffUseThemeForeground: boolean): 'type' | 'theme' {
      return (CsvEditorController as any).resolveEffectiveColumnColorMode(baseMode, isDiffContext, diffUseThemeForeground);
    },
    resolveEffectiveFontSize(csvFontSize: unknown, editorFontSize: unknown): number {
      return (CsvEditorController as any).resolveEffectiveFontSize(csvFontSize, editorFontSize);
    },
    hslToHex(h: number, s: number, l: number): string {
      const c: any = new (CsvEditorController as any)({} as any);
      return c.hslToHex(h, s, l);
    },
    formatCellContent(text: string, linkify: boolean): string {
      const c: any = new (CsvEditorController as any)({} as any);
      return c.formatCellContent(text, linkify);
    },
    isAllowedExternalUrl(url: unknown): boolean {
      const c: any = new (CsvEditorController as any)({} as any);
      return c.isAllowedExternalUrl(url);
    },
    shouldPromptForLargeFile(fileSizeBytes: number, maxFileSizeMB: number): boolean {
      const c: any = new (CsvEditorController as any)({} as any);
      return c.shouldPromptForLargeFile(fileSizeBytes, maxFileSizeMB);
    },
    // Expose header heuristic for tests. Allows specifying hiddenRows and
    // optionally an override value through a mock workspaceState.
    getEffectiveHeader(data: string[][], hiddenRows: number, override: undefined | boolean = undefined): boolean {
      const c: any = new (CsvEditorController as any)({} as any);
      // Minimal fake URI and context to satisfy header-override checks
      const fakeUri = { toString: () => 'vscode-test://csv/fixture', fsPath: '/csv/fixture.csv' } as any;
      const state: Record<string, any> = {};
      if (override !== undefined) {
        state[CsvEditorProvider.headerKey] = { [fakeUri.toString()]: override };
      }
      c.context = {
        workspaceState: {
          get: (key: string, def: any) => (key in state ? state[key] : def),
          update: async (key: string, val: any) => { state[key] = val; }
        }
      } as any;
      c.document = { uri: fakeUri } as any;
      return c.getEffectiveHeader(data, hiddenRows);
    },
    // Compute the effective separator used for a given file path with optional override.
    getEffectiveSeparator(
      filePath: string,
      override: string | undefined,
      options?: {
        mode?: SeparatorMode;
        defaultSeparator?: string;
        byExtension?: Record<string, string>;
        text?: string;
      }
    ): string {
      if (override && override.length) {
        return override;
      }
      const mode = options?.mode ?? 'extension';
      const defaultSeparator =
        CsvEditorProvider.normalizeSeparator(options?.defaultSeparator) ?? CsvEditorProvider.DEFAULT_SEPARATOR;
      const byExtension: Record<string, string> = { ...CsvEditorProvider.BUILTIN_SEPARATORS_BY_EXTENSION };
      if (options?.byExtension) {
        for (const [rawExt, rawSep] of Object.entries(options.byExtension)) {
          const ext = CsvEditorProvider.normalizeExtension(rawExt);
          const sep = CsvEditorProvider.normalizeSeparator(rawSep);
          if (!ext || !sep) continue;
          byExtension[ext] = sep;
        }
      }
      const text = options?.text ?? '';
      return CsvEditorProvider.resolveInheritedSeparator(filePath, text, {
        mode,
        defaultSeparator,
        byExtension
      });
    },
    applyFieldUpdatesPreservingFormat(
      text: string,
      delimiter: string,
      updates: Array<{ row: number; col: number; value: string }>
    ): string | undefined {
      return CsvEditorProvider.applyFieldUpdatesPreservingFormat(text, delimiter, updates);
    },
    computePastePlan(
      matrix: string[][],
      anchorRow: number,
      anchorCol: number,
      selection?: { minRow: number; maxRow: number; minCol: number; maxCol: number; rectangular: boolean }
    ): { startRow: number; startCol: number; endRow: number; endCol: number; fillSelection: boolean } | undefined {
      return (CsvEditorController as any).computePastePlan(matrix, anchorRow, anchorCol, selection);
    },
    applyPasteMatrixToData(
      data: string[][],
      matrix: string[][],
      anchorRow: number,
      anchorCol: number,
      selection?: { minRow: number; maxRow: number; minCol: number; maxCol: number; rectangular: boolean }
    ): {
      changed: boolean;
      structuralChange: boolean;
      updates: Array<{ row: number; col: number; value: string }>;
      plan: { startRow: number; startCol: number; endRow: number; endCol: number; fillSelection: boolean };
    } {
      return (CsvEditorController as any).applyPasteMatrixToData(data, matrix, anchorRow, anchorCol, selection);
    },
    // Expose chunking/table generation for large-data tests. Returns parsed chunk count.
    generateTableChunksMeta(
      data: string[][],
      treatHeader: boolean,
      addSerialIndex: boolean,
      hiddenRows: number,
      clickableLinks: boolean = true,
      columnColorMode: 'type' | 'theme' = 'type',
      columnColorPalette: 'default' | 'cool' | 'warm' = 'default',
      showTrailingEmptyRow: boolean = true
    ): { chunkCount: number; hasTable: boolean } {
      const c: any = new (CsvEditorController as any)({} as any);
      const result = c.generateTableAndChunks(
        data,
        treatHeader,
        addSerialIndex,
        hiddenRows,
        clickableLinks,
        columnColorMode,
        columnColorPalette,
        showTrailingEmptyRow
      );
      try {
        const chunks = JSON.parse(result.chunksJson);
        return { chunkCount: Array.isArray(chunks) ? chunks.length : 0, hasTable: typeof result.tableHtml === 'string' && result.tableHtml.includes('<table') };
      } catch {
        return { chunkCount: 0, hasTable: false };
      }
    },
    generateTableAndChunksRaw(
      data: string[][],
      treatHeader: boolean,
      addSerialIndex: boolean,
      hiddenRows: number,
      clickableLinks: boolean = true,
      columnColorMode: 'type' | 'theme' = 'type',
      columnColorPalette: 'default' | 'cool' | 'warm' = 'default',
      showTrailingEmptyRow: boolean = true
    ): { tableHtml: string; chunks: string[] } {
      const c: any = new (CsvEditorController as any)({} as any);
      const result = c.generateTableAndChunks(
        data,
        treatHeader,
        addSerialIndex,
        hiddenRows,
        clickableLinks,
        columnColorMode,
        columnColorPalette,
        showTrailingEmptyRow
      );
      let chunks: string[] = [];
      try { chunks = JSON.parse(result.chunksJson); } catch {}
      return { tableHtml: result.tableHtml, chunks };
    },
    generateRuntimeChunkTransport(
      data: string[][],
      treatHeader: boolean,
      addSerialIndex: boolean,
      hiddenRows: number,
      start: number | undefined = undefined
    ): {
      serializedChunkCount: number;
      nextChunkStart: number;
      hasRemoteChunks: boolean;
      hasChunkState: boolean;
      response?: { html: string; nextStart: number; done: boolean };
    } {
      const c: any = new (CsvEditorController as any)({} as any);
      const result = c.generateTableAndChunks(
        data,
        treatHeader,
        addSerialIndex,
        hiddenRows,
        /* clickableLinks */ true,
        /* columnColorMode */ 'type',
        /* columnColorPalette */ 'default',
        /* showTrailingEmptyRow */ true,
        /* maxSerializedChunks */ 0
      );
      let chunks: string[] = [];
      try { chunks = JSON.parse(result.chunksJson); } catch {}
      const out: {
        serializedChunkCount: number;
        nextChunkStart: number;
        hasRemoteChunks: boolean;
        hasChunkState: boolean;
        response?: { html: string; nextStart: number; done: boolean };
      } = {
        serializedChunkCount: chunks.length,
        nextChunkStart: result.nextChunkStart,
        hasRemoteChunks: result.hasRemoteChunks,
        hasChunkState: !!result.chunkState
      };
      if (typeof start === 'number' && result.chunkState) {
        const response = c.renderChunkFromState(result.chunkState, start);
        out.response = {
          html: response.html,
          nextStart: response.nextStart,
          done: response.done
        };
      }
      return out;
    }
  };
}
