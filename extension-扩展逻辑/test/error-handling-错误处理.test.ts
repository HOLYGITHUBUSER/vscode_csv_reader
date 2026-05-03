import assert from 'assert';
import { describe, it } from 'node:test';
import Papa from 'papaparse';

describe('错误处理测试', () => {
  it('应该处理格式错误的CSV文件', () => {
    // 引号不匹配
    const malformedCSV = 'Name,Age\nJohn,25\nJane,"30\nBob,35';
    const parsed = Papa.parse<string[]>(malformedCSV, { delimiter: ',' });
    assert.ok(parsed.data.length > 0, '格式错误的CSV应该能被解析');
    assert.ok(parsed.errors.length > 0, '应该记录解析错误');
  });

  it('应该处理空文件', () => {
    const emptyCSV = '';
    const parsed = Papa.parse<string[]>(emptyCSV, { delimiter: ',' });
    assert.strictEqual(parsed.data.length, 0, '空文件应该返回空数据');
  });

  it('应该处理只有换行符的文件', () => {
    const onlyNewline = '\n';
    const parsed = Papa.parse<string[]>(onlyNewline, { delimiter: ',' });
    assert.ok(parsed.data.length >= 1, '只有换行符的文件应该能被解析');
  });

  it('应该处理单行文件', () => {
    const singleRow = 'Name,Age,City';
    const parsed = Papa.parse<string[]>(singleRow, { delimiter: ',' });
    assert.strictEqual(parsed.data.length, 1, '单行文件应该能被解析');
    assert.strictEqual(parsed.data[0].length, 3, '单行应该包含3列');
  });

  it('应该处理只有表头的文件', () => {
    const headerOnly = 'Name,Age,City\n';
    const parsed = Papa.parse<string[]>(headerOnly, { delimiter: ',' });
    // PapaParse可能将换行符后的空行也算作一行
    assert.ok(parsed.data.length >= 1, '只有表头的文件应该能被解析');
  });

  it('应该处理列数不一致的行', () => {
    const inconsistentColumns = 'Name,Age,City\nJohn,25,Beijing\nJane,30\nBob,35,Shanghai,China';
    const parsed = Papa.parse<string[]>(inconsistentColumns, { delimiter: ',' });
    assert.strictEqual(parsed.data.length, 4, '列数不一致的文件应该能被解析');
  });

  it('应该处理包含特殊分隔符的字段', () => {
    const specialSeparator = 'Name,Description\nJohn,"Age: 25, City: Beijing"\nJane,"Age: 30, City: Shanghai"';
    const parsed = Papa.parse<string[]>(specialSeparator, { delimiter: ',' });
    assert.strictEqual(parsed.data.length, 3, '包含逗号的字段应该能被正确解析');
    assert.strictEqual(parsed.data[1][1], 'Age: 25, City: Beijing', '引号内的逗号不应作为分隔符');
  });

  it('应该处理包含换行符的字段', () => {
    const multilineField = 'Name,Description\nJohn,"Line 1\nLine 2"\nJane,"Single line"';
    const parsed = Papa.parse<string[]>(multilineField, { delimiter: ',' });
    assert.strictEqual(parsed.data.length, 3, '包含换行符的字段应该能被正确解析');
  });

  it('应该处理超大数字', () => {
    const largeNumbers = 'ID,Value\n1,999999999999999999\n2,1000000000000000000';
    const parsed = Papa.parse<string[]>(largeNumbers, { delimiter: ',' });
    assert.strictEqual(parsed.data.length, 3, '超大数字应该能被正确解析');
  });

  it('应该处理空字段', () => {
    const emptyFields = 'Name,Age,City\nJohn,,Beijing\nJane,30,\nBob,,';
    const parsed = Papa.parse<string[]>(emptyFields, { delimiter: ',' });
    assert.strictEqual(parsed.data.length, 4, '空字段应该能被正确处理');
    assert.strictEqual(parsed.data[1][1], '', '空字段应该保持为空字符串');
  });

  it('应该处理只有空格的字段', () => {
    const spaceFields = 'Name,Age\nJohn,  25  \nJane, 30';
    const parsed = Papa.parse<string[]>(spaceFields, { delimiter: ',' });
    assert.strictEqual(parsed.data.length, 3, '空格字段应该能被正确处理');
  });

  it('应该处理Unicode字符', () => {
    const unicodeCSV = '名称,年龄\n张三,25\n李四,30\n王五,35';
    const parsed = Papa.parse<string[]>(unicodeCSV, { delimiter: ',' });
    assert.strictEqual(parsed.data.length, 4, 'Unicode字符应该能被正确解析');
    assert.strictEqual(parsed.data[1][0], '张三', '中文字符应该正确解析');
  });

  it('应该处理emoji字符', () => {
    const emojiCSV = 'Name,Emoji\nJohn,😀\nJane,🎉\nBob,🚀';
    const parsed = Papa.parse<string[]>(emojiCSV, { delimiter: ',' });
    assert.strictEqual(parsed.data.length, 4, 'Emoji字符应该能被正确解析');
    assert.strictEqual(parsed.data[1][1], '😀', 'Emoji应该正确解析');
  });
});
