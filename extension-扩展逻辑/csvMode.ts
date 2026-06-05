/**
 * 005-G1: CSV 编辑器模式（看 / 改 / 分析）
 * - browse  ：只读，编辑失效
 * - edit   ：可改（默认）
 * - analyze：编辑失效 + 侧栏统计
 */
import * as vscode from 'vscode';

export type CsvMode = 'browse' | 'edit' | 'analyze';

export const DEFAULT_MODE: CsvMode = 'edit';
export const MODE_KEY = 'csv.modeByUri';

const MODES: CsvMode[] = ['browse', 'edit', 'analyze'];

export function getModeForUri(context: vscode.ExtensionContext, uri: vscode.Uri): CsvMode {
  const map = context.workspaceState.get<Record<string, CsvMode>>(MODE_KEY, {});
  const v = map[uri.toString()];
  return v || DEFAULT_MODE;
}

export async function setModeForUri(context: vscode.ExtensionContext, uri: vscode.Uri, mode: CsvMode): Promise<void> {
  const map = { ...(context.workspaceState.get<Record<string, CsvMode>>(MODE_KEY, {})) };
  map[uri.toString()] = mode;
  await context.workspaceState.update(MODE_KEY, map);
}

export function nextMode(current: CsvMode): CsvMode {
  const i = MODES.indexOf(current);
  return MODES[(i + 1) % MODES.length];
}

export function modeLabel(mode: CsvMode): string {
  switch (mode) {
    case 'browse':  return '👁 浏览';
    case 'edit':    return '✏️ 编辑';
    case 'analyze': return '📊 分析';
  }
}

export function modeIcon(mode: CsvMode): string {
  switch (mode) {
    case 'browse':  return '$(eye)';
    case 'edit':    return '$(edit)';
    case 'analyze': return '$(graph)';
  }
}
