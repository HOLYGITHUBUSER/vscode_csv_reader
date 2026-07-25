#!/usr/bin/env python3
"""Bump package.json patch version (x.y.Z -> x.y.Z+1), then compile or package.

Usage:
    python3 03-script-构建脚本/bump-version-版本递增.py            # bump + npm run compile
    python3 03-script-构建脚本/bump-version-版本递增.py --package  # bump + npm run package
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PACKAGE_JSON = ROOT / "package.json"
SEMVER = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")


def bump_patch(version: str) -> str:
    m = SEMVER.match(version.strip())
    if not m:
        print(
            f"error: version must be semver x.y.z (digits only), got {version!r}",
            file=sys.stderr,
        )
        sys.exit(1)
    major, minor, patch = (int(m.group(1)), int(m.group(2)), int(m.group(3)))
    return f"{major}.{minor}.{patch + 1}"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--package",
        action="store_true",
        help="run npm run package after bump (prepublish compiles once)",
    )
    args = parser.parse_args()

    data = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
    old = data["version"]
    new = bump_patch(old)
    data["version"] = new
    PACKAGE_JSON.write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"version {old} -> {new}")

    if args.package:
        # 委托统一入口（已含编译 + 时间戳打包）
        cmd = [sys.executable, str(ROOT / "03-script-构建脚本" / "build-编译打包.py")]
    else:
        cmd = ["npm", "run", "compile"]
    r = subprocess.run(cmd, cwd=ROOT)
    sys.exit(r.returncode)


if __name__ == "__main__":
    main()
