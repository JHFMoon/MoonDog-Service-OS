# Service Operations Dashboard

[![Publication check](https://github.com/JHFMoon/MoonDog-Service-OS/actions/workflows/publication-check.yml/badge.svg)](https://github.com/JHFMoon/MoonDog-Service-OS/actions/workflows/publication-check.yml)

This repository is the public source and update authority for the generic **Service Operations Dashboard**. The installed application runs locally in the browser and remains offline-capable for normal operations. GitHub is used only for source control and software update distribution; dealership operational data stays in the connected local/company-controlled workspace.

See [Source and data boundary](docs/SOURCE-OF-TRUTH.md), [Data Boundary](docs/DATA-BOUNDARY.md), [Architecture](docs/ARCHITECTURE.md), [Clean-install distribution](docs/DISTRIBUTION.md), [Stable release process](docs/RELEASE-PROCESS.md), and [CHANGELOG.md](CHANGELOG.md).

## Current channels

- **Stable:** `0.10.14` ([GitHub Release](https://github.com/JHFMoon/MoonDog-Service-OS/releases/tag/v0.10.14))
- **Beta:** `0.10.15-beta.1` (optional next-version preview carrying forward Stable 0.10.14)

Stable 0.10.14 refines bounded rolling backup retention: every validated full backup is kept for 30 days, then one validated monthly recovery point is retained across a 12-month window, while the newest three full backups are always preserved. It requires the layout-aware updater from version `0.10.9` or later. Older 0.10.8-era installations remain intentionally incompatible.

A version is considered **Stable** only when the matching formal GitHub Release exists at tag `v<version>` and contains the exact updater package declared by the Stable manifest. The Stable manifest points to the SHA-256-verified file under the matching GitHub Release **tag** using GitHub's browser-compatible raw service. The matching formal GitHub Release and its verified asset are still required; a manifest-only version is not a completed Stable publication.

## Clean install

Formal Stable releases also publish a verified clean-install ZIP. Download the ZIP, extract the entire **Service Operations Dashboard** folder, open `00 - OPEN DASHBOARD.html` in Microsoft Edge, choose the extracted folder when prompted, and complete Guided Setup.

The clean installer contains an empty `System Files/Workspace/`. Customer, employee, advisor, technician, RO, VIN, report, history, settings, backup, and store-specific data are never packaged. After setup, that workspace belongs to the end user and remains outside the software-update payload.

The clean-install archive is built by GitHub Actions from the same runtime inventory used by the application's portable/recovery copy. Third-party browser libraries are reconstructed from pinned upstream versions, verified, browser-smoke-tested from `file://`, and the final ZIP must reproduce byte-for-byte before it can be published.


## Installed layout

The normal visible installation is:

```text
Dashboard Interface/
├── 00 - OPEN DASHBOARD.html
└── System Files/
```

A root `index.html` compatibility document may remain hidden on migrated Windows installations so Edge keeps the original `file://` document path and its browser-local storage context.

Inside `System Files/`:

- application/runtime files live at the top level, under `assets/`, and under `vendor/`;
- protected operational state lives under `Workspace/`;
- System Updates changes only approved application/runtime files;
- rollback backups live under `Workspace/backups/system-updates/`.
- backup retention is automatic and bounded: validated full backups are kept densely for 30 days, then one per month for 12 months, with the newest three always preserved and a fresh rolling backup every 30 days; resolved system-update rollbacks keep at most 3 for 30 days; restore-safety backups keep at most 2 for 30 days; automatic pre-change backups keep at most 50 for 30 days.

The connected workspace is not a multi-writer database. One browser installation is designated as the authoritative writer. A copied or independently synchronized workspace does not inherit write authority and remains read-only.

## Update safety

System Updates verifies the public manifest and package SHA-256, performs a protected-path dry run, requires explicit installation approval, creates and verifies a rollback backup before writes, verifies installed bytes, and rolls back or exposes recovery if verification cannot complete.

Stable 0.10.14 publishes only generic application changes. It does not publish or overwrite customer, employee, advisor, technician, RO, VIN, report, history, settings, backup, or store-specific source-adapter data.

## Repository boundary

All reviewed first-party browser runtime files used by the current application are tracked here. Third-party license notices and reproducible dependency-source declarations are also tracked. The pinned JSZip, PDF.js, and SheetJS browser binary bundles are intentionally reconstructed during CI instead of being mirrored as opaque repository binaries.

A source checkout is therefore still source, not the end-user installer. The formal Stable clean-install ZIP is the distribution artifact: it includes the verified browser bundles, an empty protected workspace, an install manifest with per-file SHA-256 hashes and dependency provenance, and the local launcher needed for first-run setup.

**GitHub may contain the product. GitHub may never contain the dealership.**

See [Operating Intelligence](docs/OPERATING-INTELLIGENCE.md) for Home refresh prompts, locally learned update cadence, SAPR working-day comparisons, and responsive meeting cards.
