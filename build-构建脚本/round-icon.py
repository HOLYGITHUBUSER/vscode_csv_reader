"""一次性脚本：把 icon-扩展图标/icon.png 居中裁成正方形，缩到 1024，并加圆角 alpha。

用法：
    python3 build-构建脚本/round-icon.py

- 输入/输出：icon-扩展图标/icon.png（就地覆盖）
- 圆角半径：输出尺寸的 22%（近似 macOS squircle 观感）
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ICON = ROOT / "icon-扩展图标" / "icon.png"

TARGET = 1024
RADIUS_RATIO = 0.22


def main() -> None:
    im = Image.open(ICON).convert("RGBA")
    w, h = im.size

    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    sq = im.crop((left, top, left + side, top + side))

    sq = sq.resize((TARGET, TARGET), Image.LANCZOS)

    radius = int(TARGET * RADIUS_RATIO)
    mask = Image.new("L", (TARGET, TARGET), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, TARGET - 1, TARGET - 1), radius=radius, fill=255
    )

    out = Image.new("RGBA", (TARGET, TARGET), (0, 0, 0, 0))
    out.paste(sq, (0, 0), mask)
    out.save(ICON, "PNG")

    print(f"saved {ICON} -> {out.size}")


if __name__ == "__main__":
    main()
