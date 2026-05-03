# CSV Custom Pro

![CSV Custom Pro 图标](images-图片/icon.png)

专为 VS Code / Cursor / Windsurf 打造的高级 CSV 编辑器，提供类电子表格的交互体验：表格化编辑、智能列宽、类型着色、分块渲染、三态排序、全局过滤、查找替换。

## 最新成品

- 最新安装包（稳定文件名）：[`dist-产物/csv-custom-pro-latest.vsix`](dist-产物/csv-custom-pro-latest.vsix)
- 构建信息（版本 / commit / sha256）：[`dist-产物/BUILD-INFO.md`](dist-产物/BUILD-INFO.md)
- 历史时间戳版本保留在 [`dist-产物/`](dist-产物/)。

## 试用示例

装好扩展后，可直接在 VS Code / Cursor / Windsurf 打开这个大样例体验：

- [`test-示例/ultimate-50mb-完整压力测试.csv`](test-示例/ultimate-50mb-%E5%AE%8C%E6%95%B4%E5%8E%8B%E5%8A%9B%E6%B5%8B%E8%AF%95.csv) —— 约 50 MiB、64 列，集中覆盖大文件加载、分块渲染、横向滚动、排序、过滤、查找替换、折行、链接和编辑保存。

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
    --install-extension dist-产物/csv-custom-pro-latest.vsix --force
```

## 文档

完整中文文档在 [`docs-文档/`](docs-文档/README.md)：

- [目录结构](docs-文档/目录结构-directory-layout.md) —— 仓库里每个目录的职责
- [开发指南](docs-文档/开发指南-development.md) —— npm 脚本、F5 调试、提交约定
- [功能手册](docs-文档/功能手册-features.md) —— 快捷键 / 命令 / 配置项 / 浮动面板 / 三态排序
- [测试指南](docs-文档/测试指南-testing.md) —— Node / jsdom / Playwright 三层策略
- [打包与发布](docs-文档/打包与发布-packaging-release.md) —— VSIX 打包与装到 Cursor / Windsurf
- [变更日志](docs-文档/变更日志-changelog.md) —— 1.3.x 的版本演进

## 许可证

[MIT License](LICENSE)
