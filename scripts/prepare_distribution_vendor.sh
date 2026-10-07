#!/usr/bin/env bash
set -euo pipefail

OUT="${1:-}"
if [[ -z "$OUT" ]]; then
  echo "usage: $0 <output-directory>" >&2
  exit 2
fi
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Fetching JSZip 3.10.1 from immutable upstream commit..."
curl --proto '=https' --tlsv1.2 -fsSL   "https://raw.githubusercontent.com/Stuk/jszip/cae55105f5e8bd37c270cdb76eab2cf40388dfd9/dist/jszip.min.js"   -o "$OUT/jszip.min.js"

echo "Fetching SheetJS CE 0.20.3 from the versioned upstream CDN..."
curl --proto '=https' --tlsv1.2 -fsSL   "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js"   -o "$OUT/xlsx.full.min.js"
printf '%s  %s\n' "6b3130af1ceadf07caa0ec08af7addff" "$OUT/xlsx.full.min.js" | md5sum -c -

echo "Fetching the signed PDF.js 5.6.205 release distribution..."
curl --proto '=https' --tlsv1.2 -fsSL   "https://github.com/mozilla/pdf.js/releases/download/v5.6.205/pdfjs-5.6.205-dist.zip"   -o "$TMP/pdfjs.zip"
printf '%s  %s\n' "0555ef47464e456125dcd0b9742cfa2aaed6d282e804e4dd1f1b99316b46ac00" "$TMP/pdfjs.zip" | sha256sum -c -
unzip -q "$TMP/pdfjs.zip" -d "$TMP/pdfjs"

PDF_MAIN="$(find "$TMP/pdfjs" -type f -path '*/build/pdf.mjs' -print -quit)"
PDF_WORKER="$(find "$TMP/pdfjs" -type f -path '*/build/pdf.worker.mjs' -print -quit)"
if [[ -z "$PDF_MAIN" || -z "$PDF_WORKER" ]]; then
  echo "PDF.js release layout did not contain the expected browser modules" >&2
  exit 1
fi

echo "Producing file://-compatible classic PDF.js bundles..."
npx --yes esbuild@0.25.10 "$PDF_MAIN"   --bundle --platform=browser --format=iife --global-name=pdfjsLib   --target=chrome120 --minify --outfile="$OUT/pdf.min.js"
npx --yes esbuild@0.25.10 "$PDF_WORKER"   --bundle --platform=browser --format=iife   --target=chrome120 --minify --outfile="$OUT/pdf.worker.min.js"

for file in jszip.min.js pdf.min.js pdf.worker.min.js xlsx.full.min.js; do
  test -s "$OUT/$file"
done

python3 - "$OUT" <<'PY'
import hashlib, json, pathlib, sys
root = pathlib.Path(sys.argv[1])
result = {}
for path in sorted(root.iterdir()):
    if path.is_file():
        result[path.name] = {"bytes": path.stat().st_size, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
print(json.dumps(result, indent=2, sort_keys=True))
PY
