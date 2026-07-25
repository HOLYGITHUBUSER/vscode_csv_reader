#!/usr/bin/env node
/* Package vsix as artifacts-安装包/<name>-<version>-<YYYYMMDD-HHmmss>.vsix,
 * plus a stable <name>-latest.vsix copy and a BUILD-INFO.md audit file. */

const { execFileSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const pkg = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);

const pad = (n) => String(n).padStart(2, "0");
const d = new Date();
const stampFile = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
const stampHuman = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

const outDir = path.join(root, "artifacts-安装包");
const base = `${pkg.name}-${pkg.version}-${stampFile}.vsix`;
const outFile = path.join(outDir, base);
const latestBase = `${pkg.name}-latest.vsix`;
const latestFile = path.join(outDir, latestBase);
const buildInfoFile = path.join(outDir, "BUILD-INFO.md");

fs.mkdirSync(outDir, { recursive: true });

const vsce = path.join(root, "node_modules", ".bin", "vsce");
execFileSync(vsce, ["package", "-o", outFile], { cwd: root, stdio: "inherit" });

fs.copyFileSync(outFile, latestFile);

// Keep artifacts lean: stable latest + the N most recent timestamped builds.
const KEEP_TIMESTAMPED = 2;
const stampRe = new RegExp(
  `^${pkg.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-\\d+\\.\\d+\\.\\d+-\\d{8}-\\d{6}\\.vsix$`,
);
const timestamped = fs
  .readdirSync(outDir)
  .filter((name) => stampRe.test(name))
  .map((name) => ({ name, mtime: fs.statSync(path.join(outDir, name)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime);
const pruned = [];
for (const entry of timestamped.slice(KEEP_TIMESTAMPED)) {
  fs.unlinkSync(path.join(outDir, entry.name));
  pruned.push(entry.name);
}
// Never leave a stray root-level .vsix (use artifacts-安装包/ only).
for (const name of fs.readdirSync(root)) {
  if (name.endsWith(".vsix") && fs.statSync(path.join(root, name)).isFile()) {
    fs.unlinkSync(path.join(root, name));
    pruned.push(`(root)/${name}`);
  }
}

const git = (args) => {
  try {
    return execFileSync("git", args, { cwd: root }).toString().trim();
  } catch {
    return "";
  }
};
const commit = git(["rev-parse", "--short", "HEAD"]);
const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
const dirty = git(["status", "--porcelain"]).length > 0;

const stat = fs.statSync(outFile);
const sha256 = crypto
  .createHash("sha256")
  .update(fs.readFileSync(outFile))
  .digest("hex");

const sizeKb = (stat.size / 1024).toFixed(2);
const body = `# BUILD INFO

> 本文件由 \`npm run package\` 自动生成，每次打包覆盖一次。

- 打包时间（本地）：${stampHuman}
- 扩展名称：\`${pkg.name}\`
- 版本号：\`${pkg.version}\`
- Git 分支：\`${branch || "(unknown)"}\`
- Git 提交：\`${commit || "(unknown)"}\`${dirty ? " (工作区有未提交改动)" : ""}
- 最新稳定文件：[\`${latestBase}\`](${latestBase})
- 最新时间戳文件：[\`${base}\`](${base})
- 文件大小：${stat.size} 字节（约 ${sizeKb} KB）
- SHA-256：\`${sha256}\`
- 产物策略：仅保留 \`${latestBase}\` + 最近 ${KEEP_TIMESTAMPED} 个时间戳包；根目录 \`.vsix\` 会自动删除

安装方式：VS Code / Cursor → 扩展 → 「从 VSIX 安装…」→ 选择上面任一 \`.vsix\`。
`;

fs.writeFileSync(buildInfoFile, body);

console.log(`\nlatest copy: ${latestFile}`);
console.log(`build info : ${buildInfoFile}`);
if (pruned.length) {
  console.log(`pruned ${pruned.length} old artifact(s):`);
  for (const name of pruned) console.log(`  - ${name}`);
}
