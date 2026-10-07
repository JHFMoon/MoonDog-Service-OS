# Clean-install distribution

## Decision

GitHub Pages is the **download storefront**, not the package compiler.

A clean installer is built by GitHub Actions from reviewed repository source plus pinned third-party browser libraries. The action validates the public boundary, creates the ZIP, hashes the ZIP, inspects its contents, and only then makes it available for distribution.

This keeps packaging deterministic and prevents a browser-side builder from accidentally including local dealership state.

## End-user model

The distributed application remains a local, offline-first tool.

1. Download the Stable clean-install ZIP.
2. Extract the entire folder. Do not run it from inside the ZIP.
3. Open `00 - OPEN DASHBOARD.html` in Microsoft Edge or a Chromium browser that supports the File System Access API.
4. When prompted, choose the extracted **Service Operations Dashboard** folder.
5. Designate that browser/computer as the store's authoritative writer.
6. Complete Guided Setup and import the first SAPR report.

After setup, operational data is stored only under `System Files/Workspace/` in the user's chosen local/company-controlled folder. Software updates continue to use the verified public update manifest and package path already built into the application. Updating application files does not replace the workspace.

## Archive contract

The clean ZIP has this layout:

```text
Service Operations Dashboard/
├── 00 - OPEN DASHBOARD.html
├── index.html
├── START HERE.txt
├── INSTALL-MANIFEST.json
└── System Files/
    ├── index.html
    ├── assets/
    ├── vendor/
    └── Workspace/
```

The root `index.html` is a compatibility document that loads application assets from `System Files/`. Keeping the root document path stable preserves the browser-local identity used by migrated and future installations.

`System Files/Workspace/` is created empty. The distribution build is rejected if any file is present there.

## One source of truth

The build script reads `HANDOFF_RUNTIME_PATHS` from the production application code instead of maintaining a second hand-written runtime list. A clean package therefore cannot silently omit a file that the application itself says is required for a portable/recovery copy.

Third-party binaries are recreated during CI from the versions in `distribution/dependencies.json`. They are never fetched at runtime.

## Safety gates

A clean package must fail closed when any of these checks fail:

- normal repository publication tests;
- public-boundary scan;
- required runtime inventory extraction;
- missing or unexpected runtime file;
- third-party source integrity check;
- any file under `System Files/Workspace/`;
- archive path traversal or duplicate canonical paths;
- generated-file SHA-256 mismatch;
- launch document or expected application version mismatch.

The release ZIP is an application artifact only. It must never contain customer, employee, advisor, technician, RO, VIN, report, history, settings, backup, credentials, tokens, or store-specific configuration.

## Pages

The Pages site should remain intentionally simple:

- current Stable version;
- one **Download clean install** action;
- SHA-256 for the ZIP;
- concise install steps;
- link to release notes/source;
- explicit statement that the application is offline-first and the user's data is not uploaded to GitHub.

The Pages deployment should consume already-validated release metadata. It must not construct an application package in the visitor's browser.

## Release rule

Do not advertise a clean-install download until the clean ZIP build passes in CI and the Stable release contains the matching ZIP plus its checksum metadata. Existing updater releases can continue independently while the clean-install channel is being proven.
