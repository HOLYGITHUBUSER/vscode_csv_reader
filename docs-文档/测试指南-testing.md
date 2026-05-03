# 测试指南

本项目有三层测试，互相补充，谁都别省。

```
         ┌─────────────────────────────┐
   慢 ↑  │ Playwright 真浏览器 E2E     │  真 Chromium 点按钮 / 敲键盘
         │ e2e-端到端/*.spec.ts         │  断言 DOM 与 postMessage
         ├─────────────────────────────┤
         │ jsdom Webview 交互单测      │  模拟 main.js 的 DOM 行为
         │ src-源码/test/webview-*.ts   │  几十毫秒一条
         ├─────────────────────────────┤
   快 ↓  │ Node 纯函数单测             │  sort/编辑/权限等
         │ src-源码/test/其它 *.test.ts │
         └─────────────────────────────┘
```

## 快速命令

```bash
npm test                 # 全部 Node 层（约 110 条，含 jsdom）
npm run test:webview     # 只跑 webview-* 的 jsdom 测试
npm run test:e2e         # 只跑 Playwright 真浏览器测试
npm run test:full        # Node + Playwright + 打包 VSIX
npm run install:cursor   # 把 dist-产物/csv-custom-pro-latest.vsix 安装到 Cursor
```

约定：**每次改 `media-媒体/main.js` 或 `src-源码/CsvEditorProvider.ts` 的消息分发前后，两个命令都要绿。**

## 完整手工验收流程

1. 运行 `npm run test:full`，确认 Node 层、jsdom webview、Playwright 和 VSIX 打包全部通过。
2. 运行 `npm run install:cursor`，然后在 Cursor 执行 `Developer: Reload Window`。
3. 打开 `test-示例/ultimate-50mb-完整压力测试.csv`。默认 `csv.maxFileSizeMB` 是 100，因此 50 MiB 样例不应弹大文件拦截。
4. 验证首屏能打开并滚动加载；在右下角列过滤构建器里连续添加两个列条件；确认不会整窗卡死。
5. 验证排序、行高 `紧凑 ↔ 自然折行`、单元格编辑保存都可用。
6. 如果要在 Windsurf 验证，使用 Windsurf 自带 CLI 或 UI 的 "Install from VSIX..." 安装同一个 `dist-产物/csv-custom-pro-latest.vsix`。

## 第 1 层：Node 纯函数单测

位置：`src-源码/test/` 下除 `webview-*` 以外的 `*.test.ts`，例如：

- `sort-dates.test.ts` · 日期字段排序
- `sort-nan.test.ts` · 数值里 NaN / 空串顺序
- `sort-snapshot.test.ts` · 排序"恢复原始"快照状态机
- `sort-virtual-row.test.ts` · 虚拟末空行不参与排序
- `edit-mutate.test.ts` · 编辑行为触发的结构变更
- `lossless-edit-formatting.test.ts` · 编辑后保留原格式（引号 / 转义）
- `reorder-behavior.test.ts` · 拖动重排行列
- `provider-state.test.ts` · per-URI 设置（序号列 / 分隔符 / header / 隐藏行）
- `provider-utils.test.ts` · 公共工具
- `security.test.ts` · 链接白名单 / XSS 防御
- `separators-and-dates.test.ts` · 分隔符推断、日期识别
- `virtuals-invariants.test.ts` · 虚拟空行/空列的不变量
- `csv-fixture.test.ts` · 用 `complex_test.csv` 做断言基线

写新纯函数时首选这层——快、确定、调试容易。

## 第 2 层：jsdom Webview 交互单测

位置：`src-源码/test/webview-*.test.ts`，共用脚手架 `src-源码/test/helpers/webview-harness.ts`。

脚手架做的事：

1. 在内存里 `new JSDOM(...)` 起一个接近 webview 的 DOM。
2. 合成和 `CsvEditorProvider` 生成的表格一模一样的 HTML 骨架（表头 / 序号列 / tbody / 浮动面板占位 / 查找替换 widget 占位）。
3. 在 JSDOM 里 mock `acquireVsCodeApi`，把所有 `postMessage` 记到 `harness.posted`。
4. patch `Element.getBoundingClientRect`，让行高拖拽这种依赖坐标的热区能算对。

具体覆盖：

- `webview-column-filter.test.ts` · 多列组合过滤弹窗、chip 删除、状态同步
- `webview-sort-button.test.ts` · 排序按钮三态循环
- `webview-row-resize.test.ts` · 拖动行底边调整行高
- `webview-reorder-interactions.test.ts` · 列 / 行 reorder
- `webview-size-persistence.test.ts` · 行高/列宽持久化
- `webview-remote-chunking.test.ts` · 分块加载的 requestChunk / chunkData 交互
- `webview-native-find.test.ts` · Ctrl/Cmd+F 唤出原生 Find
- `webview-find-replace-widget.test.ts` · 自研 Find Replace widget
- `webview-edit-shortcuts.test.ts` · Enter/Tab/Esc 的编辑键流
- `webview-navigation-shortcuts.test.ts` · 方向键 / PageUp / PageDown
- `webview-link-interactions.test.ts` · Ctrl/Cmd+Click 打开链接
- `webview-zoom-shortcuts.test.ts` · Ctrl/Cmd+wheel / +/-/0 缩放

写 webview 交互单测时，先**扩 harness 的骨架 DOM**，再写断言——否则 `main.js` 启动时 `querySelector` 找不到元素会直接 throw。

## 第 3 层：Playwright 真浏览器 E2E

位置：`e2e-端到端/`。

脚手架 `harness.ts` 做的事：

1. 读 `media-媒体/main.js` 的完整源码。
2. 拼一段自包含 HTML：provider 风格的 DOM + shim 的 `acquireVsCodeApi`（把 `postMessage` 存到 `window.__posted`）+ 整段内联的 `main.js` 和 `webviewFilterPanel.js`。
3. 写到 OS 临时目录 `csv-pro-e2e-XXXXXX/index.html`，返回 `file://` URL。
4. Playwright `page.goto(url)` 加载后就是**真 Chromium 跑真 main.js**，不经 jsdom、也不开 VS Code Electron。

E2E 覆盖：

- `sort-tri-state.spec.ts` · 排序按钮三态 `asc → desc → resetSort → asc`、切列归零、点表头文字不触发排序、初始页面截图
- `float-panel.spec.ts` · 过滤输入（200ms debounce）、`setRowHeightMode` 循环、清除按钮按输入值显藏、`filterSortResult` 消息回来时 tbody 能被重建

### 什么情况下加 E2E（而非 jsdom）

| 场景                                 | 选哪层     |
| ---------------------------------- | ------- |
| 纯 JS 函数 / 状态机                      | Node 单测 |
| "用 jsdom 模拟一下点击事件"                 | jsdom   |
| "真的能被点到吗？" / 坐标 / CSS 过渡 / 鼠标光标    | E2E     |
| 检查页面上 widget **真的有被渲染**            | E2E     |
| 想要失败时留截图 + trace.zip 给别人复现         | E2E     |

## 回归验证（Regression Probe）

测试合格的标准不是"绿"，而是**"破坏实现后它一定红"**。本项目的通用做法：

1. 写好新测试，让它绿。
2. 在实现代码里**临时注释 / 加一个 `return` / 把条件改成 `&& false`**，破坏这个新行为。
3. 再跑一遍，确认新测试会失败，且失败信息能指向正确的 bug。
4. 恢复实现，再跑一遍保持绿。

示例（来自 `sort-tri-state.spec.ts` 的提交）：

```js
// 恢复前：三态循环
// 破坏：改成 2 态切换
currentSortAsc = !currentSortAsc;
vscode.postMessage({ type: 'sortColumn', index: col, ascending: currentSortAsc });
```

```
✖ 3rd click on same column → resetSort
  expected 'resetSort', got 'sortColumn'
```

这一步要求每个加测试的 PR 都执行；它是回答"你真的测过么"唯一有力的证据。

## 调试失败的 E2E

1. 读 `npm run test:e2e` 输出里的 "Error Context" 行，它会给出 `error-context.md` 的路径，里面是 Playwright 自动生成的现场。
2. 看 `e2e-端到端/test-results/<case>/test-failed-1.png` 失败截图，判断 DOM 长成什么样。
3. `npx playwright show-trace e2e-端到端/test-results/<case>/trace.zip` —— 会启一个本地 UI，能按步骤回放、看每个动作前后的 DOM snapshot，甚至网络请求。
4. 想"肉眼盯着浏览器看怎么跑"：

```bash
npx playwright test \
    --config e2e-端到端/playwright.config.ts \
    --headed --slowmo 500
```

## CI 建议

如果后续加 CI，最小集合是：

```yaml
- npm ci
- npx playwright install chromium --with-deps
- npm test
- npm run test:e2e
```

Playwright 在 GitHub Actions 上跑稳定；时间成本 < 2 分钟。
