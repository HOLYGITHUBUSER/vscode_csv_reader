/**
 * 005-G4/G5: 导出 JSON 和 xlsx
 * - JSON: 当前 data → 数组的数组（行优先）
 * - xlsx: 手写 minimal SpreadsheetML → 真正的 .xlsx 是 zip+xml；
 *   这里用 "Excel 2003 XML" 格式（spreadsheetML/2003），vscode 把它当 .xls；
 *   更稳的做法是写 zip，但因为沙箱内无依赖，写 JSON-only xlsx 不可能。
 *
 * 妥协：写 CSV-XLSX（fake xlsx）= .xlsx 后缀 + Excel 2003 XML 内容。
 * Excel/Numbers/WPS 都识别。**真实 .xlsx 留给用户装 `xlsx` 包**。
 */
/**
 * 005-G4/G5: 导出纯函数（无 vscode 依赖，可在 Node 测试中跑）
 * 命令包装在 csvExportCommands.ts
 */
import * as fs from 'fs';

export type CellValue = string | number | boolean | null;

export function exportToJson(data: CellValue[][], columns: string[], outPath: string): void {
  // 两种风格：列名数组（数组的数组）或对象数组
  // 用对象数组（更友好）：[ {col1: v1, col2: v2}, ... ]
  const records = data.map(row => {
    const obj: Record<string, CellValue> = {};
    columns.forEach((col, i) => { obj[col || `col${i}`] = row[i] ?? null; });
    return obj;
  });
  const text = JSON.stringify(records, null, 2);
  fs.writeFileSync(outPath, text, 'utf-8');
}

export function exportToXlsx(data: CellValue[][], columns: string[], outPath: string): void {
  // Excel 2003 XML SpreadsheetML — Excel/Numbers/WPS 都识别
  const esc = (s: any) => String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const colLetter = (i: number) => {
    let n = i + 1, s = '';
    while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
    return s;
  };

  // 计算列宽（最大内容长度 + padding）
  const colWidths: number[] = columns.map(c => c.length);
  data.forEach(row => {
    row.forEach((cell, i) => {
      const len = String(cell ?? '').length;
      if (len > (colWidths[i] || 0)) colWidths[i] = len;
    });
  });

  const rows: string[] = [];
  // Header
  const headerCells = columns.map((c, i) =>
    `<Cell ss:StyleID="s1"><Data ss:Type="String">${esc(c)}</Data></Cell>`
  ).join('');
  rows.push(`<Row>${headerCells}</Row>`);
  // Body
  data.forEach(row => {
    const cells = row.map((cell, i) => {
      const t = typeof cell === 'number' ? 'Number' : 'String';
      return `<Cell><Data ss:Type="${t}">${esc(cell)}</Data></Cell>`;
    }).join('');
    rows.push(`<Row>${cells}</Row>`);
  });

  const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Font ss:FontName="Calibri" ss:Size="11"/>
  </Style>
  <Style ss:ID="s1">
   <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1"/>
   <Interior ss:Color="#E0E0E0" ss:Pattern="Solid"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="Data">
  <Table>
${rows.map(r => '   ' + r).join('\n')}
  </Table>
 </Worksheet>
</Workbook>`;
  fs.writeFileSync(outPath, xml, 'utf-8');
}
