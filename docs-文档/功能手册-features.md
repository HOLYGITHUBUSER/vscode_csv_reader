# 功能手册

面向最终用户和写测试的开发者：扩展**能做什么**，在 UI 上**长什么样**，在配置里**怎么控**。

## 核心体验

- **表格化编辑**：打开 `.csv/.tsv/.tab/.psv` 自动变电子表格界面；点单元格进入编辑，Enter / Tab 落选。
- **固定表头**：长表滚动时首行常驻，自动识别表头（或手动指定"隐藏前 N 行"）。
- **智能列宽**：首次渲染按内容计算；拖动列右边框可手动调整；所有手改都会持久化。
- **自动着色**：识别每列的主要类型（布尔 / 日期 / 整数 / 浮点 / 文本）分配色相；也可以切到"主题前景色"单色模式。
- **分块渲染**：大文件不会一次塞进 DOM；滚动到哪加载到哪，开百万行也秒开。

## 右下角浮动面板

```
╭──────────────────── 列过滤 ────────────────────╮ ╭ 行高 ╮
│ [选择列] [包含/等于] [过滤词] [忽略大小写] [忽略空格] [添加] [清空] │
│ [3. sub_category 包含/忽略大小写: hello] [5. status 等于: active] │
╰────────────────────────────────────────────────╯
```

组成（从左到右）：

| 控件                                  | 行为                                                                 |
| ----------------------------------- | ------------------------------------------------------------------ |
| `#csvColumnFilterColumn` 下拉框        | 选择要过滤的列，列名来自当前表头；适合宽表和 50MB 大文件                                  |
| `#csvColumnFilterMode` 下拉框          | 选择匹配方式：`包含` 或 `等于`                                                       |
| `#csvColumnFilterValue` 输入框         | 输入过滤词；按 `Enter` 或点"添加"生成一个列条件；添加后继续聚焦，方便连续添加                      |
| `#csvColumnFilterIgnoreCase`          | 勾选后忽略大小写；默认开启，保留旧版包含匹配体验                                            |
| `#csvColumnFilterIgnoreWhitespace`    | 勾选后会删除单元格和值里的所有空白字符再比较，例如 `A B` 可匹配 `AB`                            |
| `#csvColumnFilterClear` 按钮           | 有列过滤条件时显示；点击清空全部列条件并重新过滤                                           |
| `.csv-filter-chip`                    | 单行展示当前列过滤条件；点击 chip 上的 `×` 只删除这一个条件并立即刷新结果；"清空列过滤"一次删除全部列条件 |
| `#csvRowHeightToggle` 按钮            | 切换 `紧凑 ↔ 自然折行`；按钮自带 `data-mode` 和中文文字；发 `setRowHeightMode` |

过滤语义：多个列过滤之间是 `AND`。也就是说，某行必须同时满足每个列条件才会保留。服务器端回 `filterSortResult` 时，前端只重建首个结果分块，后续结果继续按 chunk 加载，并同步列过滤 chips。

> **自动化测试**：见 `src-源码/test/webview-column-filter.test.ts`、`src-源码/test/provider-utils.test.ts` 和 `e2e-端到端/float-panel.spec.ts`。

## 三态排序按钮

每列表头右侧有个小箭头按钮。**只在点这个按钮时触发排序**（点表头文字本身不会），降低误触。

| 当前状态 | 点击后      | 箭头显示 | 后端动作            |
| ---- | -------- | ---- | --------------- |
| 未排序  | 升序（A-Z） | ↑    | `sortColumn asc`  |
| 升序   | 降序（Z-A） | ↓    | `sortColumn desc` |
| 降序   | 回到原始顺序   | ·    | `resetSort`       |

实现细节（开发者向）：

- 后端在第一次 sort 时用 `sortSnapshotText` 保存**未排序**的整段文档文本。
- 第二次、第三次 sort **不覆盖** snapshot——所以"原始"永远是第一次排序前的那个状态。
- `resetSort` 把文档替换回 snapshot 并清空。
- **任何非排序的文档改动**（editCell / insertRow / deleteColumn 等）都会 invalidate 这个 snapshot——保证"原始"始终意味着"你最近一次动手编辑之后的那个样子"。

状态机单测在 `src-源码/test/sort-snapshot.test.ts`，jsdom 级交互在 `src-源码/test/webview-sort-button.test.ts`，Playwright 真浏览器在 `e2e-端到端/sort-tri-state.spec.ts`。

## 命令面板

`Ctrl/Cmd+Shift+P` 后搜 `CSV_CUSTOM_PRO`：

| 命令                                        | 作用                             |
| ----------------------------------------- | ------------------------------ |
| `CSV_CUSTOM_PRO: 切换扩展启用/禁用`                | 临时关闭自定义编辑器，回到纯文本               |
| `CSV_CUSTOM_PRO: 切换可点击链接`                  | 单元格里的 URL 要不要 Ctrl/Cmd+Click 跳 |
| `CSV_CUSTOM_PRO: 切换行高模式（紧凑/自然折行）`         | 跟右下角行高按钮等价                     |
| `CSV_CUSTOM_PRO: 切换序号列`                    | 最左侧"行号列"的显示/隐藏                |
| `CSV_CUSTOM_PRO: 更改分隔符`                    | 弹窗选 `,`/`;`/`\t`/`|`/`\` 等     |
| `CSV_CUSTOM_PRO: 重置分隔符`                    | 恢复按扩展名/文件名推断                   |
| `CSV_CUSTOM_PRO: 更改字体`                     | 单独给表格设字体族，不影响编辑器               |
| `CSV_CUSTOM_PRO: 隐藏前N行`                    | 把 meta/注释挡掉，表头自动落到第 N+1 行       |
| `CSV_CUSTOM_PRO: 更改文件编码`                   | 切 gbk / gb18030 / utf-8 等      |

## 快捷键

| 操作   | 快捷键                    |
| ---- | ---------------------- |
| 移动选择 | 箭头键                    |
| 横向移动 | Tab / Shift+Tab        |
| 复制   | Ctrl/Cmd + C           |
| 粘贴   | Ctrl/Cmd + V           |
| 查找   | Ctrl/Cmd + F           |
| 替换   | Ctrl/Cmd + H           |
| 全选   | Ctrl/Cmd + A           |
| 缩放   | Ctrl/Cmd + +/-/0 或鼠标滚轮 |

粘贴带网格感知：在一个矩形选区里粘 "name\tage" 这种分隔的文本会一次性铺开；单步 undo/redo 能整体回退。

## 全局配置项

写在 VS Code 的 `settings.json` 里或通过 UI Settings 改：

| 设置项                        | 类型      | 默认值       | 说明                             |
| -------------------------- | ------- | --------- | ------------------------------ |
| `csv.enabled`              | boolean | true      | 启用/禁用自定义编辑器                    |
| `csv.fontFamily`           | string  | 空         | 字体族，空则继承编辑器设置                  |
| `csv.fontSize`             | number  | 0         | 字体大小（px），0 则继承编辑器设置            |
| `csv.mouseWheelZoom`       | boolean | true      | 启用鼠标滚轮缩放                       |
| `csv.mouseWheelZoomInvert` | boolean | false     | 反转缩放方向                         |
| `csv.cellPadding`          | number  | 4         | 单元格内边距（px）                     |
| `csv.columnColorMode`      | string  | type      | 列颜色模式：type（类型着色）或 theme（主题前景色） |
| `csv.columnColorPalette`   | string  | default   | 类型颜色调色板：default、cool、warm      |
| `csv.clickableLinks`       | boolean | true      | 使 URL 可点击                      |
| `csv.showTrailingEmptyRow` | boolean | true      | 显示末尾空行                         |
| `csv.separatorMode`        | string  | extension | 分隔符选择模式                        |
| `csv.defaultSeparator`     | string  | `,`       | 默认分隔符                          |
| `csv.rowHeightMode`        | string  | compact | 行高模式：compact、wrap              |
| `csv.maxFileSizeMB`        | number  | 100       | 文件大小限制（MB），0 表示不限制             |

## 每文件设置

除了全局，还可以 per-file 覆盖（扩展会记到内部存储里，不污染你的 `settings.json`）：

- 是否显示序号列
- 分隔符覆盖（例如打开一个命名成 `.csv` 但实际是分号的文件）
- 隐藏前 N 行（meta 注释挡住的情形）

所有 per-file 设置都挂在 `CsvEditorProvider` 的 per-URI state 里；细节见 `src-源码/test/provider-state.test.ts`。

## 支持的文件格式

- `.csv` · 逗号
- `.tsv` · 制表符
- `.tab` · 制表符（别名）
- `.psv` · 竖线

单独想对某个后缀换分隔符，用命令面板里的 "CSV_CUSTOM_PRO: 更改分隔符"，会只影响当前文件。
