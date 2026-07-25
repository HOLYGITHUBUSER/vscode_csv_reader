# CSV Custom Pro

![CSV Custom Pro 图标](icon-扩展图标/icon.png)

专为 VS Code / Cursor / Windsurf 打造的高级 CSV 编辑器，提供类电子表格的交互体验：表格化编辑、智能列宽、类型着色、分块渲染、窗口虚拟滚动、三态排序、多列组合过滤、查找替换、可复制全文预览。

## 最新成品

- 最新安装包：[`artifacts-安装包/csv-custom-pro-latest.vsix`](artifacts-安装包/csv-custom-pro-latest.vsix)
- 构建信息：[`artifacts-安装包/BUILD-INFO.md`](artifacts-安装包/BUILD-INFO.md)
- 产物约定：[`artifacts-安装包/README.md`](artifacts-安装包/README.md)

## 试用示例

| 样例 | 用途 |
| --- | --- |
| [`samples-试用样例/smoke-日常验收.csv`](samples-试用样例/smoke-日常验收.csv) | **日常改完先开这个**（快） |
| [`samples-试用样例/complex_test.csv`](samples-试用样例/complex_test.csv) | 边界字符 / 多行 |
| [`samples-试用样例/super_example.csv`](samples-试用样例/super_example.csv) | 中等体量 |
| [`samples-试用样例/ultimate-50mb-完整压力测试.csv`](samples-试用样例/ultimate-50mb-%E5%AE%8C%E6%95%B4%E5%8E%8B%E5%8A%9B%E6%B5%8B%E8%AF%95.csv) | 大文件性能 |

手测清单见 [`samples-试用样例/README.md`](samples-试用样例/README.md)。

## 快速开始

```bash
git clone https://github.com/HOLYGITHUBUSER/vscode_csv_reader.git
cd vscode_csv_reader
npm install              # 装依赖 + Playwright Chromium
npm test                 # Node / jsdom 单测
npm run test:e2e         # Playwright E2E
npm run package:force    # 打包 → artifacts-安装包/csv-custom-pro-latest.vsix
npm run install:cursor   # 装进 Cursor
```

## 文档

完整中文文档在 [`docs-项目文档/`](docs-项目文档/README.md)：

- [产品设计](docs-项目文档/产品设计-product.md)
- [技术架构](docs-项目文档/技术架构-architecture.md)
- [开发测试发布](docs-项目文档/开发测试发布-engineering.md)

## 目录结构

```text
vscode_csv_reader/
├─ extension-扩展逻辑/     扩展宿主 TS：解析、渲染、写回、消息、单测
├─ webview-表格界面/       表格 UI（main / 过滤面板 / 查找替换）
├─ langConfig-语言配置/    CSV/TSV 语言贡献
├─ icon-扩展图标/          扩展图标
├─ build-构建脚本/         版本号、打包、图标处理
├─ e2e-浏览器测试/         Playwright 真浏览器测试
├─ samples-试用样例/       手工试用 CSV
├─ docs-项目文档/          产品 / 架构 / 工程
├─ artifacts-安装包/       latest.vsix + BUILD-INFO（安装用）
├─ out/                    tsc 产物（可删重建）
├─ node_modules/           npm 依赖（可删重装）
└─ backup-归档旧文件/      本地归档（gitignore，不进 VSIX）
```

更细的模块说明见 [技术架构](docs-项目文档/技术架构-architecture.md)。

## 许可证

[MIT License](LICENSE)
