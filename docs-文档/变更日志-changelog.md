# 变更日志

记录可见行为 / 可发布变更。更早的源头（fork 自上游 janisdd/vscode-edit-csv）不在此列。

文档下一次打包即将发布的未定版本放在 **"下一版（规划中）"** 段。

---

## 1.3.5 — 2026-04-23

**修复**

- 右下角浮动面板（过滤输入 + 清除按钮 + 行高切换按钮）**之前没有绑定任何事件**，虽然被 `CsvEditorProvider` 渲染出来但所有点击/输入都是无效的。本版把三个控件 + `filterSortResult` 消息都接上：
  - 过滤输入：200 ms debounce，`Enter` 立即发 `filterSort`。
  - 行高按钮：支持多种行高模式循环，发 `setRowHeightMode`。
  - 清除按钮：只在输入非空时显示；点击清空并重新聚焦。
  - 后端回 `filterSortResult` 时重建 `tbody`，并同步三态排序指示。

**测试**

- 新增 `e2e-端到端/float-panel.spec.ts` —— Playwright 真浏览器 4 条断言，全部在真点击 + 键盘事件下覆盖上面 4 条行为。

---

## 1.3.4 — 2026-04-23

**测试基建**

- 新增 `e2e-端到端/` Playwright 真浏览器测试脚手架，不再只靠 jsdom：
  - `harness.ts` 生成自包含 HTML（内联 `media-媒体/main.js` + shim `acquireVsCodeApi`），通过 `file://` 让 Chromium 直接跑真前端。
  - `sort-tri-state.spec.ts` 覆盖排序按钮三态循环 + 切列归零 + 点表头文字不触发。
  - `playwright.config.ts` / `package.json#test:e2e` 接通命令。

---

## 1.3.3 — 2026-04-23

**功能**

- 排序按钮改成**三态循环**：`A-Z → Z-A → 恢复原始顺序`。
  - 后端引入 `sortSnapshotText`：第一次 sort 前抓快照；之后 sort 不覆盖；`resetSort` 把文档替回快照；任何非 sort 的文档改动都会 invalidate 快照（保证"原始"永远跟得上你最近一次编辑）。
- 右键菜单新增 "Sort: 恢复原始" 条目；按钮 tooltip 更新。

**测试**

- 新增 `src-源码/test/sort-snapshot.test.ts`（状态机单测）。
- 重写 `webview-sort-button.test.ts` 覆盖三态。

---

## 1.3.2 — 2026-04-23

**功能**

- 表头右侧新增小排序按钮，**只在按钮上点击才触发排序**（避免误触表头文字）。
- 行高拖拽热区扩展到 **任意数据单元格的底边**；`max-height` 与 `overflow` 的冲突修好，拖完不会"弹回去"。

**测试**

- 引入 `src-源码/test/helpers/webview-harness.ts` —— jsdom 版 webview 测试脚手架。
- 新增 `webview-sort-button.test.ts` 与 `webview-row-resize.test.ts`。

---

## 1.3.1 — 2026-04-23

**文档 / 组织**

- 在 README 顶部加入扩展图标。
- 新增 `test-示例/`（`complex_test.csv` + `super_example.csv`）专门给"肉眼打开试用"，与 `src-源码/test/` 下给自动化的严格样本分开。
- 修复了 `scripts/gen-huge-fixtures.py` 会把 `test-示例/` 覆盖成几十 MB 非法 CSV 的隐患（触发 VS Code 内部 `Assertion Failed`）。

---

## 1.3.0 — 2026-04-23

**基础设施重构**（此版本之前，项目目录是全英文、打包流程较散。）

- 目录改为 "英文-中文" 双轨命名：`src-源码/`、`media-媒体/`、`dist-产物/`、`images-图片/`、`config-配置/`、`test-示例/`、`docs-文档/`。
- 新增 `scripts/bump-version-版本号递增.py` 和 `scripts/package-vsix-with-timestamp-打包带时间戳.cjs`，把 "PATCH+1 / tsc / vsce package / `latest.vsix` 副本 / `BUILD-INFO.md`" 串成一条命令 `npm run package:bump`。
- 更新 `.vscodeignore`，显著缩减 VSIX 体积；把 `icon.orig.png`、`test-示例/**`、`e2e-端到端/**`、`scripts/**`、`backup/**` 等排除。
- README 改成中文版本；补全打包 / 装扩展到 Cursor / Windsurf 的说明。

---

## 1.2.x 之前

继承自 upstream 的功能（挑重要的）：

- 缩放快捷键（`Ctrl/Cmd + wheel / + / - / 0`）。
- `csv.fontSize` 独立覆盖与行高联动。
- 大文件 on-demand chunk stream，避免 "Invalid string length"。
- 矩形选区粘贴 + 单步 undo/redo。
- Diff view 感知颜色（对比模式高亮保留）。
- `csv.showTrailingEmptyRow`、`csv.maxFileSizeMB`、`csv.separatorMode`（含 PSV）、`csv.columnColorMode` / `columnColorPalette`。
- Ctrl/Cmd+Click 打开 URL。
- 表头拖动重排 + 持久化列宽/行高。
- Find / Replace 覆盖：完整文件级 chunk-aware 搜索、单步 Replace-All undo。

更早的细节见 Git 历史。
