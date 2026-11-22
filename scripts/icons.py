"""Build every platform icon from the committed 1024 px brand masters.

The SVG masters live in assets/brand.  They are rendered once into PNG
masters so CI only needs Pillow (which is already available on the runners).
"""

from __future__ import annotations

import struct
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
APP_MASTER = ROOT / "assets" / "brand" / "app-icon.png"
TRAY_MASTER = ROOT / "assets" / "brand" / "tray-icon.png"

ICNS_TYPES = {
    16: b"icp4",
    32: b"icp5",
    64: b"icp6",
    128: b"ic07",
    256: b"ic08",
    512: b"ic09",
    1024: b"ic10",
}


def load_master(path: Path) -> Image.Image:
    if not path.is_file():
        raise SystemExit(f"Missing icon master: {path}")
    image = Image.open(path).convert("RGBA")
    if image.width != image.height or image.width < 256:
        raise SystemExit(f"Expected a square master of at least 256 px: {path}")
    return image


def resized(master: Image.Image, size: int) -> Image.Image:
    return master.resize((size, size), Image.Resampling.LANCZOS)


def write_png(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, "PNG", optimize=True)


def write_ico(master: Image.Image, path: Path) -> None:
    sizes = [16, 24, 32, 48, 64, 128, 256]
    path.parent.mkdir(parents=True, exist_ok=True)
    # Pillow's ICO writer downscales the given image to every requested size,
    # so the full-resolution master must be the source, not a 16 px thumbnail.
    master.save(path, "ICO", sizes=[(size, size) for size in sizes])


def png_bytes(image: Image.Image) -> bytes:
    from io import BytesIO

    buffer = BytesIO()
    image.save(buffer, "PNG", optimize=True)
    return buffer.getvalue()


def write_icns(master: Image.Image, path: Path) -> None:
    chunks = []
    for size, chunk_type in ICNS_TYPES.items():
        payload = png_bytes(resized(master, size))
        chunks.append(chunk_type + struct.pack(">I", len(payload) + 8) + payload)
    body = b"icns" + struct.pack(">I", 8 + sum(len(chunk) for chunk in chunks)) + b"".join(chunks)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(body)


def main() -> None:
    app = load_master(APP_MASTER)
    tray = load_master(TRAY_MASTER)

    write_png(app, ROOT / "assets" / "app-icon.png")
    write_ico(app, ROOT / "assets" / "app-icon.ico")
    write_icns(app, ROOT / "assets" / "app-icon.icns")
    write_png(resized(app, 256), ROOT / "magpie" / "icon.png")
    write_png(resized(tray, 32), ROOT / "assets" / "tray-icon.png")
    write_png(resized(tray, 64), ROOT / "assets" / "tray-icon@2x.png")
    print("Built app-icon.png, app-icon.ico, app-icon.icns, magpie/icon.png and tray icons.")


if __name__ == "__main__":
    main()
