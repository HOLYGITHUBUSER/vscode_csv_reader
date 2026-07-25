# 技术架构

本文说明项目目录、模块职责和关键数据流。只记录理解代码需要的结构，不写用户功能细节。

## 顶层目录

```text
vscode_csv_reader/
├─ 01-extension-扩展逻辑/      ★ 扩展宿主 TS + 单测
├─ 02-webview-表格界面/        ★ webview 脚本（进 VSIX）
├─ 03-script-构建脚本/         升版本 / 打包
├─ 04-samples-试用样例/        手工 CSV
├─ 05-e2e-浏览器测试/          Playwright
├─ 06-docs-项目文档/           文档
├─ 07-artifacts-安装包/        latest.vsix
├─ icon.png                 扩展图标（根目录，减少一层）
├─ language-语言配置.json   语言贡献（根目录，减少一层）
├─ out/                     tsc 产物（资源管理器默认隐藏）
└─ node_modules/            依赖（资源管理器默认隐藏）
```

命名范式见 [naming-命名规范.md](naming-命名规范.md)。  
侧栏噪音目录通过 `.vscode/settings.json` 的 `files.exclude` 隐藏。

## 扩展侧模块

```text
01-extension-扩展逻辑/
├─ extension.ts             activate/deactivate
├─ commands.ts              命令面板
├─ CsvEditorProvider.ts     Custom Editor 编排中心（HTML / 消息 / 状态）
├─ csvDocument.ts           文档模型与撤销
├─ csvCellFormat.ts         escape、链接、类型色、data-full-text
├─ csvFilterSort.ts         过滤/排序纯逻辑
├─ csvFormat.ts             保格式字段写回
├─ csvRender.ts             表格 HTML / chunk / 采样元数据
├─ csvSeparator.ts          分隔符检测与继承
├─ csvTypes.ts              共享类型
└─ test/                    Node 单测 + jsdom webview 测试
```

`CsvEditorProvider.ts` 负责：注册 custom editor、解析文档、生成 webview HTML、处理 `postMessage`、写回与 per-URI 状态。

## Webview 模块

```text
02-webview-表格界面/
├─ webview-main.js                  选区、编辑、粘贴、排序、虚拟滚动、缩放、全文预览
├─ webview-filter-panel.js    全局搜索、列过滤 combobox、行高
└─ webview-find-replace.js    查找替换
```

加载顺序：`webview-find-replace.js` → `webview-main.js` → `webview-filter-panel.js`。  
`webview-main.js` 暴露 `window.CsvWebviewBridge` 给过滤面板。

## Webview 与扩展通信

前端到后端统一走 `vscode.postMessage`：

```text
webview script
  └─ postMessage({ type, ...payload })
        ↓
CsvEditorProvider.onDidReceiveMessage
        ↓
更新文档 / 查询 / 排序过滤 / 返回结果
        ↓
webview.postMessage({ type, ...payload })
```

常见消息：

- `editCell` / `replaceCells`：编辑写回。
- `pasteCells` / `pasteApplied`：矩形粘贴和选区同步。
- `sortColumn` / `resetSort`：三态排序。
- `filterSort` / `filterSortResult`：列过滤和首屏结果。
- `requestChunk` / `chunkData`：远程 chunk。
- `findMatches` / `findMatchesResult`：完整文件查找。
- `openLink`：Ctrl/Cmd+Click 外部打开链接。

## 大文件策略

- 默认 `csv.maxFileSizeMB` 可配置（见 package contributes）。
- 首屏只渲染有限单元格（`csvRender.ts` 按列数缩放 chunk 行数）；类型/列宽只采样前若干行。
- 单元格 HTML 尽量瘦身；完整长文用 `data-full-text` + 可复制预览浮层，不用原生 title。
- 大表（≥400 行）webview 侧使用**窗口虚拟滚动**：DOM 只保留视口附近行，`requestChunk` 按窗口拉取。
- 过滤/排序后大结果走完整 `updateWebviewContent` 以保持虚拟滚动元数据一致。
- 样例：日常 `smoke-日常验收.csv`；压测 `stress-50mb-压力测试.csv`。

## 状态持久化

扩展侧 per-URI 状态：

- 隐藏前 N 行。
- 是否把首行当表头。
- 是否显示序号列。
- 当前文件分隔符覆盖。

Webview 侧状态：

- 滚动位置。
- 当前选区。
- 列宽/行高。
- 缩放比例。

## VSIX 打包内容

运行时需要进入 VSIX 的内容：

- `out/`
- `02-webview-表格界面/`
- `icon.png`
- `language-语言配置.json`
- `package.json`
- `README.md`
- `LICENSE`

不会进入 VSIX 的内容：

- 源码 `01-extension-扩展逻辑/**/*.ts`
- 测试 `01-extension-扩展逻辑/test/`、`05-e2e-浏览器测试/`
- 文档 `06-docs-项目文档/`
- 样例 `04-samples-试用样例/`
- 归档 `99-backup-归档旧文件/`
- 历史包 `07-artifacts-安装包/`

具体以 `.vscodeignore` 为准。
