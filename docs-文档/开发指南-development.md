# 开发指南

面向在本仓库修改代码的开发者。前置：Node ≥ 18（Playwright 需要）、Python 3（脚本用）、VS Code 或 Cursor 或 Windsurf。

## 一次性准备

```bash
git clone <repo>
cd csv-reader-pro-for-vscode
npm install          # 装依赖 + 拉 Playwright 浏览器
```

npm install 过程会**自动下载 Chromium** 给 Playwright 用。如果网络拦了，可以单独跑 `npx playwright install chromium`。

## npm 脚本一张表

| 脚本                    | 干什么                                                                 | 何时用                 |
| --------------------- | ------------------------------------------------------------------- | ------------------- |
| `npm run compile`     | `tsc -p ./`，把 `src-源码/` 编译到 `out/`                                  | 修完 TS 想手动检查         |
| `npm run compile:bump`| 把 `package.json` 的 patch 号 +1 再编译                                   | 改完要试装之前             |
| `npm run lint`        | ESLint 扫 `src-源码/**/*.ts`                                           | CI / 提交前            |
| `npm test`            | `compile` + Node test runner 跑 `out/test/**/*.test.js`（约 110 条）      | 改完逻辑 / 加完单测         |
| `npm run test:webview`| 只跑 webview-\* 那批 jsdom 测试                                           | 调 webview 交互时加速反馈   |
| `npm run test:e2e`    | Playwright 真 Chromium 跑 `e2e-端到端/*.spec.ts`                         | 改完 `media-媒体/main.js` 必跑 |
| `npm run package`     | 打一个时间戳 VSIX 到 `dist-产物/`，顺带刷 `latest.vsix` + `BUILD-INFO.md`        | 只想打包不升版本            |
| `npm run package:bump`| `compile:bump` 的 package 版：先 patch+1，再编译，再打 VSIX                     | **最常用的出包姿势**        |

详细打包流程见 [打包与发布](打包与发布-packaging-release.md)。

## 源码里该改哪

根据要做的事对照 [目录结构](目录结构-directory-layout.md) 里的树：

- **扩展侧逻辑（解析 / 读写文档 / 接收 webview 消息）** → `src-源码/CsvEditorProvider.ts`
- **命令面板的命令** → `src-源码/commands.ts`
- **webview 前端渲染 / 交互** → `media-媒体/main.js`
- **新 `csv.*` 配置项** → `package.json` 的 `contributes.configuration` + provider 里消费它
- **给用户试的新样例 CSV** → `test-示例/` + 更新 `test-示例/README.md`
- **给 CI/回归用的严格样本** → `src-源码/test/` + 相应 `*.test.ts`

webview 和扩展之间**只有 `postMessage` 一条沟通线路**。找不到"面板按钮不响应"这类问题时，先看两头：
- 前端 → `media-媒体/main.js` 里有没有 `addEventListener` 发消息；
- 后端 → `src-源码/CsvEditorProvider.ts::onDidReceiveMessage` 里的 `case` 分支。

## 本地调试

1. 在 VS Code / Cursor 里打开本仓库根目录。
2. 按 **F5**（或 "Run and Debug" 面板里选 `Launch Extension`）。
3. 它会 `tsc -w` 后打开一个干净的 "Extension Development Host" 窗口，所在窗口自动装本扩展。
4. 在那个窗口里随便打开 `test-示例/ultimate-50mb-完整压力测试.csv` 试交互。
5. 改完代码，在调试窗口按 `Cmd/Ctrl+R` 就能热重载。
6. webview 里的 `console.log` 去 **Help → Toggle Developer Tools → Console** 看。

## 装 VSIX 到 Cursor / Windsurf

```bash
npm run package

# Cursor
/Applications/Cursor.app/Contents/Resources/app/bin/cursor \
    --install-extension dist-产物/csv-custom-pro-latest.vsix --force

# Windsurf
/Applications/Windsurf.app/Contents/Resources/app/bin/windsurf \
    --install-extension dist-产物/csv-custom-pro-latest.vsix --force
```

每次完成实质代码改动后，都要打包并安装到 **Cursor 和 Windsurf** 各撞一次。装完要么重启窗口，要么 `Cmd+Shift+P → Developer: Reload Window`。

## 图标流程

1. 把设计稿 / 原图放成 `images-图片/icon.orig.png`。
2. 运行 `python3 scripts/round-icon.py`，会生成 1024×1024 圆角的 `images-图片/icon.png`。
3. `icon.orig.png` 被 `.vscodeignore` 排除，不会进 VSIX；`icon.png` 才是 VS Code 扩展清单 `package.json#icon` 指向的那个。
4. 出包之前顺手 `npm run package:bump` 跑一次，看 `BUILD-INFO.md` 里 "文件大小" 是否正常（约 1.4 MB）。

## 版本号约定

遵循 **SemVer `MAJOR.MINOR.PATCH`**：

| 变更类型                              | 哪位 +1     | 工具                      |
| --------------------------------- | ---------- | ----------------------- |
| 修 bug / 调样式 / 内部重构                | PATCH      | `npm run package:bump`（自动） |
| 新加可见功能 / 新加配置项                    | MINOR      | 手动改 `package.json`     |
| 不向后兼容的消息协议 / 删除命令                 | MAJOR      | 手动改 `package.json`     |

`scripts/bump-version-版本号递增.py` 只会动 PATCH，MINOR / MAJOR 改由人决定。

## 提交与推送约定

- Commit message 首行走 Conventional Commits：`feat:` / `fix:` / `test:` / `docs:` / `build:` / `refactor:` / `chore:`。
- **必须**在本地跑过 `npm test` 和 `npm run test:e2e` 绿后再提交（详见 [测试指南](测试指南-testing.md)）。
- Push 网络抖动时用 HTTP/1.1：`git -c http.version=HTTP/1.1 push`。
- 写完功能建议同步更新 [功能手册](功能手册-features.md) 和 [变更日志](变更日志-changelog.md)。

## 常见坑

- **"改完 main.js 没生效"**：VSIX 装的是旧的。`npm run package:bump` → `--install-extension … --force` → 重载窗口。
- **"只有 Cursor 能跑不 Windsurf"**：两边都装同一个 VSIX 即可，共用 `latest.vsix`。
- **"打包失败说 Invalid image source in README"**：README 里不能用 HTML `<img>`，只能用 Markdown `![](...)` 引图。
- **"e2e 一直超时"**：去 `e2e-端到端/test-results/<case>/test-failed-1.png` 看截图，大概率是新 DOM 没加到 `harness.ts` 的骨架里。
