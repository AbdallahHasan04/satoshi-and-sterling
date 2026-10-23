"""Packs the Chrome build into a .crx file for sideloading, e.g. into Edge Canary on Android:

    python tools/build.py
    python tools/pack_crx.py

writes dist/satoshi-and-sterling-<version>.crx. The first run creates the signing key
satoshi-and-sterling.pem in the project folder. Keep that file private and reuse it: the key
decides the extension's ID, so a new key would make updates install as a separate extension.
(*.pem is in .gitignore.)
"""
import json
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / 'dist'
KEY = ROOT / 'satoshi-and-sterling.pem'
BROWSERS = [
    Path(r'C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe'),
    Path(r'C:\Program Files\Google\Chrome\Application\chrome.exe'),
    Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'),
]


def main():
    version = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))['version']
    source = DIST / f'satoshi-and-sterling-chrome-{version}.zip'
    if not source.exists():
        raise SystemExit(f'{source.name} not found: run python tools/build.py first')
    browser = next((b for b in BROWSERS if b.exists()), None)
    if not browser:
        raise SystemExit('No Brave, Chrome or Edge found to pack with')

    with tempfile.TemporaryDirectory() as tmp:
        unpacked = Path(tmp) / 'satoshi-and-sterling'
        with zipfile.ZipFile(source) as z:
            z.extractall(unpacked)
        args = [str(browser), f'--pack-extension={unpacked}', f'--user-data-dir={Path(tmp) / "profile"}', '--no-first-run']
        if KEY.exists():
            args.append(f'--pack-extension-key={KEY}')
        subprocess.run(args, check=True, timeout=120)

        crx = unpacked.with_suffix('.crx')
        if not crx.exists():
            raise SystemExit('Packing failed: no .crx was produced')
        new_key = unpacked.with_suffix('.pem')
        if not KEY.exists() and new_key.exists():
            shutil.move(new_key, KEY)
            print(f'Created signing key {KEY.name}: keep it private and reuse it for updates')
        out = DIST / f'satoshi-and-sterling-{version}.crx'
        shutil.move(crx, out)
    print(f'{out.relative_to(ROOT)}  ({round(out.stat().st_size / 1024)} KB)')


if __name__ == '__main__':
    main()
