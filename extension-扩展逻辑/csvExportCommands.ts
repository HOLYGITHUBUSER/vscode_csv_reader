/**
 * 005-G4/G5: 导出命令包装（vscode 端）
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { exportToJson, exportToXlsx } from './csvExport';

export async function exportCurrentViewAsJson(controller: any): Promise<void> {
  const uri = controller.getDocumentUri();
  const data = controller.getCurrentData?.() || controller.lastData || [];
  const columns = controller.getColumnLabels?.() || [];
  const defaultName = path.basename(uri.fsPath, path.extname(uri.fsPath)) + '.json';
  const out = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(path.dirname(uri.fsPath), defaultName)),
    filters: { 'JSON': ['json'] }
  });
  if (!out) return;
  exportToJson(data, columns, out.fsPath);
  vscode.window.showInformationMessage(`CSV: 已导出 ${data.length} 行到 ${out.fsPath}`);
}

export async function exportCurrentViewAsXlsx(controller: any): Promise<void> {
  const uri = controller.getDocumentUri();
  const data = controller.getCurrentData?.() || controller.lastData || [];
  const columns = controller.getColumnLabels?.() || [];
  const defaultName = path.basename(uri.fsPath, path.extname(uri.fsPath)) + '.xlsx';
  const out = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(path.dirname(uri.fsPath), defaultName)),
    filters: { 'Excel': ['xlsx'] }
  });
  if (!out) return;
  exportToXlsx(data, columns, out.fsPath);
  vscode.window.showInformationMessage(`CSV: 已导出 ${data.length} 行到 ${out.fsPath}`);
}
