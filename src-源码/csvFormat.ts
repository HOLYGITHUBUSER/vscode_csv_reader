import { CsvFieldSpan } from './csvTypes';

export function parseCsvFieldSpans(text: string, delimiter: string, defaultSeparator = ','): CsvFieldSpan[][] {
  const sep = delimiter && delimiter.length ? delimiter : defaultSeparator;
  const rows: CsvFieldSpan[][] = [];
  let row: CsvFieldSpan[] = [];
  let fieldStart = 0;
  let i = 0;
  let inQuotes = false;
  let quoted = false;

  const pushField = (end: number) => {
    row.push({ start: fieldStart, end, quoted });
    quoted = false;
  };
  const pushRow = () => {
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    if (!inQuotes) {
      if (text.startsWith(sep, i)) {
        pushField(i);
        i += sep.length;
        fieldStart = i;
        continue;
      }
      const ch = text[i];
      if (ch === '"' && i === fieldStart) {
        inQuotes = true;
        quoted = true;
        i++;
        continue;
      }
      if (ch === '\r' || ch === '\n') {
        pushField(i);
        pushRow();
        if (ch === '\r' && i + 1 < text.length && text[i + 1] === '\n') {
          i += 2;
        } else {
          i++;
        }
        fieldStart = i;
        continue;
      }
      i++;
      continue;
    }

    if (text[i] === '"') {
      if (i + 1 < text.length && text[i + 1] === '"') {
        i += 2;
        continue;
      }
      inQuotes = false;
      i++;
      continue;
    }
    i++;
  }

  pushField(text.length);
  pushRow();
  return rows;
}

export function encodeCsvField(value: string, delimiter: string, preferQuoted: boolean): string {
  const mustQuote =
    preferQuoted ||
    value.includes('"') ||
    value.includes('\n') ||
    value.includes('\r') ||
    (!!delimiter && value.includes(delimiter));
  if (!mustQuote) {
    return value;
  }
  const escaped = value.replace(/"/g, '""');
  return `"${escaped}"`;
}

export function applyFieldUpdatesPreservingFormat(
  text: string,
  delimiter: string,
  updates: Array<{ row: number; col: number; value: string }>
): string | undefined {
  if (!Array.isArray(updates) || updates.length === 0) {
    return text;
  }

  const deduped = new Map<string, { row: number; col: number; value: string }>();
  for (const update of updates) {
    if (!Number.isInteger(update.row) || update.row < 0 || !Number.isInteger(update.col) || update.col < 0) {
      continue;
    }
    deduped.set(`${update.row}:${update.col}`, update);
  }
  if (deduped.size === 0) {
    return text;
  }

  const spans = parseCsvFieldSpans(text, delimiter);
  const edits: Array<{ start: number; end: number; replacement: string }> = [];

  for (const update of deduped.values()) {
    const span = spans[update.row]?.[update.col];
    if (!span) {
      return undefined;
    }
    const replacement = encodeCsvField(update.value, delimiter, span.quoted);
    if (text.slice(span.start, span.end) !== replacement) {
      edits.push({ start: span.start, end: span.end, replacement });
    }
  }

  if (edits.length === 0) {
    return text;
  }

  edits.sort((a, b) => b.start - a.start);
  let output = text;
  for (const edit of edits) {
    output = output.slice(0, edit.start) + edit.replacement + output.slice(edit.end);
  }
  return output;
}
