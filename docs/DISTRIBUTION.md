# Offline distribution

## Goal

Provide a clean, unconfigured, offline-first copy of Service Operations Dashboard without publishing or centralizing any dealership operational data.

## Distribution architecture

```text
main source + reviewed runtime catalog
            |
            | Publication check succeeds
            v
GitHub Actions distribution build
  - obtains pinned third-party browser libraries
  - assembles only the explicit runtime catalog
  - creates an empty protected Workspace
  - creates deterministic ZIP + SHA-256 manifest
            |
            +--> GitHub Release asset
            |
            +--> GitHub Pages download site
                        |
                        v
             end user downloads ZIP
                        |
                        v
         local extracted installation
         System Files/        application
         System Files/Workspace/   private data
```

GitHub Pages is a storefront, not a compiler and not an operational service. The ZIP is built in GitHub Actions from the reviewed source/runtime catalog. This prevents a web page from deciding which local or repository files belong in a release.

## Clean-install contract

The ZIP contains:

- `00 - OPEN DASHBOARD.html`
- `README - START HERE.txt`
- `System Files/index.html`
- the explicit application runtime catalog under `System Files/assets/` and `System Files/vendor/`
- an empty `System Files/Workspace/` folder structure
- `INSTALLATION-MANIFEST.json`

The ZIP must not contain initialized store settings, report data, customer/RO/VIN content, history, backups, credentials, browser authority identity, or any source-store adapter.

The first installation starts unconfigured. The user chooses the extracted root folder, designates the authoritative editing computer, and completes Guided Setup. All subsequently created operational state belongs to that copy.

## Third-party browser libraries

The release build pins:

- JSZip 3.10.1 from the npm package
- PDF.js 5.6.205 from `pdfjs-dist`, bundled into classic browser files for the local `file://` runtime
- SheetJS CE 0.20.3 from the authoritative SheetJS CDN

These files are included in the release ZIP but do not need to be loaded from a CDN at runtime.

## Update boundary

A clean installation uses the same verified Stable update channel as an existing installation.

Updates may change approved files under `System Files/`. They may not target `System Files/Workspace/`. The installed updater performs package verification, a protected-path dry run, explicit confirmation, rollback backup, write verification, and recovery handling.

## Release assets

Each Stable release may contain:

- `moondog-X.Y.Z.json` — updater package
- `Service-Operations-Dashboard.zip` — clean offline installation
- `Service-Operations-Dashboard.zip.sha256` — ZIP checksum
- `Service-Operations-Dashboard.manifest.json` — release/install inventory

The Pages site links to `releases/latest/download/Service-Operations-Dashboard.zip`.

## Reproducibility and safety

`scripts/build_distribution.py` reads the runtime inventory from `HANDOFF_RUNTIME_PATHS` in the application source, requires the application version to match the Stable manifest, rejects unsafe runtime paths, builds a deterministic ZIP, verifies required paths, and rejects preinitialized operational state.

`python3 scripts/build_distribution.py --check-source` is part of the Publication check.
