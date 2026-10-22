"""Refreshes lib/sec-tickers.json, the ticker → SEC company number (CIK) map used by the
Stock analysis tab. The SEC blocks this list for browsers, so it ships with the extension.

    python tools/update_sec_tickers.py

The SEC asks automated requests to identify themselves with a contact address.
"""
import json
import urllib.request
from pathlib import Path

CONTACT = 'Satoshi & Sterling browser extension abdullahbasemhasan@gmail.com'
URL = 'https://www.sec.gov/files/company_tickers.json'
OUT = Path(__file__).resolve().parent.parent / 'lib' / 'sec-tickers.json'

req = urllib.request.Request(URL, headers={'User-Agent': CONTACT})
with urllib.request.urlopen(req, timeout=30) as r:
    data = json.load(r)
mapping = {row['ticker'].upper(): row['cik_str'] for row in data.values()}
OUT.write_text(json.dumps(mapping, separators=(',', ':'), sort_keys=True), encoding='utf-8')
print(f'{OUT.relative_to(OUT.parent.parent)}: {len(mapping)} tickers, {OUT.stat().st_size // 1024} KB')
