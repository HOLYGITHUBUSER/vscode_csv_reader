# 技术架构

本文说明项目目录、模块职责和关键数据流。只记录理解代码需要的结构，不写用户功能细节。

## 顶层目录

```text
vscode_csv_reader/
├─ extension-扩展逻辑/      VS Code 扩展侧 TypeScript 源码和 Node/jsdom 测试
├─ webview-表格界面/        webview 前端脚本
├─ langConfig-语言配置/     CSV/TSV/PSV 语言贡献配置
├─ icon-扩展图标/           扩展图标
├─ docs-项目文档/           产品、架构、工程文档
├─ build-构建脚本/          版本号、图标处理、VSIX 打包脚本
├─ e2e-浏览器测试/          Playwright 真浏览器测试
├─ samples-试用样例/        手工试用/压力测试 CSV
├─ artifacts-安装包/        打包后的 VSIX 与 BUILD-INFO.md
├─ out/                     TypeScript 编译产物，可删除重建
├─ node_modules/            npm 依赖，可删除重装
└─ backup-归档旧文件/       旧文件归档，不进 VSIX
```

## 扩展侧模块

```text
extension-扩展逻辑/
├─ extension.ts             activate/deactivate 入口
├─ commands.ts              命令面板命令注册
├─ CsvEditorProvider.ts     CustomTextEditorProvider 与消息编排
├─ csvCellFormat.ts         HTML/CSS escape、链接、类型识别、列颜色
├─ csvFilterSort.ts         过滤条件归一化、过滤/排序纯逻辑
├─ csvFormat.ts             CSV 字段 span、保格式写回
├─ csvRender.ts             表格 HTML 与 chunk HTML 生成
├─ csvSeparator.ts          分隔符配置、自动检测、继承规则
├─ csvTypes.ts              共享类型
└─ test/                    Node 单测 + jsdom webview 测试
```

`CsvEditorProvider.ts` 仍是扩展侧编排中心，负责：

- 注册 custom editor。
- 解析文档、读取配置、生成 webview HTML。
- 接收 webview `postMessage`。
- 写回文档和维护 per-URI 状态。
- 调用 `csvRender.ts`、`csvFilterSort.ts` 等纯模块。

## Webview 模块

```text
webview-表格界面/
├─ main.js                  表格选择、编辑、粘贴、排序、chunk、缩放、尺寸持久化
├─ webviewFilterPanel.js    右下角过滤面板、列搜索 combobox、行高按钮
└─ webviewFindReplace.js    查找替换 widget
```

脚本加载顺序由 `CsvEditorProvider.ts` 的 HTML 模板控制：

1. `webviewFindReplace.js`
2. `main.js`
3. `webviewFilterPanel.js`

`main.js` 暴露 `window.CsvWebviewBridge` 给过滤面板使用，避免过滤面板直接依赖大量内部变量。

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

- 默认 `csv.maxFileSizeMB = 100`。
- 初始渲染只输出首屏表格和必要 chunk 元数据。
- `csvRender.ts` 根据列数动态控制每个 chunk 的行数，避免单 chunk 单元格过多。
- 过滤/排序后只返回首屏结果，后续通过 `requestChunk` 继续加载。
- `samples-试用样例/ultimate-50mb-完整压力测试.csv` 是手工压力样例。

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
- `webview-表格界面/`
- `icon-扩展图标/icon.png`
- `langConfig-语言配置/language-语言配置.json`
- `package.json`
- `README.md`
- `LICENSE`

不会进入 VSIX 的内容：

- 源码 `extension-扩展逻辑/**/*.ts`
- 测试 `extension-扩展逻辑/test/`、`e2e-浏览器测试/`
- 文档 `docs-项目文档/`
- 样例 `samples-试用样例/`
- 归档 `backup-归档旧文件/`
- 历史包 `artifacts-安装包/`

具体以 `.vscodeignore` 为准。
