import assert from 'assert';
import { describe, it } from 'node:test';
import { computeColumnStats } from '../csvStats';

describe('csvStats', () => {
  it('computes numeric column stats', () => {
    const data = [['10'], ['20'], ['30'], ['40'], ['']];
    const s = computeColumnStats(0, data);
    assert.strictEqual(s.total, 5);
    assert.strictEqual(s.nonEmpty, 4);
    assert.strictEqual(s.missing, 1);
    assert.strictEqual(s.isNumeric, true);
    assert.strictEqual(s.min, 10);
    assert.strictEqual(s.max, 40);
    assert.strictEqual(s.avg, 25);
    assert.strictEqual(s.median, 25);
    assert.strictEqual(s.sum, 100);
    assert.ok(s.stddev! > 0);
  });

  it('computes text column stats with top values', () => {
    const data = [['apple'], ['banana'], ['apple'], ['cherry'], ['banana'], ['banana'], ['']];
    const s = computeColumnStats(0, data);
    assert.strictEqual(s.isNumeric, false);
    assert.strictEqual(s.unique, 3);
    assert.strictEqual(s.topValues![0].value, 'banana');
    assert.strictEqual(s.topValues![0].count, 3);
    assert.strictEqual(s.topValues![1].value, 'apple');
    assert.strictEqual(s.avgLength! > 0, true);
  });

  it('handles empty column', () => {
    const data = [[''], [''], ['']];
    const s = computeColumnStats(0, data);
    assert.strictEqual(s.total, 3);
    assert.strictEqual(s.nonEmpty, 0);
    assert.strictEqual(s.missing, 3);
    assert.strictEqual(s.isNumeric, false);
  });

  it('treats mostly-numeric column as numeric', () => {
    const data = [['1'], ['2'], ['3'], ['4'], ['N/A']];
    const s = computeColumnStats(0, data);
    // 4/5 = 80% numeric → should be numeric
    assert.strictEqual(s.isNumeric, true);
  });
});
