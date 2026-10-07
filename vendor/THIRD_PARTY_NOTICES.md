# Bundled browser libraries

These libraries are part of the offline client. They are not loaded from a CDN at runtime.

| Files | Upstream | Version | License | Local license copy |
| --- | --- | --- | --- | --- |
| `jszip.min.js` | [JSZip](https://github.com/Stuk/jszip) | 3.10.1 | MIT option of dual MIT/GPLv3 | `JSZIP-LICENSE.txt` |
| `pdf.min.js`, `pdf.worker.min.js` | [Mozilla PDF.js](https://github.com/mozilla/pdf.js) | 5.6.205 | Apache 2.0 | `PDFJS-LICENSE.txt` |
| `xlsx.full.min.js` | [SheetJS Community Edition](https://git.sheetjs.com/SheetJS/sheetjs) | 0.20.3 | Apache 2.0 | `SHEETJS-LICENSE.txt` |

The JSZip and SheetJS files match the official versioned distribution bytes by SHA-256. The two PDF.js files identify the same upstream version and are a matched browser-compatible pair from the existing offline installation; their bundled format differs from the upstream module distribution. The application uses no external runtime service for these libraries.
