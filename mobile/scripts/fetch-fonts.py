"""Fetch unmodified Satoshi faces from Fontshare; loose font files stay out of Git."""
from pathlib import Path
import hashlib
import io
import urllib.request
import zipfile

EXPECTED = {'Satoshi-LightItalic.otf': '52d316ba2bfbd45baa6a704b9d2a9db55f735703fda382328d44ca0b4568504e', 'Satoshi-Italic.otf': '8be5ca91c666e7f697c8db93f1ccf00adbdae7b9309df912ae550371206dddc4'}
root = Path(__file__).resolve().parents[1] / "assets" / "fonts"
def valid(path, digest):
    return path.exists() and hashlib.sha256(path.read_bytes()).hexdigest() == digest
if not all(valid(root / name, digest) for name, digest in EXPECTED.items()):
    with urllib.request.urlopen("https://api.fontshare.com/v2/fonts/download/satoshi", timeout=60) as response:
        archive = zipfile.ZipFile(io.BytesIO(response.read()))
    assets = {name: archive.read("Satoshi_Complete/Fonts/OTF/" + name) for name in EXPECTED}
    for name, data in assets.items():
        if hashlib.sha256(data).hexdigest() != EXPECTED[name]:
            raise SystemExit("Fontshare changed " + name + "; review before updating its checksum")
    root.mkdir(parents=True, exist_ok=True)
    for name, data in assets.items():
        (root / name).write_bytes(data)
print("Satoshi Light Italic and Italic verified")
