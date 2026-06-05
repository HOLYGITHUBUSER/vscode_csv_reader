/**
 * 005-G3: 公式引擎单元测试
 */
import assert from 'assert';
import { describe, it } from 'node:test';
import { evaluate, parseRef, parseRange, colToLetters, collectRefs, FormulaError } from '../csvFormula';

const grid = (data: string[][]) => (col: number, row: number) => {
  if (row < 0 || row >= data.length) return '';
  if (col < 0 || col >= data[row].length) return '';
  return data[row][col] || '';
};

describe('csvFormula', () => {
  it('parses A1 reference', () => {
    assert.deepStrictEqual(parseRef('A1'), { col: 0, row: 0 });
    assert.deepStrictEqual(parseRef('B2'), { col: 1, row: 1 });
    assert.deepStrictEqual(parseRef('Z9'), { col: 25, row: 8 });
    assert.deepStrictEqual(parseRef('AA10'), { col: 26, row: 9 });
  });

  it('parses range A1:B10', () => {
    const r = parseRange('A1:B3');
    assert.deepStrictEqual(r.from, { col: 0, row: 0 });
    assert.deepStrictEqual(r.to, { col: 1, row: 2 });
  });

  it('converts column index to letters', () => {
    assert.strictEqual(colToLetters(0), 'A');
    assert.strictEqual(colToLetters(25), 'Z');
    assert.strictEqual(colToLetters(26), 'AA');
    assert.strictEqual(colToLetters(27), 'AB');
  });

  it('evaluates number literals', () => {
    const get = grid([]);
    assert.strictEqual(evaluate('42', get), 42);
    assert.strictEqual(evaluate('3.14', get), 3.14);
    assert.strictEqual(evaluate('-5', get), -5);
  });

  it('evaluates arithmetic', () => {
    const get = grid([]);
    assert.strictEqual(evaluate('1+2', get), 3);
    assert.strictEqual(evaluate('10-3', get), 7);
    assert.strictEqual(evaluate('2*3+4', get), 10);
    assert.strictEqual(evaluate('10/2', get), 5);
    assert.strictEqual(evaluate('(1+2)*3', get), 9);
  });

  it('evaluates cell reference A1', () => {
    const get = grid([['42'], ['100']]);
    assert.strictEqual(evaluate('A1', get), 42);
    assert.strictEqual(evaluate('A2', get), 100);
  });

  it('evaluates SUM(A1:A2)', () => {
    const get = grid([['10'], ['20'], ['30']]);
    assert.strictEqual(evaluate('SUM(A1:A3)', get), 60);
  });

  it('evaluates AVG / MIN / MAX / COUNT', () => {
    const get = grid([['10'], ['20'], ['30'], ['40']]);
    assert.strictEqual(evaluate('AVG(A1:A4)', get), 25);
    assert.strictEqual(evaluate('MIN(A1:A4)', get), 10);
    assert.strictEqual(evaluate('MAX(A1:A4)', get), 40);
    assert.strictEqual(evaluate('COUNT(A1:A4)', get), 4);
  });

  it('evaluates SUM of multiple ranges', () => {
    const get = grid([['1'], ['2'], ['3'], ['4']]);
    assert.strictEqual(evaluate('SUM(A1:A2,A3:A4)', get), 10);
  });

  it('detects circular reference (self)', () => {
    const get = grid([['1']]);
    assert.throws(() => evaluate('A1', get, { col: 0, row: 0 }), /Circular/i);
  });

  it('detects circular reference (range includes self)', () => {
    const get = grid([['1'], ['2'], ['3']]);
    assert.throws(() => evaluate('SUM(A1:A3)', get, { col: 0, row: 1 }), /Circular/i);
  });

  it('collects all cell references in an expression', () => {
    const refs = collectRefs('SUM(A1:B2) + C3 * 5');
    assert.strictEqual(refs.length, 3); // A1, B2, C3 (5 不是 ref)
    assert.deepStrictEqual(refs[0], { col: 0, row: 0 });
    assert.deepStrictEqual(refs[2], { col: 2, row: 2 });
  });

  it('throws on invalid reference', () => {
    assert.throws(() => parseRef('123'), FormulaError);
    assert.throws(() => parseRef('A'), FormulaError);
  });

  it('throws on unknown function', () => {
    const get = grid([]);
    assert.throws(() => evaluate('FOO(1)', get), /Unknown function/i);
  });

  it('handles empty cells as 0', () => {
    const get = grid([['5'], [''], ['10']]);
    assert.strictEqual(evaluate('SUM(A1:A3)', get), 15);
  });
});
