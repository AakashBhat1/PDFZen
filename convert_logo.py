import os
from PIL import Image

def main():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    png_path = os.path.join(base_dir, "src", "logo.png")
    ico_path = os.path.join(base_dir, "favicon.ico")

    if not os.path.exists(png_path):
        print(f"Error: Source PNG logo not found at {png_path}")
        return

    print(f"Converting {png_path} to {ico_path}...")
    try:
        img = Image.open(png_path)
        # Ensure it's in RGBA mode for transparency support
        if img.mode != "RGBA":
            img = img.convert("RGBA")
        
        # Standard sizes for Windows ICO files
        sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
        
        img.save(ico_path, format="ICO", sizes=sizes)
        print(f"Success! Saved ICO file with sizes {sizes} to {ico_path}")
    except Exception as e:
        print(f"Failed to convert logo: {e}")

if __name__ == "__main__":
    main()
