export type CsvSortDirection = 'asc' | 'desc' | null;
export type CsvColumnFilterMode = 'contains' | 'equals';
export type CsvColumnFilterCondition = {
  value: string;
  mode: CsvColumnFilterMode;
  ignoreCase: boolean;
  ignoreWhitespace: boolean;
};

export type CsvFilterSortState = {
  globalSearch: string;
  columnFilters: Record<string, CsvColumnFilterCondition | string>;
  sortCol: number;
  sortDir: CsvSortDirection;
};

export const createDefaultFilterSortState = (): CsvFilterSortState => ({
  globalSearch: '',
  columnFilters: {},
  sortCol: -1,
  sortDir: null
});

export function normalizeColumnFilters(columnFilters: unknown, maxColumns?: number): Record<string, CsvColumnFilterCondition> {
  if (!columnFilters || typeof columnFilters !== 'object' || Array.isArray(columnFilters)) {
    return {};
  }
  const normalized: Record<string, CsvColumnFilterCondition> = {};
  for (const [rawCol, rawValue] of Object.entries(columnFilters as Record<string, unknown>)) {
    if (!/^\d+$/.test(rawCol)) continue;
    const colIdx = Number(rawCol);
    if (!Number.isSafeInteger(colIdx) || colIdx < 0) continue;
    if (typeof maxColumns === 'number' && colIdx >= maxColumns) continue;
    const condition = normalizeColumnFilterCondition(rawValue);
    if (!condition) continue;
    normalized[String(colIdx)] = condition;
  }
  return normalized;
}

export function normalizeColumnFilterCondition(rawValue: unknown): CsvColumnFilterCondition | undefined {
  if (typeof rawValue === 'string') {
    const value = rawValue.trim();
    if (!value) return undefined;
    return {
      value,
      mode: 'contains',
      ignoreCase: true,
      ignoreWhitespace: false
    };
  }
  if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
    return undefined;
  }
  const raw = rawValue as Record<string, unknown>;
  if (typeof raw.value !== 'string') return undefined;
  const value = raw.value.trim();
  if (!value) return undefined;
  return {
    value,
    mode: raw.mode === 'equals' ? 'equals' : 'contains',
    ignoreCase: raw.ignoreCase !== false,
    ignoreWhitespace: raw.ignoreWhitespace === true
  };
}

function normalizeComparableValue(value: string, condition: CsvColumnFilterCondition): string {
  let next = value;
  if (condition.ignoreWhitespace) {
    next = next.replace(/\s+/g, '');
  }
  if (condition.ignoreCase) {
    next = next.toLowerCase();
  }
  return next;
}

function matchesColumnFilter(cellValue: string, condition: CsvColumnFilterCondition): boolean {
  const haystack = normalizeComparableValue(cellValue || '', condition);
  const needle = normalizeComparableValue(condition.value, condition);
  return condition.mode === 'equals'
    ? haystack === needle
    : haystack.includes(needle);
}

export function applyFilterSortToRows(
  data: string[][],
  offset: number,
  hasHeader: boolean,
  filterSortState: CsvFilterSortState
): string[][] {
  const maxColumns = data.reduce((max, row) => Math.max(max, row.length), 0);
  const fs = {
    ...filterSortState,
    columnFilters: normalizeColumnFilters(filterSortState.columnFilters, maxColumns)
  };
  const noFilter = !fs.globalSearch && Object.values(fs.columnFilters).every(v => !v.value);
  const noSort = fs.sortCol < 0 || !fs.sortDir;
  if (noFilter && noSort) return data;

  const bodyStart = hasHeader ? offset + 1 : offset;
  const headerSlice = hasHeader ? data.slice(offset, offset + 1) : [];
  let body = data.slice(bodyStart);

  if (fs.globalSearch) {
    const q = fs.globalSearch.toLowerCase();
    body = body.filter(row => row.some(cell => (cell || '').toLowerCase().includes(q)));
  }
  for (const [colStr, condition] of Object.entries(fs.columnFilters)) {
    const colIdx = parseInt(colStr, 10);
    body = body.filter(row => matchesColumnFilter(row[colIdx] || '', condition));
  }

  if (!noSort) {
    const colIdx = fs.sortCol;
    const dir = fs.sortDir;
    body.sort((a, b) => {
      const valA = a[colIdx] || '';
      const valB = b[colIdx] || '';
      const cmp = valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' });
      return dir === 'asc' ? cmp : -cmp;
    });
  }

  return [...data.slice(0, offset), ...headerSlice, ...body];
}
