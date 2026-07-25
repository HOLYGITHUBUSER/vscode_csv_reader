# 安装包目录

| 文件 | 说明 |
| --- | --- |
| `csv-custom-pro-latest.vsix` | 稳定安装包（请用这个） |
| `build-info-构建信息.md` | 最近一次打包元信息（自动生成） |

```bash
npm run package:force
cursor --install-extension 07-artifacts-安装包/csv-custom-pro-latest.vsix --force
```

时间戳 `.vsix` 仅本地临时保留（gitignore）；根目录禁止放安装包。
