import subprocess
import sys

def install_pillow():
    subprocess.check_call([sys.executable, "-m", "pip", "install", "Pillow"])

try:
    from PIL import Image
except ImportError:
    install_pillow()
    from PIL import Image

try:
    img = Image.open('icon.ico')
    # Resize keeping aspect ratio if needed, but best is to provide specific size for ICO
    img.save('icon_fixed.ico', sizes=[(256, 256)])
    print("Successfully saved icon_fixed.ico")
except Exception as e:
    print(f"Error: {e}")
