# 技术架构

本文说明项目目录、模块职责和关键数据流。

## 顶层目录（编号排序）

```text
vscode_csv_reader/
├─ 00-config-工程配置/       图标、语言配置、tsconfig、LICENSE
├─ 01-extension-扩展逻辑/    ★ 扩展宿主 TS + 单测
├─ 02-webview-表格界面/      ★ webview 脚本（进 VSIX）
├─ 03-script-构建脚本/       升版本 / 打包
├─ 04-samples-试用样例/      手工 CSV
├─ 05-e2e-浏览器测试/        Playwright
├─ 06-docs-项目文档/         文档
├─ 07-artifacts-安装包/      latest.vsix
├─ package.json              扩展清单（必须在仓库根）
└─ README.md
```

根目录刻意只留 **package.json + README**（外加工具隐藏的 lock/ignore）。  
命名范式见 [naming-命名规范.md](naming-命名规范.md)。

## 00-config-工程配置

| 文件 | 用途 |
| --- | --- |
| `icon.png` | 扩展图标（`package.json` → `icon`） |
| `language-语言配置.json` | CSV/TSV language configuration |
| `tsconfig.json` | 编译入口（`npm run compile`） |
| `LICENSE` | MIT |

## 扩展侧模块

```text
01-extension-扩展逻辑/
├─ extension.ts             activate/deactivate
├─ commands.ts              命令面板
├─ CsvEditorProvider.ts     Custom Editor 编排中心
├─ csvDocument.ts           文档模型与撤销
├─ csvCellFormat.ts         escape、链接、类型色、data-full-text
├─ csvFilterSort.ts         过滤/排序纯逻辑
├─ csvFormat.ts             保格式字段写回
├─ csvRender.ts             表格 HTML / chunk / 采样元数据
├─ csvSeparator.ts          分隔符检测与继承
├─ csvTypes.ts              共享类型
└─ test/                    Node 单测 + jsdom webview 测试
```

## Webview 模块

```text
02-webview-表格界面/
├─ webview-main.js           选区、编辑、虚拟滚动、全文预览
├─ webview-filter-panel.js   全局搜索、列过滤、行高
└─ webview-find-replace.js   查找替换
```

加载顺序：`webview-find-replace.js` → `webview-main.js` → `webview-filter-panel.js`。

## 大文件策略

- 首屏有限单元格；类型/列宽采样。
- 大表窗口虚拟滚动；`requestChunk` 按窗口拉取。
- 样例：`04-samples-试用样例/smoke-日常验收.csv` / `stress-50mb-压力测试.csv`。

## VSIX 打包内容

进入 VSIX：

- `out/`
- `02-webview-表格界面/`
- `00-config-工程配置/icon.png`（路径以 package.json 为准）
- `00-config-工程配置/language-语言配置.json`
- `package.json`、`README.md`

具体以 `.vscodeignore` 为准。
