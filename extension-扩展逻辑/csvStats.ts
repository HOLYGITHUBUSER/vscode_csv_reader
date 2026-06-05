/**
 * 005-G2: 列统计（纯函数）
 * - 文本/数值自动判断
 * - 数值列：count, missing, min, max, avg, median, sum, stddev
 * - 文本列：count, missing, unique, top3
 */
export type ColumnStats = {
  col: number;
  total: number;
  nonEmpty: number;
  missing: number;
  unique: number;
  // 数值
  isNumeric: boolean;
  min?: number;
  max?: number;
  avg?: number;
  median?: number;
  sum?: number;
  stddev?: number;
  // 文本
  topValues?: Array<{ value: string; count: number }>;
  avgLength?: number;
};

export function computeColumnStats(col: number, data: string[][]): ColumnStats {
  const values: string[] = [];
  for (const row of data) {
    const v = row[col];
    values.push(v === undefined || v === null ? '' : String(v));
  }
  const total = values.length;
  const nonEmpty = values.filter(v => v !== '').length;
  const missing = total - nonEmpty;

  const uniqueSet = new Set(values.filter(v => v !== ''));
  const unique = uniqueSet.size;

  // 数值判断：≥80% 非空可解析为数字
  const numericValues: number[] = [];
  let numericCount = 0;
  for (const v of values) {
    if (v === '') continue;
    const n = parseFloat(v);
    if (!Number.isNaN(n) && /^-?\d+(\.\d+)?$/.test(v)) {
      numericValues.push(n);
      numericCount++;
    }
  }
  const isNumeric = nonEmpty > 0 && numericCount / nonEmpty >= 0.8;

  if (isNumeric) {
    const sum = numericValues.reduce((a, b) => a + b, 0);
    const avg = sum / numericValues.length;
    const min = Math.min(...numericValues);
    const max = Math.max(...numericValues);
    const sorted = [...numericValues].sort((a, b) => a - b);
    const median = sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];
    const variance = numericValues.reduce((acc, v) => acc + (v - avg) ** 2, 0) / numericValues.length;
    const stddev = Math.sqrt(variance);
    return { col, total, nonEmpty, missing, unique, isNumeric: true, min, max, avg, median, sum, stddev };
  }

  // 文本统计
  const counts = new Map<string, number>();
  let totalLen = 0;
  for (const v of values) {
    if (v === '') continue;
    totalLen += v.length;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  const topValues = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([value, count]) => ({ value, count }));
  const avgLength = nonEmpty > 0 ? totalLen / nonEmpty : 0;
  return { col, total, nonEmpty, missing, unique, isNumeric: false, topValues, avgLength };
}
