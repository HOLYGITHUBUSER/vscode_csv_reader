# CSV Custom Pro

![CSV Custom Pro 图标](icon.png)

专为 VS Code / Cursor / Windsurf 打造的高级 CSV 编辑器：表格编辑、类型着色、分块渲染、窗口虚拟滚动、排序过滤、查找替换、可复制全文预览。

## 最新成品

- 安装包：[`07-artifacts-安装包/csv-custom-pro-latest.vsix`](07-artifacts-安装包/csv-custom-pro-latest.vsix)
- 构建信息：[`07-artifacts-安装包/BUILD-INFO.md`](07-artifacts-安装包/BUILD-INFO.md)
- 产物约定：[`07-artifacts-安装包/README.md`](07-artifacts-安装包/README.md)

## 试用示例

| 样例 | 用途 |
| --- | --- |
| [`04-samples-试用样例/smoke-日常验收.csv`](04-samples-试用样例/smoke-日常验收.csv) | **日常改完先开** |
| [`04-samples-试用样例/complex-边界用例.csv`](04-samples-试用样例/complex-边界用例.csv) | 边界字符 / 多行 |
| [`04-samples-试用样例/super-中等样例.csv`](04-samples-试用样例/super-中等样例.csv) | 中等体量 |
| [`04-samples-试用样例/stress-50mb-压力测试.csv`](04-samples-试用样例/stress-50mb-压力测试.csv) | 大文件性能 |

## 快速开始

```bash
git clone https://github.com/HOLYGITHUBUSER/vscode_csv_reader.git
cd vscode_csv_reader
npm install
npm test
npm run test:e2e
npm run package:force
npm run install:cursor
```

## 文档

| 文档 | 说明 |
| --- | --- |
| [产品设计](06-docs-项目文档/product-产品设计.md) | 功能与交互 |
| [技术架构](06-docs-项目文档/architecture-技术架构.md) | 模块与数据流 |
| [开发测试发布](06-docs-项目文档/engineering-开发测试发布.md) | 工程流程 |
| [命名规范](06-docs-项目文档/naming-命名规范.md) | 编号目录 / 文件范式 |

## 目录结构（编号排序）

范式：`{两位序号}-{en-kebab}-{中文}`，资源管理器按数字自然排序。

```text
vscode_csv_reader/
├─ 01-extension-扩展逻辑/    ★ 扩展宿主 TS + 单测
├─ 02-webview-表格界面/      ★ 表格 UI（webview-*.js）
├─ 03-script-构建脚本/       升版本 / 打包
├─ 04-samples-试用样例/      手工 CSV
├─ 05-e2e-浏览器测试/        Playwright
├─ 06-docs-项目文档/         文档
├─ 07-artifacts-安装包/      latest.vsix
├─ 99-backup-归档旧文件/     死代码归档（本地，默认隐藏）
├─ icon.png
├─ language-语言配置.json
├─ package.json / tsconfig.json / out / node_modules
└─ （node_modules、out 等在侧栏默认隐藏）
```

## 许可证

[MIT License](LICENSE)
