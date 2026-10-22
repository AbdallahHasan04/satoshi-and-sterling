"""Builds the store packages from this folder:

    python tools/build.py

writes dist/satoshi-and-sterling-chrome-<version>.zip (Chrome Web Store, Edge Add-ons)
and dist/satoshi-and-sterling-firefox-<version>.zip (addons.mozilla.org), plus an unpacked
dist/firefox/ folder for testing in Firefox.
"""
import json
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / 'dist'
INCLUDE = ['background', 'icons', 'lib', 'options', 'popup', 'styles', 'support']

FIREFOX_ID = 'satoshi-and-sterling@abdallahhasan'
FIREFOX_MIN_VERSION = '140.0'          # first desktop version with the data_collection_permissions key
FIREFOX_ANDROID_MIN_VERSION = '142.0'  # first Android version with it
# addons.mozilla.org allows at most 45 characters (the Chrome Web Store allows 75).
FIREFOX_NAME = 'Satoshi & Sterling: Currency, Crypto & Stocks'
assert len(FIREFOX_NAME) <= 45, f'Firefox name is {len(FIREFOX_NAME)} characters; the limit is 45'


def extension_files():
    files = []
    for folder in INCLUDE:
        files += [p for p in (ROOT / folder).rglob('*') if p.is_file()]
    return sorted(files)


def firefox_manifest(manifest):
    m = dict(manifest)
    m['name'] = FIREFOX_NAME
    # Firefox runs background scripts (an event page) rather than a service worker.
    m['background'] = {'scripts': [manifest['background']['service_worker']], 'type': 'module'}
    m.pop('minimum_chrome_version', None)
    # Firefox already lets users grant or revoke host permissions, and permissions.request() can
    # re-ask for them, so the optional copy (a Chrome workaround) isn't needed.
    m.pop('optional_host_permissions', None)
    m['browser_specific_settings'] = {
        'gecko': {
            'id': FIREFOX_ID,
            'strict_min_version': FIREFOX_MIN_VERSION,
            'data_collection_permissions': {'required': ['none']},
        },
        # Also installable on Firefox for Android (right-click Convert is desktop-only there).
        'gecko_android': {'strict_min_version': FIREFOX_ANDROID_MIN_VERSION},
    }
    return m


def write_zip(path, manifest):
    path.unlink(missing_ok=True)
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        z.writestr('manifest.json', json.dumps(manifest, indent=2, ensure_ascii=False) + '\n')
        for f in extension_files():
            z.write(f, f.relative_to(ROOT).as_posix())  # forward slashes, manifest at the root
    with zipfile.ZipFile(path) as z:
        assert z.testzip() is None
        count = len(z.namelist())
    print(f'{path.relative_to(ROOT)}  ({count} files, {round(path.stat().st_size / 1024)} KB)')


def main():
    manifest = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))
    version = manifest['version']
    DIST.mkdir(exist_ok=True)

    write_zip(DIST / f'satoshi-and-sterling-chrome-{version}.zip', manifest)
    ff = firefox_manifest(manifest)
    write_zip(DIST / f'satoshi-and-sterling-firefox-{version}.zip', ff)

    # Unpacked Firefox copy for about:debugging → "Load Temporary Add-on…".
    unpacked = DIST / 'firefox'
    shutil.rmtree(unpacked, ignore_errors=True)
    for f in extension_files():
        dest = unpacked / f.relative_to(ROOT)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(f, dest)
    (unpacked / 'manifest.json').write_text(json.dumps(ff, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(f'{unpacked.relative_to(ROOT)}/  (unpacked, for testing)')


if __name__ == '__main__':
    main()
