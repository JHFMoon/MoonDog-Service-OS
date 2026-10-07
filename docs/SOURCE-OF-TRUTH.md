# Source and data boundary

## Public authority

This repository is the public authority for the generic Service Operations Dashboard source, browser-native updater, approved update packages, tests, release metadata, and reviewed third-party notices.

The current public Stable channel is `0.10.11`. Stable 0.10.11 is intended for installations already on the validated `0.10.9` layout-aware updater. Older 0.10.8-era installs are intentionally rejected as incompatible rather than being exposed to an unsafe layout migration.

## Installed authority

The installed Dashboard remains authoritative for operational/store-specific state.

The migrated layout is:

```text
Dashboard Interface/
├── 00 - OPEN DASHBOARD.html
├── index.html                  (hidden compatibility infrastructure when required)
└── System Files/
    ├── application runtime
    └── Workspace/             (protected operational state)
```

The root compatibility document preserves the existing Edge `file://` document path and browser-local storage context. The application runtime is maintained under `System Files/`. Operational paths are rooted under `System Files/Workspace/`.

System Updates may change approved application files but must not publish, package, or overwrite protected Workspace data.

## Local-only information

Never commit or package:

- customer, employee, advisor, or technician identities;
- VINs, repair-order narratives, contacts, or source reports;
- operational state, history, settings, exports, or backups;
- Files To Learn or report-inbox contents;
- store-specific source-adapter configuration or performance targets;
- transaction journals, browser authority credentials, tokens, or machine-specific state.

The browser-local authority credential is intentionally not synchronized with the Workspace. A copied/synchronized Workspace alone cannot become an authoritative writer.

## Update and recovery boundary

Stable 0.10.11 updates are explicitly user-applied. The updater verifies the manifest/package, performs a protected-path dry run, creates rollback material under `System Files/Workspace/backups/system-updates/`, verifies writes, and restores or exposes recovery if installation cannot be verified.

Stable is not considered published by a manifest change alone. The matching formal GitHub Release at tag `v<version>` and the exact package asset must also exist, and the Stable manifest must point to that Release asset.

Pinned JSZip, PDF.js, and SheetJS binary bundles remain installed dependencies. Their notices/licenses are tracked publicly, but the binary bundles are not currently mirrored in this repository. The current 0.10.9 → 0.10.11 update does not need to replace those vendor binaries.

GitHub may contain the product. GitHub may never contain the dealership.

Cadence observations, source locations, and presentation preferences are protected under `System Files/Workspace/data/settings.json`. Public source contains reusable algorithms and generic instructions, not dealership-specific facts.
