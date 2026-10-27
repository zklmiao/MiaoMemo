"""Generate Tauri icon assets from the source icon.ico (256x256).

Run: python generate_icons.py
Requires: Pillow
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "icon.ico"
OUT = ROOT / "src-tauri" / "icons"

PNG_SIZES = {
    "32x32.png": 32,
    "128x128.png": 128,
    "128x128@2x.png": 256,
    "StoreLogo.png": 50,
    "Square30x30Logo.png": 30,
    "Square44x44Logo.png": 44,
    "Square71x71Logo.png": 71,
    "Square89x89Logo.png": 89,
    "Square107x107Logo.png": 107,
    "Square142x142Logo.png": 142,
    "Square150x150Logo.png": 150,
    "Square284x284Logo.png": 284,
    "Square310x310Logo.png": 310,
}

ICO_SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"Source icon not found: {SOURCE}")

    OUT.mkdir(parents=True, exist_ok=True)
    image = Image.open(SOURCE).convert("RGBA")

    for name, size in PNG_SIZES.items():
        image.resize((size, size), Image.Resampling.LANCZOS).save(OUT / name, "PNG")

    image.resize((512, 512), Image.Resampling.LANCZOS).save(OUT / "icon.png", "PNG")
    image.save(OUT / "icon.ico", sizes=ICO_SIZES)

    print(f"Generated {len(PNG_SIZES) + 2} icon assets in {OUT}")


if __name__ == "__main__":
    main()
