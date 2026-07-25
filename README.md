# CSV Custom Pro

![CSV Custom Pro 图标](00-config-工程配置/icon-扩展图标.png)

专为 VS Code / Cursor / Windsurf 打造的高级 CSV 编辑器：表格编辑、类型着色、分块渲染、窗口虚拟滚动、排序过滤、查找替换、可复制全文预览。

## 最新成品

- 安装包：[`07-artifacts-安装包/csv-custom-pro-latest.vsix`](07-artifacts-安装包/csv-custom-pro-latest.vsix)
- 构建信息：[`07-artifacts-安装包/build-info-构建信息.md`](07-artifacts-安装包/build-info-构建信息.md)

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
# 编译 + 打包到 07-artifacts-安装包/（Python 一条命令即可）
python3 03-script-构建脚本/build-编译打包.py
npm run install:cursor
```

## 文档

| 文档 | 内容 |
| --- | --- |
| [`01-product-产品设计.md`](06-docs-项目文档/01-product-产品设计.md) | 定位、交互、产品决策 |
| [`02-handbook-工程手册.md`](06-docs-项目文档/02-handbook-工程手册.md) | 目录命名、模块、测试、打包安装 |

## 目录结构（编号排序，根目录极简）

```text
vscode_csv_reader/
├─ 00-config-工程配置/       图标 / tsconfig / 许可证
├─ 01-extension-扩展逻辑/    ★ 扩展宿主源码 + 单测
├─ 02-webview-表格界面/      ★ 表格 UI
├─ 03-script-构建脚本/       升版本 / 打包
├─ 04-samples-试用样例/      手测 CSV
├─ 05-e2e-浏览器测试/        Playwright
├─ 06-docs-项目文档/         文档
├─ 07-artifacts-安装包/      latest.vsix
├─ package.json              npm / 扩展清单（必须在根）
└─ README.md
```

根目录只保留 GitHub/npm 必需的 `package.json` 与 `README.md`；  
`package-lock.json`、`.gitignore` 等在资源管理器中默认隐藏。

## 许可证

[MIT License](00-config-工程配置/license-许可证.txt)
