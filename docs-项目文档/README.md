# 文档索引 · docs-项目文档/

本目录按主题拆分了项目的中文文档，根目录 [`README.md`](../README.md) 只做一张"名片页"，详细内容都在这里。

## 开始

- **[目录结构](目录结构-directory-layout.md)** —— 仓库里每个文件夹/关键文件的职责、命名约定、为什么要这么放。
- **[开发指南](开发指南-development.md)** —— `npm` 脚本一张表、`F5` 扩展调试、图标与版本号流程、提交/推送约定。
- **[功能手册](功能手册-features.md)** —— 快捷键、命令、`csv.*` 配置项、右下角浮动面板、三态排序等 UI 交互说明。

## 工程

- **[测试指南](测试指南-testing.md)** —— 三层测试金字塔（Node 单测 / jsdom webview / Playwright 真浏览器 E2E），以及"回归验证"的标准姿势。
- **[打包与发布](打包与发布-packaging-release.md)** —— `npm run package:bump` 的版本号递增 + 时间戳 VSIX + `latest.vsix` 副本 + `BUILD-INFO.md`；一键装进 Cursor / Windsurf。

## 记录

- **[变更日志](变更日志-changelog.md)** —— 从 1.3.0 → 1.3.5 的功能/修复/测试演进，按版本聚合。

---

## 相关外部文档

- 根目录 [`README.md`](../README.md) · 项目名片
- [`samples-试用样例/README.md`](../samples-试用样例/README.md) · 人眼试用 CSV 样例的使用说明
- [`artifacts-安装包/BUILD-INFO.md`](../artifacts-安装包/BUILD-INFO.md) · 最近一次 VSIX 的构建元信息（打包脚本自动生成）
