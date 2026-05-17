# 开发测试发布

本文是修改、验证、打包和安装扩展的工程手册。

## 环境准备

前置：

- Node.js >= 18
- Python 3
- VS Code / Cursor / Windsurf

```bash
npm install
```

`npm install` 会安装 Playwright Chromium。网络失败时可单独运行：

```bash
npx playwright install chromium
```

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run compile` | TypeScript 编译到 `out/` |
| `npm run lint` | ESLint 检查扩展侧 TypeScript |
| `npm test` | 编译后运行 Node 单测和 jsdom webview 测试 |
| `npm run test:webview` | 只运行 `webview-*` jsdom 测试 |
| `npm run test:e2e` | 运行 Playwright 真浏览器测试 |
| `npm run test:full` | Node + Playwright + 打包 VSIX |
| `npm run package` | 打包 VSIX，不升版本 |
| `npm run package:bump` | PATCH+1、编译、打包 VSIX |
| `npm run install:cursor` | 安装 `latest.vsix` 到 Cursor |

## 改代码入口

- 扩展激活和 custom editor：`extension-扩展逻辑/extension.ts`、`extension-扩展逻辑/CsvEditorProvider.ts`
- 命令面板：`extension-扩展逻辑/commands.ts`
- 过滤/排序纯逻辑：`extension-扩展逻辑/csvFilterSort.ts`
- CSV 格式保真写回：`extension-扩展逻辑/csvFormat.ts`
- 分隔符策略：`extension-扩展逻辑/csvSeparator.ts`
- 表格 HTML/chunk 生成：`extension-扩展逻辑/csvRender.ts`
- 主表格交互：`webview-表格界面/main.js`
- 过滤面板：`webview-表格界面/webviewFilterPanel.js`
- 查找替换：`webview-表格界面/webviewFindReplace.js`
- jsdom 脚手架：`extension-扩展逻辑/test/helpers/webview-harness.ts`
- E2E 脚手架：`e2e-浏览器测试/harness.ts`

## 测试分层

```text
慢 ↑  Playwright E2E       e2e-浏览器测试/*.spec.ts
      jsdom webview 测试    extension-扩展逻辑/test/webview-*.test.ts
快 ↓  Node 纯函数单测       extension-扩展逻辑/test/*.test.ts
```

### Node 纯函数单测

适合测试：

- 排序状态机。
- CSV 格式保真。
- 分隔符推断。
- URL 安全和 XSS 防御。
- 列过滤条件归一化。

### jsdom Webview 测试

适合测试：

- 点击、输入、键盘事件。
- `postMessage` payload。
- DOM 状态同步。
- find/replace widget 的键盘流。

写 webview 测试时，先更新 `extension-扩展逻辑/test/helpers/webview-harness.ts` 的 DOM 骨架，否则真实代码可能因为找不到元素而提前失败。

### Playwright E2E

适合测试：

- 真 Chromium 中是否能点到、看到、滚动到。
- CSS 布局影响交互的场景。
- 过滤面板候选浮层、排序按钮、行高切换。
- 失败时需要截图和 trace 的场景。

## 完整验收流程

1. 运行 `npm run test:full`。
2. 运行 `npm run install:cursor`，在 Cursor 里执行 `Developer: Reload Window`。
3. 打开 `samples-试用样例/ultimate-50mb-完整压力测试.csv`。
4. 验证首屏打开、滚动加载、排序、列过滤、查找替换、单元格编辑。
5. 如需验证 Windsurf，安装同一个 `artifacts-安装包/csv-custom-pro-latest.vsix` 后重载窗口。

## 打包

常用：

```bash
npm run package:bump
```

它会：

1. 将 `package.json` PATCH 版本号 +1。
2. 运行 TypeScript 编译。
3. 生成时间戳 VSIX。
4. 覆盖 `artifacts-安装包/csv-custom-pro-latest.vsix`。
5. 更新 `artifacts-安装包/BUILD-INFO.md`。

只打包不升版本：

```bash
npm run package
```

## 安装到 Cursor / Windsurf

```bash
/Applications/Cursor.app/Contents/Resources/app/bin/cursor \
    --install-extension artifacts-安装包/csv-custom-pro-latest.vsix --force

/Applications/Windsurf.app/Contents/Resources/app/bin/windsurf \
    --install-extension artifacts-安装包/csv-custom-pro-latest.vsix --force
```

安装后执行：

```text
Cmd/Ctrl+Shift+P -> Developer: Reload Window
```

## 回归证明

新增测试时，不只看“绿”。要临时破坏实现并确认新测试会红，再恢复实现跑绿。这样才能证明测试确实覆盖了目标行为。

## 提交前检查

- 用户可见行为改动：更新 `产品设计-product.md` 的产品决策记录。
- 架构/目录/模块职责改动：更新 `技术架构-architecture.md`。
- 测试、打包、安装流程改动：更新本文。
- 涉及 `webview-表格界面/` 或消息协议：至少跑 `npm test` 和 `npm run test:e2e`。
- 打包前检查 `artifacts-安装包/BUILD-INFO.md` 文件大小，异常变大通常说明 `.vscodeignore` 漏排了内容。
