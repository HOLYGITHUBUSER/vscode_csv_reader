# 打包与发布

把扩展做成 `.vsix` 装进 Cursor / VS Code / Windsurf 的完整流程。

## 常用一行

```bash
npm run package:bump
```

这条命令做 **3 件事**：

1. `scripts/bump-version-版本号递增.py` —— 把 `package.json` 的 PATCH 号 +1（例如 `1.3.4` → `1.3.5`）。
2. `npm run compile` —— 出新的 `out/`。
3. `scripts/package-vsix-with-timestamp-打包带时间戳.cjs` —— 调用 `vsce package` 打包，并做"时间戳 + latest 副本 + BUILD-INFO.md"三件套。

执行完会在 `dist-产物/` 下看到：

```
dist-产物/
├─ csv-custom-pro-1.3.5-20260423-012420.vsix   本次时间戳版本
├─ csv-custom-pro-latest.vsix                  永远指向最新的那份（被覆盖）
└─ BUILD-INFO.md                               版本 / commit / sha256 / 大小
```

## 只打包不升版本

```bash
npm run package
```

场景：改的是 README / 图标 / 文档，不需要 bump PATCH。

## 只升版本不打包

```bash
npm run compile:bump
```

场景：要在调试窗口试，不出 VSIX。

## 什么会进 VSIX

由 **`.vscodeignore`** 决定。**白名单思路不太准确**——VSIX 默认包含仓库里所有东西，`.vscodeignore` 是黑名单。当前排除的：

```
.vscode/**                       IDE 本地配置
.vscode-test/**                  vscode-test 跑测试的缓存
src-源码/**                      源码（只发编译好的 out/）
config-配置/eslint-*.mjs         lint 配置
config-配置/vscode-test-*.mjs    测试配置（不是运行时必需）
scripts/**                       构建脚本
backup/**                        归档
docs-文档/**                     中文文档（装扩展的人不需要）
dist-产物/**                     之前的包（不让套娃）
.gitignore / .yarnrc / tsconfig / eslint.config / *.ts / *.map
out/test/**                     测试产物
images-图片/Screenshot_*.png    截图
images-图片/*.orig.png          图标原图（保留不处理的那份不进 VSIX）
test-示例/**                    人眼试用样例
e2e-端到端/**                   E2E 测试
```

装扩展的用户最终拿到的就是：

- `out/`（编译后的扩展 JS）
- `media-媒体/main.js`
- `images-图片/icon.png`
- `config-配置/language-语言配置.json`
- `package.json` / `README.md` / `LICENSE`

打包完建议去 `dist-产物/BUILD-INFO.md` 确认"文件大小"在 1.4 MB 上下——显著变大基本是没排对某个资产。

### 检查 VSIX 真的排对了

```bash
unzip -l dist-产物/csv-custom-pro-latest.vsix | head -30
```

## 装进 Cursor / Windsurf

两边都支持 `--install-extension <vsix>` CLI：

```bash
# Cursor
/Applications/Cursor.app/Contents/Resources/app/bin/cursor \
    --install-extension dist-产物/csv-custom-pro-latest.vsix --force

# Windsurf
/Applications/Windsurf.app/Contents/Resources/app/bin/windsurf \
    --install-extension dist-产物/csv-custom-pro-latest.vsix --force

# 普通 VS Code
code --install-extension dist-产物/csv-custom-pro-latest.vsix --force
```

`--force` 会覆盖已装的同 id 扩展。装完需要：

```
Cmd/Ctrl+Shift+P → Developer: Reload Window
```

装完怎么肉眼验证：

1. `Cmd/Ctrl+Shift+X` 打开扩展列表，搜 `csv-custom-pro`，看版本号对不对。
2. 打开 `test-示例/ultimate-50mb-完整压力测试.csv`，能看到约 50 MiB 的大表格 → 扩展生效。
3. 点表头右侧的小排序按钮，验证三态 A→Z → Z→A → 原始。
4. 在右下角小面板输入关键字，观察表格过滤生效。
5. 点右下角行高按钮切换"紧凑 / 自然折行"。

（上面这 5 条就是 [测试指南](测试指南-testing.md) 第 3 层 Playwright 覆盖的场景——**肉眼 5 步** + **自动 5 条** 是本项目做的交叉检查。）

## BUILD-INFO.md 是什么

每次打包脚本都会重写 `dist-产物/BUILD-INFO.md`，里面有：

- 本地打包时间
- 版本号
- Git 分支 / commit（如果工作区脏会标 "有未提交改动"）
- 最新时间戳文件名 & 大小 & SHA-256
- 指向 `csv-custom-pro-latest.vsix` 的链接

所以根目录 [`README.md`](../README.md) 里的"最新成品"只需挂一个不变的链接：

```md
- 最新安装包：[`dist-产物/csv-custom-pro-latest.vsix`](dist-产物/csv-custom-pro-latest.vsix)
- 构建信息：[`dist-产物/BUILD-INFO.md`](dist-产物/BUILD-INFO.md)
```

## 发布到 Marketplace（可选，目前未做）

如果以后想挂公开 Marketplace：

1. 在 [https://dev.azure.com/](https://dev.azure.com/) 拿 PAT。
2. `npx vsce login <publisher>`。
3. 在 CI 或本地 `npx vsce publish -p $VSCE_TOKEN`。

目前工作流是"本地出包 + 本地 `--install-extension`"，没走 Marketplace，所以这条只是备忘。
