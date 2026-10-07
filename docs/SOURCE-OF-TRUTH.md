# Source and data boundary

## Public authority

This repository is the public authority for the generic Service Operations Dashboard source, clean-install build, browser-native updater, approved update packages, tests, release metadata, and reviewed third-party notices.

The current public Stable channel is `0.10.14`. Stable 0.10.14 is intended for installations on the validated `0.10.9` or later layout-aware updater. Older 0.10.8-era installs are intentionally rejected as incompatible rather than being exposed to an unsafe layout migration.

A fresh user may instead start from the complete clean-install Stable ZIP published with the GitHub Release.

## Installed authority

The installed Dashboard remains authoritative for operational/store-specific state.

The layout is:

```text
Dashboard Interface/
├── 00 - OPEN DASHBOARD.html
├── index.html                  (hidden compatibility infrastructure when required)
└── System Files/
    ├── application runtime
    └── Workspace/             (protected operational state)
```

The root compatibility document preserves the existing Edge `file://` document path and browser-local storage context on migrated installations. The application runtime is maintained under `System Files/`. Operational paths are rooted under `System Files/Workspace/`.

System Updates may change approved application files but must not publish, package, or overwrite protected Workspace data.

## Clean-install boundary

The release ZIP is intentionally unconfigured. It contains application/runtime files and an empty Workspace structure only.

It must not contain:

- store identity or source-adapter configuration;
- advisor, employee, technician, customer, or contact identities;
- VINs, repair-order narratives, source reports, or imported report state;
- operational history, settings, exports, diagnostics from a real store, or backups;
- write-authority credentials, browser identity, tokens, or machine-specific state.

The user creates their own operational state after extracting the ZIP, selecting the installation folder, designating the authoritative editing computer, and completing Guided Setup.

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

Stable 0.10.14 updates are explicitly user-applied. The updater verifies the manifest/package, performs a protected-path dry run, creates rollback material under `System Files/Workspace/backups/system-updates/`, verifies writes, and restores or exposes recovery if installation cannot be verified.

Stable is not considered published by a manifest change alone. The matching formal GitHub Release at tag `v<version>` and the exact package asset must also exist, and the Stable manifest must point to the matching GitHub Release **tag** through the browser-accessible raw file service. The manifest SHA-256 is verified against the exact package and formal Release asset.

The clean-install workflow separately publishes `Service-Operations-Dashboard.zip`, its SHA-256 file, and its per-file distribution manifest on the same Stable release. Pinned JSZip, PDF.js, and SheetJS runtime libraries are acquired from their versioned upstream distributions during that release build and embedded locally in the ZIP; the installed app does not load them from the internet.

**GitHub may contain the product. GitHub may never contain the dealership.**

Cadence observations, source locations, and presentation preferences are protected under `System Files/Workspace/data/settings.json`. Public source contains reusable algorithms and generic instructions, not dealership-specific facts.
