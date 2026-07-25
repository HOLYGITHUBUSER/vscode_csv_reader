# CSV Custom Pro

![CSV Custom Pro 图标](icon-扩展图标/icon.png)

专为 VS Code / Cursor / Windsurf 打造的高级 CSV 编辑器：表格编辑、类型着色、分块渲染、窗口虚拟滚动、排序过滤、查找替换、可复制全文预览。

## 最新成品

- 安装包：[`artifacts-安装包/csv-custom-pro-latest.vsix`](artifacts-安装包/csv-custom-pro-latest.vsix)
- 构建信息：[`artifacts-安装包/BUILD-INFO.md`](artifacts-安装包/BUILD-INFO.md)
- 产物约定：[`artifacts-安装包/README.md`](artifacts-安装包/README.md)

## 试用示例

| 样例 | 用途 |
| --- | --- |
| [`samples-试用样例/smoke-日常验收.csv`](samples-试用样例/smoke-日常验收.csv) | **日常改完先开** |
| [`samples-试用样例/complex-边界用例.csv`](samples-试用样例/complex-边界用例.csv) | 边界字符 / 多行 |
| [`samples-试用样例/super-中等样例.csv`](samples-试用样例/super-中等样例.csv) | 中等体量 |
| [`samples-试用样例/stress-50mb-压力测试.csv`](samples-试用样例/stress-50mb-压力测试.csv) | 大文件性能 |

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
| [产品设计](docs-项目文档/product-产品设计.md) | 功能与交互 |
| [技术架构](docs-项目文档/architecture-技术架构.md) | 模块与数据流 |
| [开发测试发布](docs-项目文档/engineering-开发测试发布.md) | 工程流程 |
| [命名规范](docs-项目文档/naming-命名规范.md) | **目录/文件统一范式** |

## 目录结构

命名范式：`{en-kebab}-{中文}`（详见 [命名规范](docs-项目文档/naming-命名规范.md)）。

```text
vscode_csv_reader/
├─ extension-扩展逻辑/     扩展宿主 TS + 单测
├─ webview-表格界面/       webview-*.js 表格 UI
├─ lang-语言配置/          CSV/TSV 语言贡献
├─ icon-扩展图标/          图标
├─ script-构建脚本/         工程构建：升版本 / 打包
├─ e2e-浏览器测试/         Playwright
├─ samples-试用样例/       手工 CSV
├─ docs-项目文档/          product / architecture / engineering / naming
├─ artifacts-安装包/       latest.vsix + BUILD-INFO
├─ out/                    tsc 产物
└─ backup-归档旧文件/      死代码与一次性工具归档（gitignore）
```

## 许可证

[MIT License](LICENSE)
