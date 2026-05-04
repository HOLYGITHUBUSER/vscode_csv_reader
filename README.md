# CSV Custom Pro

![CSV Custom Pro 图标](icon-扩展图标/icon.png)

专为 VS Code / Cursor / Windsurf 打造的高级 CSV 编辑器，提供类电子表格的交互体验：表格化编辑、智能列宽、类型着色、分块渲染、三态排序、多列组合过滤、查找替换。

## 最新成品

- 最新安装包（稳定文件名）：[`artifacts-安装包/csv-custom-pro-latest.vsix`](artifacts-安装包/csv-custom-pro-latest.vsix)
- 构建信息（版本 / commit / sha256）：[`artifacts-安装包/BUILD-INFO.md`](artifacts-安装包/BUILD-INFO.md)
- 历史时间戳版本保留在 [`artifacts-安装包/`](artifacts-安装包/)。

## 试用示例

装好扩展后，可直接在 VS Code / Cursor / Windsurf 打开这个大样例体验：

- [`samples-试用样例/ultimate-50mb-完整压力测试.csv`](samples-试用样例/ultimate-50mb-%E5%AE%8C%E6%95%B4%E5%8E%8B%E5%8A%9B%E6%B5%8B%E8%AF%95.csv) —— 约 50 MiB、64 列，集中覆盖大文件加载、分块渲染、横向滚动、排序、过滤、查找替换、折行、链接和编辑保存。

## 快速开始

```bash
git clone <repo>
cd csv-reader-pro-for-vscode
npm install              # 装依赖 + Playwright Chromium
npm test                 # Node 层 110 条测试
npm run test:e2e         # Playwright 真浏览器 E2E
npm run package:bump     # PATCH+1 → tsc → 打 VSIX（带时间戳）
```

装进 Cursor：

```bash
/Applications/Cursor.app/Contents/Resources/app/bin/cursor \
    --install-extension artifacts-安装包/csv-custom-pro-latest.vsix --force
```

## 文档

完整中文文档在 [`docs-项目文档/`](docs-项目文档/README.md)：

- [产品设计](docs-项目文档/产品设计-product.md) —— 产品定位、功能规格、交互说明和产品决策记录
- [技术架构](docs-项目文档/技术架构-architecture.md) —— 目录结构、模块职责、消息流和大文件策略
- [开发测试发布](docs-项目文档/开发测试发布-engineering.md) —— 本地开发、测试分层、完整验收、打包安装

## 目录结构

```text
vscode_csv_reader/
├─ extension-扩展逻辑/          VS Code 扩展侧 TypeScript 源码、纯逻辑模块和单元测试
├─ webview-表格界面/        webview 前端脚本：表格交互、过滤面板、查找替换
├─ langConfig-语言配置/       CSV/TSV/PSV 语言配置
├─ icon-扩展图标/       扩展图标与图片资产
├─ docs-项目文档/         中文项目文档
├─ scripts/           版本号、图标处理、VSIX 打包脚本
├─ e2e-浏览器测试/        Playwright 真浏览器端到端测试
├─ samples-试用样例/         手工试用/压力测试 CSV 样例
├─ artifacts-安装包/         打包后的 VSIX 与 BUILD-INFO.md
├─ out/               TypeScript 编译产物，可删除后重建
├─ node_modules/      npm 依赖，可删除后重装
└─ backup-归档旧文件/            归档旧文件，不进 VSIX
```

详细说明见 [`docs-项目文档/技术架构-architecture.md`](docs-项目文档/技术架构-architecture.md)。

## 许可证

[MIT License](LICENSE)
