#!/usr/bin/env python3
"""编译 TypeScript 并打包 VSIX 到 07-artifacts-安装包/。

直接执行（无需先记 npm 命令）：

    python3 03-script-构建脚本/build-编译打包.py

可选：

    python3 03-script-构建脚本/build-编译打包.py --bump
        # 先把 package.json 的 PATCH 版本 +1，再编译打包

产物命名（清晰 + 时间戳）：

    csv-custom-pro-v1.4.0-20260725-145530.vsix
    csv-custom-pro-latest.vsix          # 稳定别名，始终指向本次包
    build-info-构建信息.md              # 元信息
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PACKAGE_JSON = ROOT / "package.json"
OUT_DIR = ROOT / "07-artifacts-安装包"
TSCONFIG = ROOT / "00-config-工程配置" / "tsconfig-编译配置.json"
SEMVER = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")
# 匹配：csv-custom-pro-v1.4.0-20260725-145530.vsix
STAMPED_RE = re.compile(
    r"^.+-v\d+\.\d+\.\d+-\d{8}-\d{6}\.vsix$"
)
KEEP_TIMESTAMPED = 5  # 本地保留最近 N 个带时间戳包


def run(cmd: list[str], *, cwd: Path = ROOT) -> None:
    print("+", " ".join(cmd), flush=True)
    r = subprocess.run(cmd, cwd=cwd)
    if r.returncode != 0:
        sys.exit(r.returncode)


def bump_patch(version: str) -> str:
    m = SEMVER.match(version.strip())
    if not m:
        print(f"error: version must be x.y.z, got {version!r}", file=sys.stderr)
        sys.exit(1)
    major, minor, patch = map(int, m.groups())
    return f"{major}.{minor}.{patch + 1}"


def git(*args: str) -> str:
    try:
        return subprocess.check_output(
            ["git", *args], cwd=ROOT, text=True, stderr=subprocess.DEVNULL
        ).strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return ""


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--bump",
        action="store_true",
        help="打包前将 package.json 的 PATCH 版本 +1",
    )
    parser.add_argument(
        "--keep",
        type=int,
        default=KEEP_TIMESTAMPED,
        help=f"本地保留最近几个带时间戳的 VSIX（默认 {KEEP_TIMESTAMPED}）",
    )
    args = parser.parse_args()

    data = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
    if args.bump:
        old = data["version"]
        data["version"] = bump_patch(old)
        PACKAGE_JSON.write_text(
            json.dumps(data, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        print(f"version {old} -> {data['version']}")

    version = data["version"]
    name = data["name"]

    # 1) 编译
    if not TSCONFIG.is_file():
        print(f"error: missing {TSCONFIG}", file=sys.stderr)
        sys.exit(1)
    tsc = ROOT / "node_modules" / ".bin" / "tsc"
    if tsc.is_file():
        run([str(tsc), "-p", str(TSCONFIG)])
    else:
        run(["npx", "tsc", "-p", str(TSCONFIG)])

    # 2) 打包
    vsce = ROOT / "node_modules" / ".bin" / "vsce"
    if not vsce.is_file():
        print("error: @vscode/vsce not found; run: npm install", file=sys.stderr)
        sys.exit(1)

    now = datetime.now()
    stamp_file = now.strftime("%Y%m%d-%H%M%S")  # 20260725-145530
    stamp_human = now.strftime("%Y-%m-%d %H:%M:%S")
    # 清晰格式：{name}-v{version}-{YYYYMMDD}-{HHmmss}.vsix
    stamped_name = f"{name}-v{version}-{stamp_file}.vsix"
    latest_name = f"{name}-latest.vsix"

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    stamped_path = OUT_DIR / stamped_name
    latest_path = OUT_DIR / latest_name
    info_path = OUT_DIR / "build-info-构建信息.md"

    run([str(vsce), "package", "-o", str(stamped_path)], cwd=ROOT)
    shutil.copy2(stamped_path, latest_path)

    # 3) 清理旧时间戳包 + 根目录误放的 vsix
    stamped = sorted(
        [p for p in OUT_DIR.iterdir() if p.is_file() and STAMPED_RE.match(p.name)],
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    pruned: list[str] = []
    for p in stamped[max(0, args.keep) :]:
        p.unlink(missing_ok=True)
        pruned.append(p.name)
    # 兼容旧命名：csv-custom-pro-1.4.0-20260725-120000.vsix（无 v 前缀）
    legacy_re = re.compile(rf"^{re.escape(name)}-\d+\.\d+\.\d+-\d{{8}}-\d{{6}}\.vsix$")
    for p in OUT_DIR.iterdir():
        if p.is_file() and legacy_re.match(p.name) and p.name != stamped_name:
            p.unlink(missing_ok=True)
            pruned.append(p.name)
    for p in ROOT.glob("*.vsix"):
        p.unlink(missing_ok=True)
        pruned.append(f"(root)/{p.name}")

    # 4) 构建信息
    raw = stamped_path.read_bytes()
    sha256 = hashlib.sha256(raw).hexdigest()
    size = len(raw)
    commit = git("rev-parse", "--short", "HEAD")
    branch = git("rev-parse", "--abbrev-ref", "HEAD")
    dirty = bool(git("status", "--porcelain"))

    info = f"""# 构建信息

> 由 `python3 03-script-构建脚本/build-编译打包.py` 自动生成。

| 项 | 值 |
| --- | --- |
| 打包时间 | {stamp_human} |
| 扩展名称 | `{name}` |
| 版本号 | `{version}` |
| Git 分支 | `{branch or "(unknown)"}` |
| Git 提交 | `{commit or "(unknown)"}`{" (工作区有未提交改动)" if dirty else ""} |
| 时间戳产物 | [`{stamped_name}`]({stamped_name}) |
| 稳定别名 | [`{latest_name}`]({latest_name}) |
| 文件大小 | {size} 字节（约 {size / 1024:.2f} KB） |
| SHA-256 | `{sha256}` |

## 安装

```bash
cursor --install-extension 07-artifacts-安装包/{latest_name} --force
# 或指定本次时间戳包：
# cursor --install-extension 07-artifacts-安装包/{stamped_name} --force
```

安装后：`Cmd/Ctrl+Shift+P` → `Developer: Reload Window`
"""
    info_path.write_text(info, encoding="utf-8")

    print()
    print("=== 打包完成 ===")
    print(f"时间戳包: {stamped_path}")
    print(f"稳定别名: {latest_path}")
    print(f"构建信息: {info_path}")
    if pruned:
        print(f"已清理旧包 {len(pruned)} 个:")
        for n in pruned:
            print(f"  - {n}")


if __name__ == "__main__":
    main()
