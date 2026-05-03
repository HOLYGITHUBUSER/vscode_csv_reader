# 目录结构

仓库使用 **"英文功能名-中文描述"** 的命名风格（例如 `extension-扩展逻辑/`、`artifacts-安装包/`），让第三方工具按英文识别，让中文读者按中文快速定位。

## 顶层速览

```
csv-reader-pro-for-vscode/
├─ README.md                     项目名片
├─ LICENSE                       MIT 许可证
├─ package.json                  扩展清单 + npm 脚本
├─ tsconfig.json                 TypeScript 编译配置（只收 extension-扩展逻辑/）
│
├─ extension-扩展逻辑/                     TypeScript 扩展源码
├─ webview-表格界面/                   webview 前端（main.js）
├─ langConfig-语言配置/                  语言定义、lint、测试配置
├─ icon-扩展图标/                  图标与截图资产
│
├─ build-构建脚本/                   构建 / 版本号 / 图标脚本（py + cjs）
├─ out/                          tsc 产物（.gitignore）
├─ artifacts-安装包/                    打包后的 .vsix + BUILD-INFO.md
│
├─ e2e-浏览器测试/                   Playwright 真浏览器端到端测试
├─ samples-试用样例/                    人眼试用 CSV 样例
├─ docs-项目文档/                    项目中文文档（本目录）
│
├─ backup-归档旧文件/                       归档的旧文件（不进 VSIX）
└─ node_modules/                 依赖（.gitignore）
```

## extension-扩展逻辑/ · 扩展本体

```
extension-扩展逻辑/
├─ extension.ts                  激活入口（activate）
├─ commands.ts                   所有命令面板命令
├─ CsvEditorProvider.ts          核心：CustomTextEditorProvider，含
│                                ├─ CsvEditorController（内部类）
│                                ├─ 表格 HTML 生成
│                                ├─ 消息分发（sortColumn/resetSort/filterSort/…）
│                                └─ 排序快照状态机（见"功能手册"）
├─ types/                        共用类型声明
└─ test/                         Node 单元测试 + jsdom webview 测试
    ├─ *.test.ts                 每块逻辑一个 spec
    ├─ helpers/webview-harness.ts   jsdom 版的 webview 测试脚手架
    ├─ complex_test.csv             单测自动化用的小样本
    ├─ super_example.csv            单测自动化用的千行样本
    └─ generate-fixture.cjs         生成大样本（给单测压测）
```

## webview-表格界面/ · webview 前端

```
webview-表格界面/
└─ main.js                       唯一前端脚本；由 CsvEditorProvider 的
                                 HTML 模板通过 <script src="…"> 引入。
                                 职责：
                                   - 表格渲染 / 分块加载
                                   - 键鼠交互（排序、拖动、粘贴、查找）
                                   - 右下角浮动面板（filter + row-height）
                                   - 与后端通过 postMessage 双向通讯
```

webview 的 HTML 模板在 `extension-扩展逻辑/CsvEditorProvider.ts` 里拼装；`main.js` 是**被注入**的唯一外部脚本，请把所有前端交互代码放在这里。

## e2e-浏览器测试/ · Playwright 真浏览器测试

```
e2e-浏览器测试/
├─ playwright.config.ts          Playwright 配置（chromium only，headless）
├─ harness.ts                    生成自包含 HTML，把 webview-表格界面/main.js 整段
│                                内联进 <script>，shim acquireVsCodeApi，
│                                通过 file:// 载入真 Chromium。
├─ sort-tri-state.spec.ts        三态排序按钮 E2E
├─ float-panel.spec.ts           右下角浮动面板（filter + row-height + clear）E2E
└─ test-results/                 失败截图 / trace.zip（.gitignore）
```

与 `extension-扩展逻辑/test/helpers/webview-harness.ts`（jsdom 版）的关系：
- **jsdom 版** 快、适合单元级交互测试，挂 node 测试运行器里。
- **Playwright 版** 是真浏览器，适合"这里真的会被点到吗"的端到端验证。
详见 [测试指南](测试指南-testing.md)。

## langConfig-语言配置/

```
langConfig-语言配置/
├─ language-语言配置.json          csv/tsv/tab/psv 语言贡献（VSIX 必需）
├─ eslint-代码检查配置.mjs         ESLint 规则（被 .vscodeignore 排除）
└─ vscode-test-测试配置.mjs        原 vscode-test 入口（被 .vscodeignore 排除）
```

> `.vscodeignore` 对 eslint/vscode-test 两个配置文件做了显式排除，只让 `language-语言配置.json` 进入 VSIX。

## build-构建脚本/

```
build-构建脚本/
├─ bump-version-版本号递增.py             patch 号 +1，可选择触发 compile / package
├─ package-vsix-with-timestamp-打包带时间戳.cjs   核心：vsce package + 时间戳 +
│                                            latest.vsix 副本 + BUILD-INFO.md
└─ round-icon.py                          把 icon.orig.png 加工成 1024×1024 圆角
```

## icon-扩展图标/

```
icon-扩展图标/
├─ icon.png                   打包进 VSIX 的扩展图标（1024×1024，圆角）
└─ icon.orig.png              原始未处理版本（被 .vscodeignore 排除，不进 VSIX）
```

## artifacts-安装包/ · 打包产物

```
artifacts-安装包/
├─ csv-custom-pro-<ver>-<timestamp>.vsix   每次 package:bump 产出的历史版本
├─ csv-custom-pro-latest.vsix              最新稳定副本（文件名不变）
└─ BUILD-INFO.md                           打包元信息（版本 / commit / SHA-256）
```

## samples-试用样例/ · 人眼试用样例

```
samples-试用样例/
├─ README.md                              使用说明
└─ ultimate-50mb-完整压力测试.csv          约 50 MiB 的综合压力测试大表格
```

目录名提示：**自动化测试用的是 `extension-扩展逻辑/test/` 下的固定样本**。本目录只放用户可以随便打开/改动的手工压力测试大样例。

## backup-归档旧文件/ · 归档

目前存放的是早期 yeoman 模板生成的 `docs-项目文档/`、早期大样本、许可证副本等，**不会进入 VSIX**（`.vscodeignore` 有 `backup-归档旧文件/**`），也不会被 git 追踪（`.gitignore` 有 `backup-归档旧文件/`）。

---

## 相关约定

- **中文目录名**：Git / npm / vsce / Playwright 都能正确处理 UTF-8 路径；你只需要保证终端是 UTF-8。
- **`out/` 永远是派生物**：Node 单测路径是 `out/test/**/*.test.js`（由 tsc 从 `extension-扩展逻辑/test/` 输出）。所以加单测时只改 `extension-扩展逻辑/test/`，`npm test` 自动 `compile` 后跑。
- **`.vscodeignore` 一键看清** VSIX 会装进哪些东西：见 [打包与发布](打包与发布-packaging-release.md)。
