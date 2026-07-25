# 命名规范

全仓库统一用下面范式，新增文件/目录必须遵守。

## 总原则

| 层级 | 范式 | 示例 |
| --- | --- | --- |
| 顶层目录 | `{en-kebab}-{中文职责}` | `extension-扩展逻辑/` |
| 人读文档 | `{en}-{中文}.md` | `product-产品设计.md` |
| 构建脚本（目录 `script-构建脚本/`） | `{en-kebab}-{中文}.{ext}` | `package-vsix-打包.cjs` |
| 样例数据 | `{en}-{中文}.{ext}` | `smoke-日常验收.csv` |
| Webview 脚本 | `webview-{en-kebab}.js` | `webview-filter-panel.js` |
| 扩展源码 `.ts` | 英文；类用 PascalCase，模块 `csv` 前缀 camelCase | `CsvEditorProvider.ts`、`csvRender.ts` |
| 单测 | `{en-kebab}.test.ts` 或 `{en-kebab}-{中文}.test.ts` | `encoding-编码处理.test.ts` |
| E2E | `{en-kebab}.spec.ts` 或 `{en-kebab}-{中文}.spec.ts` | `ui-buttons-所有按钮.spec.ts` |
| 安装包 | 固定名 + 可选时间戳 | `csv-custom-pro-latest.vsix` |

## 细则

### 1. 顶层目录（中英双语）

- 英文段：小写 kebab-case，短、稳、可搜索。
- 中文段：2～6 字说明职责，用 `-` 连接。
- 不要 camelCase 目录名（禁止 `langConfig`，用 `lang`）。

当前顶层：

```text
extension-扩展逻辑/
webview-表格界面/
lang-语言配置/
icon-扩展图标/
script-构建脚本/
e2e-浏览器测试/
samples-试用样例/
docs-项目文档/
artifacts-安装包/
backup-归档旧文件/
```

### 2. 扩展 TypeScript（纯英文）

代码标识符、import 路径保持英文，便于工具链与社区习惯：

- 入口：`extension.ts`
- 类/Provider：`CsvEditorProvider.ts`（PascalCase）
- 领域模块：`csv` + camelCase 能力名（`csvRender.ts`、`csvFilterSort.ts`）
- 测试：`extension-扩展逻辑/test/` 下，文件名可用双语后缀标明主题

### 3. Webview JavaScript

统一前缀 `webview-` + kebab-case：

| 文件 | 职责 |
| --- | --- |
| `webview-main.js` | 表格主逻辑 |
| `webview-filter-panel.js` | 过滤面板 |
| `webview-find-replace.js` | 查找替换 |

### 4. 文档

`docs-项目文档/{en}-{中文}.md`：

- `product-产品设计.md`
- `architecture-技术架构.md`
- `engineering-开发测试发布.md`
- `naming-命名规范.md`（本文）

### 5. 样例 CSV

`samples-试用样例/{en}-{中文}.csv`：

- `smoke-日常验收.csv`
- `complex-边界用例.csv`
- `super-中等样例.csv`
- `stress-50mb-压力测试.csv`

### 6. 构建与产物

- **工程/构建脚本**只放 `script-构建脚本/`（版本递增、打包等），双语名。
- 产物只进 `artifacts-安装包/`：
  - 稳定名：`csv-custom-pro-latest.vsix`
  - 时间戳名本地临时，gitignore。
- **禁止**在仓库根目录放 `.vsix`。
- 死代码 / 一次性工具 → `backup-归档旧文件/`（gitignore，不进 git）。

### 7. 禁止

- 目录用 camelCase / snake_case 混搭
- 同义多名（如同时存在 `main.js` 与 `webview-main.js`）
- 文档英文在前、中文在前两套混用（文档一律 **en-中文**）
- 无说明的缩写（`tmp`、`misc`、`new2`）

## 改名检查清单

1. `git mv` 改路径（保留历史）
2. 全文搜旧路径并更新（`package.json`、文档、测试、Provider）
3. `npm run compile && npm test`
4. `npm run package:force` 确认 VSIX 内路径正确
