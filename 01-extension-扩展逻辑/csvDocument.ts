import * as vscode from 'vscode';

interface CsvSnapshot {
  before: string;
  after: string;
  label: string;
  version: number;
}

const TEXT_THRESHOLD_FOR_TRIM = 10 * 1024 * 1024;
const MAX_HISTORY_SMALL = 50;
const MAX_HISTORY_LARGE = 5;

export class CsvDocument implements vscode.CustomDocument {
  public static async create(uri: vscode.Uri, encoding = 'utf-8'): Promise<CsvDocument> {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const decoder = new TextDecoder(encoding);
    const text = decoder.decode(bytes);
    return new CsvDocument(uri, text, encoding);
  }

  private _text: string;
  private _isDirty = false;
  private _version = 0;
  private readonly _undoStack: CsvSnapshot[] = [];
  private readonly _redoStack: CsvSnapshot[] = [];
  private readonly _onDidChange = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<CsvDocument>>();
  private readonly _onDidChangeContent = new vscode.EventEmitter<{ source: 'replace' | 'undo' | 'redo' | 'revert' }>();
  private readonly _onDidDispose = new vscode.EventEmitter<void>();

  public readonly onDidChange = this._onDidChange.event;
  public readonly onDidChangeContent = this._onDidChangeContent.event;
  public readonly onDidDispose = this._onDidDispose.event;

  private constructor(
    private readonly _uri: vscode.Uri,
    initialText: string,
    private _encoding: string
  ) {
    this._text = initialText;
  }

  public get uri(): vscode.Uri { return this._uri; }
  public get text(): string { return this._text; }
  public get isDirty(): boolean { return this._isDirty; }
  public get version(): number { return this._version; }
  public get encoding(): string { return this._encoding; }

  public get lineCount(): number {
    if (!this._text) return 0;
    let n = 1;
    for (let i = 0; i < this._text.length; i++) {
      if (this._text.charCodeAt(i) === 10) n++;
    }
    return n;
  }

  public replaceAll(newText: string, label: string): boolean {
    if (newText === this._text) return false;
    const before = this._text;
    this._text = newText;
    this._version++;
    this._isDirty = true;

    const snapshot: CsvSnapshot = { before, after: newText, label, version: this._version };
    this._undoStack.push(snapshot);
    this._redoStack.length = 0;
    this.trimHistory();

    this._onDidChange.fire({
      document: this,
      label,
      undo: async () => { await this.applySnapshot(snapshot.before, 'undo'); },
      redo: async () => { await this.applySnapshot(snapshot.after, 'redo'); }
    });
    this._onDidChangeContent.fire({ source: 'replace' });
    return true;
  }

  public async save(targetUri: vscode.Uri = this._uri): Promise<void> {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(this._text);
    await vscode.workspace.fs.writeFile(targetUri, bytes);
    if (targetUri.toString() === this._uri.toString()) {
      this._isDirty = false;
    }
  }

  public async revert(): Promise<void> {
    const bytes = await vscode.workspace.fs.readFile(this._uri);
    const text = new TextDecoder(this._encoding).decode(bytes);
    this._text = text;
    this._version++;
    this._isDirty = false;
    this._undoStack.length = 0;
    this._redoStack.length = 0;
    this._onDidChangeContent.fire({ source: 'revert' });
  }

  public async setEncoding(encoding: string): Promise<void> {
    if (encoding === this._encoding) return;
    this._encoding = encoding;
    await this.revert();
  }

  public dispose(): void {
    this._onDidChange.dispose();
    this._onDidChangeContent.dispose();
    this._onDidDispose.fire();
    this._onDidDispose.dispose();
  }

  private async applySnapshot(targetText: string, source: 'undo' | 'redo'): Promise<void> {
    if (this._text === targetText) {
      this._onDidChangeContent.fire({ source });
      return;
    }
    this._text = targetText;
    this._version++;
    this._isDirty = true;
    this._onDidChangeContent.fire({ source });
  }

  private trimHistory(): void {
    const limit = this._text.length > TEXT_THRESHOLD_FOR_TRIM ? MAX_HISTORY_LARGE : MAX_HISTORY_SMALL;
    while (this._undoStack.length > limit) {
      this._undoStack.shift();
    }
  }
}
