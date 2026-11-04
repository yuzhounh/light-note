"""Regenerate the LightNote icon assets from the SVG master.

Single source of truth:
    images/pen-note-icon-green.svg

The SVG viewBox is cropped to the rounded-square backdrop, so the Windows and
web "any" assets render that full-bleed viewport. The maskable web icon keeps
the former padding by resetting the root viewBox to the full 1024 canvas.

Outputs:
    images/pen-note-icon-green-1024.png   1024x1024 master raster
    images/pen-note-icon-green.ico        PNG frames at 16, 20, 24, 30, 32, 36,
                                          40, 48, 60, 64, 72, 96, 128, 256
    web/public/icon-512.png               512x512, full-bleed
    web/public/icon-maskable-512.png      512x512, padded for maskable use

Usage:
    C:/ProgramData/Anaconda3/python.exe scripts/generate-icons.py
"""

from __future__ import annotations

import re
import struct
import sys
import xml.etree.ElementTree as ET
from io import BytesIO
from pathlib import Path

from PIL import Image
from PySide6.QtCore import QByteArray, QRectF, Qt
from PySide6.QtGui import QGuiApplication, QImage, QPainter
from PySide6.QtSvg import QSvgRenderer

ROOT = Path(__file__).resolve().parent.parent
SVG_PATH = ROOT / "images" / "pen-note-icon-green.svg"
PNG_1024_PATH = ROOT / "images" / "pen-note-icon-green-1024.png"
PNG_512_PATH = ROOT / "web" / "public" / "icon-512.png"
MASKABLE_512_PATH = ROOT / "web" / "public" / "icon-maskable-512.png"
ICO_PATH = ROOT / "images" / "pen-note-icon-green.ico"
ICO_SIZES = (16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 96, 128, 256)

SVG_NS = "{http://www.w3.org/2000/svg}"
# The visible rounded-square body must fill 98-100% of the cropped viewport.
MIN_BODY_RATIO = 0.98
MAX_BODY_RATIO = 1.0


def _canvas_and_body(svg_path: Path) -> tuple[float, float, float]:
    """Return (viewBox width, body width, body height) for the icon SVG."""
    root = ET.parse(svg_path).getroot()
    if root.tag != f"{SVG_NS}svg":
        raise SystemExit(f"{svg_path}: not an SVG document")
    values = (root.get("viewBox") or "").replace(",", " ").split()
    if len(values) != 4:
        raise SystemExit(f"{svg_path}: missing viewBox")
    view_width, view_height = float(values[2]), float(values[3])
    if abs(view_width - view_height) > 1e-6:
        raise SystemExit(f"{svg_path}: viewBox is not square")
    for rect in root.iter(f"{SVG_NS}rect"):
        if rect.get("fill") not in (None, "none"):
            return view_width, float(rect.get("width", "0")), float(rect.get("height", "0"))
    raise SystemExit(f"{svg_path}: no filled backdrop rect found")


def render(svg_bytes: bytes, size: int) -> QImage:
    """Rasterise the SVG into a transparent 8-bit RGBA image at `size` px."""
    image = QImage(size, size, QImage.Format.Format_RGBA8888)
    image.fill(Qt.GlobalColor.transparent)
    painter = QPainter(image)
    painter.setRenderHints(
        QPainter.RenderHint.Antialiasing | QPainter.RenderHint.SmoothPixmapTransform
    )
    renderer = QSvgRenderer(QByteArray(svg_bytes))
    if not renderer.isValid():
        raise SystemExit("Qt could not parse the SVG master")
    renderer.render(painter, QRectF(0.0, 0.0, float(size), float(size)))
    painter.end()
    return image


def to_pillow(image: QImage) -> Image.Image:
    """Copy QImage pixels (RGBA8888, stride-safe) into an RGBA Pillow image."""
    width, height = image.width(), image.height()
    stride = image.bytesPerLine()
    row_bytes = width * 4
    raw = bytes(image.constBits())
    if stride == row_bytes:
        raw = raw[: height * row_bytes]
    else:
        raw = b"".join(
            raw[y * stride : y * stride + row_bytes] for y in range(height)
        )
    return Image.frombytes("RGBA", (width, height), raw)


def _png_bytes(image: Image.Image) -> bytes:
    buffer = BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def write_ico(path: Path, frames: list[tuple[int, bytes]]) -> None:
    """Write PNG-compressed ICO frames using struct-packed header and directory."""
    offset = 6 + 16 * len(frames)
    directory = bytearray()
    payload = bytearray()
    for size, data in frames:
        directory += struct.pack(
            "<BBBBHHII", size % 256, size % 256, 0, 0, 1, 32, len(data), offset
        )
        offset += len(data)
        payload += data
    header = struct.pack("<HHH", 0, 1, len(frames))
    path.write_bytes(header + bytes(directory) + bytes(payload))


def main() -> int:
    if not SVG_PATH.is_file():
        raise SystemExit(f"Missing SVG master: {SVG_PATH}")

    view_width, body_width, body_height = _canvas_and_body(SVG_PATH)
    body_ratio = max(body_width, body_height) / view_width
    print(
        f"SVG viewport={view_width:.0f}  body={body_width:.0f}x{body_height:.0f}"
        f"  ratio={body_ratio:.1%}"
    )
    if not MIN_BODY_RATIO <= body_ratio <= MAX_BODY_RATIO + 1e-9:
        raise SystemExit(
            f"Backdrop fills {body_ratio:.1%} of the viewport; expected "
            f"{MIN_BODY_RATIO:.0%}-{MAX_BODY_RATIO:.0%}."
        )

    # Offscreen Qt application so SVG rendering never needs a desktop session.
    application = QGuiApplication.instance()
    if application is None:
        application = QGuiApplication(["generate-icons", "-platform", "offscreen"])

    svg_text = SVG_PATH.read_text(encoding="utf-8")
    svg_bytes = svg_text.encode("utf-8")

    canvas = float(ET.parse(SVG_PATH).getroot().get("width", "1024") or 1024)
    maskable_text, replaced = re.subn(
        r'viewBox="[^"]*"', f'viewBox="0 0 {canvas:g} {canvas:g}"', svg_text, count=1
    )
    if replaced != 1:
        raise SystemExit(f"{SVG_PATH}: cannot reset viewBox for the maskable icon")
    maskable_bytes = maskable_text.encode("utf-8")

    # Full-bleed assets use the cropped viewBox; the maskable icon restores padding.
    to_pillow(render(svg_bytes, 1024)).save(PNG_1024_PATH, format="PNG", optimize=True)
    to_pillow(render(svg_bytes, 512)).save(PNG_512_PATH, format="PNG", optimize=True)
    to_pillow(render(maskable_bytes, 512)).save(
        MASKABLE_512_PATH, format="PNG", optimize=True
    )

    frames = [
        (size, _png_bytes(to_pillow(render(svg_bytes, size)))) for size in ICO_SIZES
    ]
    write_ico(ICO_PATH, frames)

    print(f"Wrote {PNG_1024_PATH.relative_to(ROOT)} (1024px)")
    print(f"Wrote {PNG_512_PATH.relative_to(ROOT)} (512px)")
    print(f"Wrote {MASKABLE_512_PATH.relative_to(ROOT)} (512px, maskable padding)")
    print(f"Wrote {ICO_PATH.relative_to(ROOT)} frames={','.join(str(s) for s in ICO_SIZES)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
