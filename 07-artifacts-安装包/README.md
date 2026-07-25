# 安装包目录

本目录只放 **可安装产物**，不参与扩展运行时加载。

## 保留约定

| 文件 | 是否跟踪 | 说明 |
| --- | --- | --- |
| `csv-custom-pro-latest.vsix` | 建议保留 | 稳定文件名，安装/分发用这个 |
| `BUILD-INFO.md` | 建议保留 | 最近一次打包的版本 / commit / sha256 |
| `csv-custom-pro-<version>-<YYYYMMDD-HHmmss>.vsix` | 本地临时 | 打包脚本只保留最近 **2** 个；git 默认忽略 |

## 生成

```bash
npm run package:force   # 不升版本，打最新包
# 或
npm run package         # 视 package.json scripts 定义（可能升版本）
```

## 安装

```bash
cursor --install-extension 07-artifacts-安装包/csv-custom-pro-latest.vsix --force
# 或
code --install-extension 07-artifacts-安装包/csv-custom-pro-latest.vsix --force
```

根目录不要放 `.vsix`；打包脚本会自动删掉根目录误放的包。
