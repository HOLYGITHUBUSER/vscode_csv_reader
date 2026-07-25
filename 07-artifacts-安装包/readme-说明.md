# 安装包目录

## 一键编译打包（推荐）

在仓库根目录执行：

```bash
python3 03-script-构建脚本/build-编译打包.py
```

等同于：`npm run package:force`（先 `tsc` 再打 VSIX）。

升版本再打包：

```bash
python3 03-script-构建脚本/build-编译打包.py --bump
# 或
npm run package
```

## 产物

| 文件 | 含义 |
| --- | --- |
| `csv-custom-pro-v1.4.0-YYYYMMDD-HHmmss.vsix` | **唯一保留的安装包**（版本 + 时间戳） |
| `build-info-构建信息.md` | 版本 / commit / sha256（自动生成） |

每次打包后会自动删掉旧的 `*.vsix`，只留最新 1 个。

## 安装

```bash
cursor --install-extension 07-artifacts-安装包/csv-custom-pro-v1.4.0-….vsix --force
```

安装后：`Developer: Reload Window`。
