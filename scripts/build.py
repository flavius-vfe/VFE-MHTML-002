#!/usr/bin/env python3
"""Create an unsigned XPI from extension files, no third-party dependencies."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json
ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT/'manifest.json').read_text(encoding='utf-8'))
files = ['manifest.json','background.js','capture.js','popup.html','popup.css','popup.js'] + [f'icons/icon{n}.png' for n in (16,32,48,96,128)]
out = ROOT/'dist'/f"VFE-MHTML-002-v{manifest['version']}-unsigned.xpi"
out.parent.mkdir(exist_ok=True)
with ZipFile(out,'w',ZIP_DEFLATED) as z:
    for f in files: z.write(ROOT/f,f)
print(out)
