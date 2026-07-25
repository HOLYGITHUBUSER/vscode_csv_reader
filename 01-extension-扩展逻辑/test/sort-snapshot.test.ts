/**
 * Unit test for the sort-snapshot state machine that underpins the "cycle
 * back to original" behaviour of the sort button.
 */
import assert from 'assert';
import { describe, it } from 'node:test';
import Module from 'module';

const originalRequire = Module.prototype.require;
Module.prototype.require = function (id: string) {
  if (id === 'vscode') {
    return {
      window: { activeColorTheme: { kind: 1 } },
      ColorThemeKind: { Dark: 1 },
    } as any;
  }
  return originalRequire.apply(this, arguments as any);
};

import { CsvEditorProvider } from '../CsvEditorProvider';

describe('Sort snapshot (reset-to-original) state machine', () => {
  it('captures snapshot on first sort, reuses it on subsequent sorts', () => {
    const m = CsvEditorProvider.__test.sortSnapshotMachine();
    const original = 'name,age\nBob,25\nAlice,30\n';
    const afterAsc = 'name,age\nAlice,30\nBob,25\n';
    const afterDesc = 'name,age\nBob,25\nAlice,30\n';

    assert.strictEqual(m.snapshot, null);

    m.onSort(original); // first sort → capture
    assert.strictEqual(m.snapshot, original);

    m.onSort(afterAsc); // 2nd sort should NOT overwrite snapshot
    assert.strictEqual(m.snapshot, original, 'snapshot should still be the original');

    m.onSort(afterDesc); // 3rd sort still keeps original
    assert.strictEqual(m.snapshot, original);
  });

  it('resetSort returns and clears the snapshot', () => {
    const m = CsvEditorProvider.__test.sortSnapshotMachine();
    const original = 'col\nfoo\nbar\n';
    m.onSort(original);

    const { restored } = m.onReset();
    assert.strictEqual(restored, original);
    assert.strictEqual(m.snapshot, null, 'snapshot cleared after reset');

    // A second reset without a snapshot is a no-op.
    const { restored: restored2 } = m.onReset();
    assert.strictEqual(restored2, null);
  });

  it('a non-sort mutation invalidates the snapshot', () => {
    const m = CsvEditorProvider.__test.sortSnapshotMachine();
    const original = 'col\na\nb\n';
    m.onSort(original);
    assert.strictEqual(m.snapshot, original);

    m.onMutation(); // e.g. user edits a cell or inserts a row
    assert.strictEqual(m.snapshot, null, 'mutation clears the stale snapshot');

    // Next sort will recapture a fresh baseline (the post-mutation text).
    const afterEdit = 'col\na\nB\n';
    m.onSort(afterEdit);
    assert.strictEqual(m.snapshot, afterEdit);
  });
});
