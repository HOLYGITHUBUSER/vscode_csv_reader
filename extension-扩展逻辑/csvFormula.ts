/**
 * 005-G3: mini 公式引擎
 * 语法子集：+ - * / 括号 + 函数 SUM/AVG/MIN/MAX/COUNT + 单元格引用 A1 + 范围 A1:B10
 * 实现：递归下降 + shunting-yard 简化版
 */
export type CellRef = { col: number; row: number };
export type RangeRef = { from: CellRef; to: CellRef };
export type FormulaValue = number | string | boolean | null | number[];

export class FormulaError extends Error {
  constructor(msg: string) { super(msg); this.name = 'FormulaError'; }
}

export function parseRef(ref: string): CellRef {
  const m = ref.match(/^\$?([A-Z]+)\$?(\d+)$/);
  if (!m) throw new FormulaError(`Invalid cell reference: ${ref}`);
  return { col: lettersToCol(m[1]), row: parseInt(m[2], 10) - 1 };
}

export function parseRange(rng: string): RangeRef {
  const parts = rng.split(':');
  if (parts.length !== 2) throw new FormulaError(`Invalid range: ${rng}`);
  return { from: parseRef(parts[0]), to: parseRef(parts[1]) };
}

export function lettersToCol(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function colToLetters(col: number): string {
  let n = col + 1, s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

export function collectRefs(expr: string): CellRef[] {
  const refs: CellRef[] = [];
  const re = /[A-Z]+\d+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr))) {
    try { refs.push(parseRef(m[0])); } catch { /* skip */ }
  }
  return refs;
}

/** 主入口：评估去掉 = 的表达式 */
export function evaluate(
  expr: string,
  getCell: (col: number, row: number) => string,
  selfRef?: CellRef,
  visited: Set<string> = new Set()
): FormulaValue {
  const trimmed = expr.trim();
  if (!trimmed) return null;

  // 数字
  if (/^-?\d+(\.\d+)?$/.test(trimmed) || /^\.\d+$/.test(trimmed)) return parseFloat(trimmed);
  // 一元 +/-
  if (trimmed.startsWith('-')) {
    const v = evaluate(trimmed.slice(1), getCell, selfRef, visited);
    return typeof v === 'number' ? -v : 0;
  }
  if (trimmed.startsWith('+')) return evaluate(trimmed.slice(1), getCell, selfRef, visited);

  // 字符串
  if (/^".*"$/.test(trimmed) || /^'.*'$/.test(trimmed)) return trimmed.slice(1, -1);

  // 函数 NAME(args)
  const funcMatch = trimmed.match(/^([A-Z][A-Z0-9]*)\((.*)\)$/s);
  if (funcMatch) {
    const fn = funcMatch[1];
    const argsStr = funcMatch[2];
    // 检查是否整个 trimmed 被这一对 () 包住
    let depth = 0, balanced = true, foundMatch = -1;
    for (let i = 0; i < trimmed.length; i++) {
      if (trimmed[i] === '(') { depth++; if (depth === 1 && i !== fn.length) { balanced = false; break; } }
      else if (trimmed[i] === ')') { depth--; if (depth === 0) { foundMatch = i; break; } }
    }
    if (balanced && foundMatch === trimmed.length - 1) {
      const args = splitArgs(argsStr);
      if (['SUM','AVG','MIN','MAX','COUNT'].includes(fn)) {
        const values: number[] = [];
        for (const arg of args) {
          const a = arg.trim();
          if (!a) continue;
          if (a.includes(':')) {
            values.push(...collectRange(a, getCell, selfRef, visited));
          } else {
            const v = evaluate(a, getCell, selfRef, visited);
            if (typeof v === 'number' && !Number.isNaN(v)) values.push(v);
            else if (Array.isArray(v)) values.push(...v);
          }
        }
        switch (fn) {
          case 'SUM':   return values.reduce((a, b) => a + b, 0);
          case 'AVG':   return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
          case 'MIN':   return values.length ? Math.min(...values) : 0;
          case 'MAX':   return values.length ? Math.max(...values) : 0;
          case 'COUNT': return values.length;
        }
      }
      throw new FormulaError(`Unknown function: ${fn}`);
    }
  }

  // 范围 A1:B10
  if (/^[A-Z]+\d+:[A-Z]+\d+$/.test(trimmed)) {
    return collectRange(trimmed, getCell, selfRef, visited);
  }

  // 单元格引用 A1
  if (/^[A-Z]+\d+$/.test(trimmed)) {
    const ref = parseRef(trimmed);
    if (selfRef && ref.col === selfRef.col && ref.row === selfRef.row) {
      throw new FormulaError('Circular: cell references itself');
    }
    const key = `${ref.col},${ref.row}`;
    if (visited.has(key)) throw new FormulaError(`Circular reference detected`);
    visited.add(key);
    const raw = getCell(ref.col, ref.row);
    const n = parseFloat(raw);
    return Number.isNaN(n) ? 0 : n;
  }

  // 括号
  if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
    // 验证括号匹配
    let depth = 0, valid = true;
    for (let i = 0; i < trimmed.length; i++) {
      if (trimmed[i] === '(') depth++;
      else if (trimmed[i] === ')') { depth--; if (depth === 0 && i !== trimmed.length - 1) { valid = false; break; } }
    }
    if (valid) return evaluate(trimmed.slice(1, -1), getCell, selfRef, visited);
  }

  // 二元算术：用 shunting-yard 简化版（运算符 + - * /）
  return evalBinary(trimmed, getCell, selfRef, visited);
}

function evalBinary(
  expr: string,
  getCell: (col: number, row: number) => string,
  selfRef: CellRef | undefined,
  visited: Set<string>
): FormulaValue {
  // tokenize
  const tokens: (string | number)[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (ch === ' ' || ch === '\t') { i++; continue; }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      // 一元 +/- 跳过（上面已处理）
      tokens.push(ch);
      i++;
    } else if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < expr.length && /[0-9.]/.test(expr[j])) j++;
      tokens.push(parseFloat(expr.slice(i, j)));
      i = j;
    } else if (/[A-Z]/.test(ch)) {
      let j = i;
      while (j < expr.length && /[A-Z0-9:]/.test(expr[j])) j++;
      tokens.push(expr.slice(i, j));
      i = j;
    } else if (ch === '(' || ch === ')') {
      tokens.push(ch);
      i++;
    } else {
      throw new FormulaError(`Unexpected char: ${ch}`);
    }
  }
  // shunting-yard 转 RPN
  const prec: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };
  const out: (string | number)[] = [];
  const ops: string[] = [];
  for (const t of tokens) {
    if (typeof t === 'number') { out.push(t); }
    else if (t === '(') { ops.push(t); }
    else if (t === ')') {
      while (ops.length && ops[ops.length - 1] !== '(') out.push(ops.pop()!);
      ops.pop(); // (
    } else if (t in prec) {
      while (ops.length && ops[ops.length - 1] !== '(' && prec[ops[ops.length - 1]] >= prec[t as string]) {
        out.push(ops.pop()!);
      }
      ops.push(t);
    } else {
      // 单元格/范围 token：作为值
      out.push(t);
    }
  }
  while (ops.length) out.push(ops.pop()!);
  // 评估 RPN
  const stack: FormulaValue[] = [];
  for (const t of out) {
    if (typeof t === 'number') { stack.push(t); continue; }
    if (typeof t === 'string' && t in prec) {
      const b = Number(stack.pop() || 0);
      const a = Number(stack.pop() || 0);
      let r = 0;
      if (t === '+') r = a + b;
      else if (t === '-') r = a - b;
      else if (t === '*') r = a * b;
      else if (t === '/') r = b === 0 ? 0 : a / b;
      stack.push(r);
    } else if (typeof t === 'string') {
      // 单元格或范围
      if (t.includes(':')) {
        stack.push(collectRange(t, getCell, selfRef, visited));
      } else {
        const v = evaluate(t, getCell, selfRef, visited);
        stack.push(v);
      }
    }
  }
  return stack[0] ?? 0;
}

function collectRange(
  rng: string,
  getCell: (c: number, r: number) => string,
  selfRef: CellRef | undefined,
  visited: Set<string>
): number[] {
  const r = parseRange(rng);
  const out: number[] = [];
  for (let row = Math.min(r.from.row, r.to.row); row <= Math.max(r.from.row, r.to.row); row++) {
    for (let col = Math.min(r.from.col, r.to.col); col <= Math.max(r.from.col, r.to.col); col++) {
      if (selfRef && col === selfRef.col && row === selfRef.row) {
        throw new FormulaError('Circular: range includes self');
      }
      const key = `${col},${row}`;
      if (visited.has(key)) throw new FormulaError('Circular reference detected');
      visited.add(key);
      const raw = getCell(col, row);
      const n = parseFloat(raw);
      if (!Number.isNaN(n)) out.push(n);
    }
  }
  return out;
}

function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}
