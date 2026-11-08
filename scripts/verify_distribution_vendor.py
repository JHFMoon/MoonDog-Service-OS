#!/usr/bin/env python3
"""Rehash selected distribution libraries after every cache restore/download."""
import argparse
import hashlib
import json
from pathlib import Path


def verify(root: Path, generated: Path):
    contract = json.loads((root/'distribution/dependencies.json').read_text())
    if contract.get('schemaVersion') != 1:
        raise ValueError('Unknown dependency contract')
    libs = contract['runtimeLibraries']
    expected = {
        'jszip.min.js': libs['jszip']['outputSha256'],
        'xlsx.full.min.js': libs['sheetjs']['outputSha256'],
        'pdf.min.js': libs['pdfjs']['mainOutputSha256'],
        'pdf.worker.min.js': libs['pdfjs']['workerOutputSha256'],
    }
    for name, digest in expected.items():
        source = root/'vendor'/name
        selected = source if source.is_file() else generated/name
        if (not isinstance(digest,str) or len(digest)!=64 or
            hashlib.sha256(selected.read_bytes()).hexdigest()!=digest):
            raise ValueError('Distribution dependency integrity failed')
    return len(expected)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('generated',type=Path)
    args=parser.parse_args()
    try:
        count=verify(Path.cwd(),args.generated)
    except (OSError, ValueError, KeyError, TypeError):
        raise SystemExit('FAIL: cached/downloaded distribution libraries did not match reviewed SHA-256 pins; no contents printed')
    print(f'PASS: {count} selected distribution libraries match reviewed SHA-256 pins')

if __name__=='__main__':main()
