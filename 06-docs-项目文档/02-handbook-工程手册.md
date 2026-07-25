# 工程手册

结构、命名、模块、测试、打包与安装。**一份说清怎么改、怎么验。**

---

## 1. 目录（编号排序）

```text
vscode_csv_reader/
├─ 00-config-工程配置/       图标 / tsconfig / 许可证
├─ 01-extension-扩展逻辑/    ★ 宿主 TS + 单测
├─ 02-webview-表格界面/      ★ webview-*.js
├─ 03-script-构建脚本/       bump-version / package-vsix
├─ 04-samples-试用样例/      手测 CSV
├─ 05-e2e-浏览器测试/        Playwright
├─ 06-docs-项目文档/         本目录（仅 2 份文档）
├─ 07-artifacts-安装包/      latest.vsix + BUILD-INFO
├─ package.json              必须在根
└─ README.md
```

根目录尽量不堆散文件；`node_modules` / `out` / `99-backup-*` / lock / ignore 由 `files.exclude` 隐藏。

### 00-config

| 文件 | 用途 |
| --- | --- |
| `icon-扩展图标.png` | `package.json` → `icon` |
| `tsconfig-编译配置.json` | `npm run compile` |
| `license-许可证.txt` | MIT 全文（`package.json` 也有 `"license": "MIT"`） |

### 01-extension 模块

| 文件 | 职责 |
| --- | --- |
| `extension.ts` | 激活入口 |
| `commands.ts` | 命令面板 |
| `CsvEditorProvider.ts` | Custom Editor 编排 |
| `csvDocument.ts` | 文档与撤销 |
| `csvRender.ts` | 表格/chunk HTML |
| `csvFilterSort.ts` | 过滤排序逻辑 |
| `csvFormat.ts` | 保格式写回 |
| `csvCellFormat.ts` | escape / 链接 / 类型色 / full-text |
| `csvSeparator.ts` | 分隔符 |
| `csvTypes.ts` | 类型 |
| `test/` | Node + jsdom 测试 |

### 02-webview

| 文件 | 职责 |
| --- | --- |
| `webview-main.js` | 选区、编辑、虚拟滚动、预览、复制 |
| `webview-filter-panel.js` | 过滤面板 |
| `webview-find-replace.js` | 查找替换 |

加载顺序：find-replace → main → filter-panel。

### 大文件策略

- 首屏单元格上限控制；类型/列宽采样。
- ≥约 400 行：窗口虚拟滚动，DOM 只保留视口附近行。
- 过滤后大结果走完整 `updateWebviewContent` 以同步虚拟滚动元数据。

### VSIX 进包内容

`out/`、`02-webview-表格界面/`、`00-config` 中的图标、`package.json`、`README.md`。以 `.vscodeignore` 为准。

---

## 2. 命名规范

| 层级 | 范式 | 例 |
| --- | --- | --- |
| 顶层目录 | `{两位序号}-{en-kebab}-{中文}` | `01-extension-扩展逻辑/` |
| 文档 | `{两位序号}-{en}-{中文}.md` | `01-product-产品设计.md` |
| 脚本 | `{en-kebab}-{中文}.{ext}` | `package-vsix-打包.cjs` |
| 样例 | `{en}-{中文}.{ext}` | `smoke-日常验收.csv` |
| Webview | `webview-{en-kebab}.js` | `webview-main.js` |
| 扩展 TS | 英文（PascalCase / csv+camelCase） | `csvRender.ts` |

**禁止：** 无编号业务顶层目录；根目录堆 icon/tsconfig 等散文件；camelCase 目录名。

归档死代码 → `99-backup-归档旧文件/`（gitignore）。

---

## 3. 开发命令

```bash
npm install                 # 依赖 + Playwright Chromium
npm run compile             # tsc → out/
npm test                    # 单测 + jsdom
npm run test:webview        # 仅 webview-* 单测
npm run test:e2e            # Playwright
npm run test:full           # test + e2e + package
npm run package:force       # 不升版打包 → 07-artifacts/latest.vsix
npm run package             # 升 PATCH 再打包（见 bump 脚本）
npm run install:cursor      # 装 latest 到 Cursor
```

环境：Node ≥ 18；需要时 `npx playwright install chromium`。

### 改代码入口

| 目标 | 路径 |
| --- | --- |
| 激活 / Editor | `01-extension-…/extension.ts`、`CsvEditorProvider.ts` |
| 过滤排序逻辑 | `csvFilterSort.ts` |
| 渲染 / chunk | `csvRender.ts` |
| 表格交互 | `02-webview-…/webview-main.js` |
| 过滤 UI | `webview-filter-panel.js` |
| 查找替换 | `webview-find-replace.js` |
| jsdom 脚手架 | `01-extension-…/test/helpers/webview-harness.ts` |
| E2E 脚手架 | `05-e2e-…/harness.ts` |

### 测试分层

```text
慢  Playwright E2E     05-e2e-浏览器测试/*.spec.ts
    jsdom webview      01-extension-…/test/webview-*.test.ts
快  Node 纯函数        01-extension-…/test/*.test.ts
```

### 手测样例

| 文件 | 用途 |
| --- | --- |
| `04-samples-…/smoke-日常验收.csv` | 日常烟测（推荐） |
| `complex-边界用例.csv` | 边界字符 |
| `super-中等样例.csv` | 中等体量 |
| `stress-50mb-压力测试.csv` | 性能 / 滚动 |

验收建议：`npm run test:full` → `install:cursor` → Reload → 开 smoke 或 stress，点滚动/排序/过滤/编辑。

### 打包安装

```bash
npm run package:force
cursor --install-extension 07-artifacts-安装包/csv-custom-pro-latest.vsix --force
# Cmd/Ctrl+Shift+P → Developer: Reload Window
```

产物策略：只认 `csv-custom-pro-latest.vsix`；时间戳包本地最多保留 2 个；根目录禁止放 `.vsix`。

### 提交前

| 改动类型 | 更新文档 |
| --- | --- |
| 用户可见行为 | `01-product-产品设计.md` 决策表 |
| 目录 / 模块 / 构建流程 | 本文 |
| webview / 消息协议 | 至少 `npm test` + `npm run test:e2e` |

新增测试：尽量「先改坏再确认会红，再改回绿」。
