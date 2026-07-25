# 命名规范

全仓库统一用下面范式，新增文件/目录必须遵守。

## 总原则

| 层级 | 范式 | 示例 |
| --- | --- | --- |
| 顶层目录 | `{两位序号}-{en-kebab}-{中文}` | `01-extension-扩展逻辑/` |
| 人读文档 | `{en}-{中文}.md` | `product-产品设计.md` |
| 构建脚本 | `{en-kebab}-{中文}.{ext}` | `package-vsix-打包.cjs` |
| 样例数据 | `{en}-{中文}.{ext}` | `smoke-日常验收.csv` |
| Webview | `webview-{en-kebab}.js` | `webview-filter-panel.js` |
| 扩展 TS | 英文；类 PascalCase，模块 csv+camelCase | `csvRender.ts` |

## 顶层编号排序

```text
00-config-工程配置/        # 工程元数据（图标/tsconfig/语言/LICENSE）
01-extension-扩展逻辑/     # 源码
02-webview-表格界面/       # 前端
03-script-构建脚本/        # 构建
04-samples-试用样例/       # 样例
05-e2e-浏览器测试/         # E2E
06-docs-项目文档/          # 文档
07-artifacts-安装包/       # 产物
99-backup-归档旧文件/      # 死代码（本地隐藏）
```

根目录仅保留生态必需文件：`package.json`、`README.md`（`package-lock.json` / `.gitignore` 等侧栏隐藏）。

## 扩展 TypeScript

- 入口：`extension.ts`
- Provider：`CsvEditorProvider.ts`
- 领域模块：`csvRender.ts` 等
- 测试：`01-extension-扩展逻辑/test/`

## Webview

| 文件 | 职责 |
| --- | --- |
| `webview-main.js` | 表格主逻辑 |
| `webview-filter-panel.js` | 过滤面板 |
| `webview-find-replace.js` | 查找替换 |

## 禁止

- 无编号的顶层业务目录
- 根目录堆散文件（图标、配置、license 等进 `00-config`）
- camelCase 目录名
