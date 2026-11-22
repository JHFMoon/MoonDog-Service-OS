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
                        +--> website verifies exact official Stable SHA-256
                        |    +--> user chooses parent folder in Edge
                        |    +--> creates new child; verifies every file readback
                        |
                        +--> manual Windows Extract All fallback
                        |
                        v
         local extracted installation
         System Files/        application
         System Files/Workspace/   private data
```

GitHub Pages is a storefront and optional **local clean-install assistant**, not a compiler or an operational service. The ZIP is built in GitHub Actions from the reviewed source/runtime catalog. The website can unpack only a user-selected official Stable ZIP whose SHA-256 matches the separately published release metadata and whose internal inventory matches exactly. With a user's explicit Edge directory choice, it writes that approved software into **one new, previously nonexistent child folder**, verifies durable readback, and never adopts or overwrites an existing folder. It neither uploads reports nor generates store data or settings. Manual Windows extraction remains an alternative.

## Clean-install contract

The ZIP contains:

- `00 - OPEN DASHBOARD.html`
- `README - START HERE.txt`
- `System Files/index.html`
- the explicit application runtime catalog under `System Files/assets/` and `System Files/vendor/`
- an empty `System Files/Workspace/` folder structure
- `INSTALLATION-MANIFEST.json`

The ZIP must not contain initialized store settings, report data, customer/RO/VIN content, history, backups, credentials, browser authority identity, or any source-store adapter.

The first installation starts unconfigured. The user can let the website create a brand-new installation folder or extract the official ZIP manually. Inside the installed `file://` application, the user chooses that exact outer root, grants Edge read/write access, and completes the **in-app Guided Setup** by saving verified store identity/time zone and importing a validated same-store SAPR report. Advisor refinements and optional reports may follow later; unknown figures are never initialized as zero. For a new, user-confirmed installation only, the public website may create `System Files/Workspace/data/settings.json` with the dealership name, string store code (including leading zeroes), optional brand, and selected supported business time zone that the user explicitly entered. It must write and read back those settings only after verifying the official immutable software ZIP and only inside the newly created private Workspace; it must never include them in release archives, the software manifest, GitHub, network requests, URLs or browser-local persistence. Existing installations and settings are never overwritten. This configured destination is **not** external source-store verification: SAPR is still required for Guided Setup completion, and unsigned imports still require their established manager review. Missing reports remain unknown until verified imports. A configured but SAPR-unverified installation is not yet operationally ready. All subsequently created operational state belongs to that copy.

The website-only new-folder flow additionally prepares an **empty** `System Files/Workspace/Files To Learn/` directory, after verifying the immutable Stable ZIP and software manifest, so the user can create a Windows shortcut to the real local learning folder immediately. This extra folder and user-entered identity are private Workspace content; they are never duplicated under the installation root or added to the signed software inventory. The manual ZIP extraction path still uses the original signed package layout. A failure in private first-run setup leaves a visible incomplete-install marker rather than reporting success.

The website uses only browser File System Access APIs, not a server-side installer. It cannot launch a `file://` application from a hosted HTTPS page; the user opens the generated launcher locally. A write interruption leaves the new folder marked incomplete rather than pretending installation succeeded or silently deleting a partially written folder. An existing target, existing application/Workspace parent, invalid ZIP, denied permission or unsafe inventory blocks creation. No real-store files are touched in automated tests.

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
