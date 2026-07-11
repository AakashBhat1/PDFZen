"""Generate favicon.ico from the app logo PNG."""
import os
from pathlib import Path

from PIL import Image


def main() -> None:
    # scripts/ is one level below the repo root
    root = Path(__file__).resolve().parent.parent
    png_path = root / "src" / "assets" / "logo.png"
    ico_path = root / "favicon.ico"

    if not png_path.is_file():
        print(f"Error: Source PNG logo not found at {png_path}")
        return

    print(f"Converting {png_path} to {ico_path}...")
    try:
        img = Image.open(png_path)
        if img.mode != "RGBA":
            img = img.convert("RGBA")

        sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
        img.save(ico_path, format="ICO", sizes=sizes)
        print(f"Success! Saved ICO file with sizes {sizes} to {ico_path}")
    except Exception as e:
        print(f"Failed to convert logo: {e}")


if __name__ == "__main__":
    main()
