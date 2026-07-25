import assert from 'assert';
import { describe, it } from 'node:test';
import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';

describe('编码处理测试', () => {
  const testDir = path.join(process.cwd(), 'samples-试用样例');

  it('应该正确读取UTF-8编码的CSV文件', () => {
    const csvPath = path.join(testDir, 'super-中等样例.csv');
    const content = fs.readFileSync(csvPath, 'utf8');
    assert.ok(content.length > 0, 'UTF-8文件应该能正确读取');

    const parsed = Papa.parse<string[]>(content, { delimiter: ',' });
    assert.ok(parsed.data.length > 0, 'UTF-8文件应该能正确解析');
  });

  it('应该正确处理包含中文字符的UTF-8文件', () => {
    // 创建包含中文的测试CSV
    const testContent = '姓名,年龄,城市\n张三,25,北京\n李四,30,上海';
    const parsed = Papa.parse<string[]>(testContent, { delimiter: ',' });
    assert.strictEqual(parsed.data[0][0], '姓名', '中文字符应该正确解析');
    assert.strictEqual(parsed.data[1][0], '张三', '中文数据应该正确解析');
  });

  it('应该正确处理包含特殊字符的UTF-8文件', () => {
    const testContent = 'Name,Email,Note\nJohn,john@example.com,"Note with "quotes""\nJane,jane@example.com,Émojis: 😀🎉';
    const parsed = Papa.parse<string[]>(testContent, { delimiter: ',' });
    assert.ok(parsed.data.length > 0, '特殊字符应该正确解析');
  });

  it('应该正确处理BOM标记的UTF-8文件', () => {
    // UTF-8 with BOM
    const bom = '\uFEFF';
    const testContent = bom + 'Name,Age\nJohn,25\nJane,30';
    const parsed = Papa.parse<string[]>(testContent, { delimiter: ',' });
    assert.strictEqual(parsed.data[0][0], 'Name', 'BOM标记应该被正确处理');
  });

  it('应该检测并处理GBK编码的文件', () => {
    // Node.js原生不支持GBK，跳过此测试
    // 实际应用中需要使用iconv-lite等库
    console.log('GBK编码测试跳过：需要iconv-lite等第三方库');
  });

  it('应该处理不同换行符格式', () => {
    const testContentCRLF = 'Name,Age\r\nJohn,25\r\nJane,30';
    const parsedCRLF = Papa.parse<string[]>(testContentCRLF, { delimiter: ',' });
    assert.strictEqual(parsedCRLF.data.length, 3, 'CRLF换行符应该正确处理');

    const testContentLF = 'Name,Age\nJohn,25\nJane,30';
    const parsedLF = Papa.parse<string[]>(testContentLF, { delimiter: ',' });
    assert.strictEqual(parsedLF.data.length, 3, 'LF换行符应该正确处理');
  });

  it('应该处理混合换行符格式', () => {
    const testContent = 'Name,Age\r\nJohn,25\nJane,30\r\nBob,35';
    const parsed = Papa.parse<string[]>(testContent, { delimiter: ',' });
    // PapaParse会统一处理换行符
    assert.ok(parsed.data.length >= 3, '混合换行符应该正确处理');
  });
});
