/**
 * 005-G4/G5: 导出测试
 */
import assert from 'assert';
import { describe, it } from 'node:test';
import { exportToJson, exportToXlsx } from '../csvExport';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('csvExport', () => {
  it('exports to JSON as array of objects', () => {
    const tmp = path.join(os.tmpdir(), `csv-export-${Date.now()}.json`);
    try {
      exportToJson([['Alice', '30'], ['Bob', '25']], ['name', 'age'], tmp);
      const text = fs.readFileSync(tmp, 'utf-8');
      const records = JSON.parse(text);
      assert.strictEqual(records.length, 2);
      assert.deepStrictEqual(records[0], { name: 'Alice', age: '30' });
      assert.deepStrictEqual(records[1], { name: 'Bob',   age: '25' });
    } finally {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
  });

  it('exports to JSON handles nulls', () => {
    const tmp = path.join(os.tmpdir(), `csv-export-null-${Date.now()}.json`);
    try {
      exportToJson([[null, 'x'], ['y', '']], ['a', 'b'], tmp);
      const records = JSON.parse(fs.readFileSync(tmp, 'utf-8'));
      assert.strictEqual(records[0].a, null);
      assert.strictEqual(records[1].b, '');
    } finally {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
  });

  it('exports to XLSX (Excel 2003 XML)', () => {
    const tmp = path.join(os.tmpdir(), `csv-export-${Date.now()}.xlsx`);
    try {
      exportToXlsx([['Alice', 30], ['Bob', 25]], ['name', 'age'], tmp);
      const text = fs.readFileSync(tmp, 'utf-8');
      assert.ok(text.startsWith('<?xml'), 'starts with XML declaration');
      assert.ok(text.includes('Worksheet'), 'has Worksheet element');
      assert.ok(text.includes('<Data ss:Type="String">Alice</Data>'), 'has Alice as string');
      assert.ok(text.includes('<Data ss:Type="Number">30</Data>'), 'has 30 as number');
      assert.ok(text.includes('Bold="1"'), 'header is bold');
    } finally {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
  });

  it('XLSX escapes XML special chars', () => {
    const tmp = path.join(os.tmpdir(), `csv-export-esc-${Date.now()}.xlsx`);
    try {
      exportToXlsx([['<script>'], ['a & b']], ['col'], tmp);
      const text = fs.readFileSync(tmp, 'utf-8');
      assert.ok(text.includes('&lt;script&gt;'), 'escapes < >');
      assert.ok(text.includes('a &amp; b'), 'escapes &');
    } finally {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
  });
});
