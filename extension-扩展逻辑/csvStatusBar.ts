import * as vscode from 'vscode';

/**
 * 003-F4: CSV 专属状态栏组件
 * 显示：行/列数、(R,C)、分隔符、排序、过滤 N/M、⚠️未保存
 */
export class CsvStatusBar {
  private item: vscode.StatusBarItem;
  private dirty = false;
  private rows = 0;
  private cols = 0;
  private selRow = -1;
  private selCol = -1;
  private separator = ',';
  private encoding = 'utf-8';
  private sortLabel = '';
  private filterLabel = '';

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = 'csv.showStatusInfo';
    this.item.tooltip = 'CSV 状态（点击查看详情）';
    this.render();
    this.item.show();
  }

  setStats(rows: number, cols: number): void {
    this.rows = rows;
    this.cols = cols;
    this.render();
  }

  setSelection(row: number, col: number): void {
    this.selRow = row;
    this.selCol = col;
    this.render();
  }

  setSeparator(sep: string): void {
    this.separator = sep;
    this.render();
  }

  setEncoding(enc: string): void {
    this.encoding = enc;
    this.render();
  }

  setSort(col: number | null, asc: boolean): void {
    this.sortLabel = col === null ? '' : `↕ col ${col}${asc ? '↑' : '↓'}`;
    this.render();
  }

  setFilter(matched: number, total: number): void {
    this.filterLabel = matched === total ? '' : `⚙ ${matched}/${total}`;
    this.render();
  }

  setDirty(d: boolean): void {
    this.dirty = d;
    this.render();
  }

  private mode = 'edit';
  setMode(mode: string): void {
    this.mode = mode;
    this.render();
  }

  private render(): void {
    const parts: string[] = [];
    const modeIcon = this.mode === 'browse' ? '👁' : this.mode === 'analyze' ? '📊' : '✏️';
    const modeLabel = this.mode === 'browse' ? '浏览' : this.mode === 'analyze' ? '分析' : '编辑';
    parts.push(`${modeIcon} ${modeLabel}`);
    if (this.dirty) parts.push('⚠ 未保存');
    if (this.sortLabel) parts.push(this.sortLabel);
    if (this.filterLabel) parts.push(this.filterLabel);
    if (this.selRow >= 0) parts.push(`(${this.selRow + 1},${this.selCol + 1})`);
    parts.push(`${this.rows}×${this.cols}`);
    parts.push(`sep:'${this.separator}'`);
    this.item.text = parts.join(' | ');
  }

  dispose(): void {
    this.item.dispose();
  }
}
