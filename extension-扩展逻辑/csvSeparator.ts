import * as path from 'path';
import * as vscode from 'vscode';
import { SeparatorMode, SeparatorSettings } from './csvTypes';

export const DEFAULT_SEPARATOR = ',';
export const DEFAULT_SEPARATOR_MODE: SeparatorMode = 'extension';
export const BUILTIN_SEPARATORS_BY_EXTENSION: Record<string, string> = {
  '.csv': ',',
  '.tsv': '\t',
  '.tab': '\t',
  '.psv': '|'
};
const AUTO_SEPARATOR_CANDIDATES = [',', ';', '\t', '|'];

export function normalizeExtension(rawExt: string): string {
  const trimmed = (rawExt ?? '').trim().toLowerCase();
  if (!trimmed) return '';
  return trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
}

export function normalizeSeparator(rawSep: unknown): string | undefined {
  if (typeof rawSep !== 'string') return undefined;
  if (rawSep.length === 0) return undefined;
  if (rawSep === '\\t') return '\t';
  return rawSep;
}

export function getSeparatorSettings(uri: vscode.Uri): SeparatorSettings {
  const fallback: SeparatorSettings = {
    mode: DEFAULT_SEPARATOR_MODE,
    defaultSeparator: DEFAULT_SEPARATOR,
    byExtension: { ...BUILTIN_SEPARATORS_BY_EXTENSION }
  };

  const workspaceAny = (vscode as any).workspace;
  if (!workspaceAny || typeof workspaceAny.getConfiguration !== 'function') {
    return fallback;
  }

  const cfg = workspaceAny.getConfiguration('csv', uri) as vscode.WorkspaceConfiguration;
  const rawMode = cfg.get<string>('separatorMode', DEFAULT_SEPARATOR_MODE);
  const mode: SeparatorMode =
    rawMode === 'auto' || rawMode === 'default' || rawMode === 'extension'
      ? rawMode
      : DEFAULT_SEPARATOR_MODE;

  const defaultSeparator =
    normalizeSeparator(cfg.get<string>('defaultSeparator', DEFAULT_SEPARATOR)) ??
    DEFAULT_SEPARATOR;

  const byExtension: Record<string, string> = {
    ...BUILTIN_SEPARATORS_BY_EXTENSION
  };
  const rawMap = cfg.get<Record<string, unknown>>('separatorByExtension', {});
  if (rawMap && typeof rawMap === 'object') {
    for (const [rawExt, rawSep] of Object.entries(rawMap)) {
      const ext = normalizeExtension(rawExt);
      const sep = normalizeSeparator(rawSep);
      if (!ext || !sep) continue;
      byExtension[ext] = sep;
    }
  }

  return { mode, defaultSeparator, byExtension };
}

export function serializeSeparatorSettings(settings: SeparatorSettings): string {
  const sortedMapEntries = Object.entries(settings.byExtension)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ext, sep]) => `${ext}:${sep}`)
    .join('|');
  return `${settings.mode}::${settings.defaultSeparator}::${sortedMapEntries}`;
}

export function resolveSeparatorFromExtension(filePath: string, settings: SeparatorSettings): string {
  const ext = normalizeExtension(path.extname((filePath ?? '').toLowerCase()));
  if (!ext) return settings.defaultSeparator;
  return settings.byExtension[ext] ?? settings.defaultSeparator;
}

export function countDelimiterOutsideQuotes(line: string, delimiter: string): number {
  if (!delimiter) return 0;
  let inQuotes = false;
  let count = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && line.startsWith(delimiter, i)) {
      count++;
      i += delimiter.length - 1;
    }
  }
  return count;
}

export function detectSeparatorFromText(text: string, candidates: string[]): string | undefined {
  if (!text) return undefined;
  const sampleText = text.length > 300000 ? text.slice(0, 300000) : text;
  const allLines = sampleText.split(/\r\n|\n|\r/);
  const lines: string[] = [];
  for (const line of allLines) {
    if (line.trim().length === 0) continue;
    lines.push(line);
    if (lines.length >= 200) break;
  }
  if (lines.length === 0) return undefined;

  const minRowsWithDelimiter = lines.length === 1 ? 1 : 2;
  let best:
    | {
        separator: string;
        rowsWithDelimiter: number;
        consistency: number;
        avgDelimiterCount: number;
        score: number;
      }
    | undefined;

  for (const separator of candidates) {
    if (!separator) continue;
    const counts = lines.map(line => countDelimiterOutsideQuotes(line, separator));
    const withDelimiter = counts.filter(count => count > 0);
    if (withDelimiter.length < minRowsWithDelimiter) continue;

    const frequencies = new Map<number, number>();
    for (const count of withDelimiter) {
      frequencies.set(count, (frequencies.get(count) ?? 0) + 1);
    }
    let modeRowCount = 0;
    for (const freq of frequencies.values()) {
      if (freq > modeRowCount) modeRowCount = freq;
    }

    const consistency = withDelimiter.length > 0 ? modeRowCount / withDelimiter.length : 0;
    const avgDelimiterCount = withDelimiter.reduce((sum, count) => sum + count, 0) / withDelimiter.length;
    const firstLineBonus = (counts[0] ?? 0) > 0 ? 25 : -25;
    const score = withDelimiter.length * 10 + consistency * 100 + avgDelimiterCount + firstLineBonus;
    const candidate = { separator, rowsWithDelimiter: withDelimiter.length, consistency, avgDelimiterCount, score };

    if (!best || candidate.score > best.score) {
      best = candidate;
      continue;
    }
    if (candidate.score === best.score && candidate.rowsWithDelimiter > best.rowsWithDelimiter) {
      best = candidate;
    }
  }

  return best?.separator;
}

export function resolveInheritedSeparator(filePath: string, text: string, settings: SeparatorSettings): string {
  const extensionSeparator = resolveSeparatorFromExtension(filePath, settings);
  if (settings.mode === 'default') {
    return settings.defaultSeparator;
  }
  if (settings.mode === 'auto') {
    const candidates: string[] = [];
    const seen = new Set<string>();
    const push = (value: string | undefined) => {
      if (!value || seen.has(value)) return;
      seen.add(value);
      candidates.push(value);
    };
    push(extensionSeparator);
    push(settings.defaultSeparator);
    AUTO_SEPARATOR_CANDIDATES.forEach(push);
    Object.values(settings.byExtension).forEach(push);
    return detectSeparatorFromText(text, candidates) ?? extensionSeparator;
  }
  return extensionSeparator;
}
