# MoonDog Service OS

[![Publication check](https://github.com/JHFMoon/MoonDog-Service-OS/actions/workflows/publication-check.yml/badge.svg)](https://github.com/JHFMoon/MoonDog-Service-OS/actions/workflows/publication-check.yml)

MoonDog Service OS is the public source repository for the user-facing **Service Operations Hub**, a locally operated service department application. This repository is the development and release authority for the generic application core, browser-native updater, approved update packages, tests, and release metadata.

Installed Service Operations Hub files run locally and remain offline-capable. GitHub is used for source control and software update distribution; dealership operational data remains in the local workspace.

See [Source and data boundary](docs/SOURCE-OF-TRUTH.md) for the authoritative split between public application source and protected local configuration/data. Release history is summarized in [CHANGELOG.md](CHANGELOG.md). Report-family behavior is documented in [Supplemental report ingestion](docs/REPORT-INGESTION.md).

## Repository boundary

Public content may include product structure, application code, parser definitions, schemas, update logic, tests, release metadata, and documentation using synthetic examples. See [Data Boundary](docs/DATA-BOUNDARY.md) and [Architecture](docs/ARCHITECTURE.md).

The connected local workspace remains authoritative for dealership-specific and operational information. Customer, employee, advisor, technician, repair order, VIN, contact, report, history, settings, backup, Files To Learn, conflict-copy, transaction-journal, and machine-specific data do not belong in this repository.

**GitHub may contain the product. GitHub may never contain the dealership.**

## Current update channels

The update manifest currently publishes:

- **Stable:** `0.10.8`
- **Beta:** `0.10.9-beta.8`

Both channels distribute approved application files through the browser-native updater. Stable is the default channel; Beta requires user opt-in. Store-specific performance targets remain local-only. Beta 0.10.9-beta.8 shows live install and rollback progress; earlier 0.10.9 Betas added supplemental report ingestion and the canonical CDK Open RO workflow.

Updates are checked and downloaded from GitHub, then installed locally only after user approval. The updater verifies the package, shows a dry run, protects local-only paths, creates a rollback backup before writes, verifies written files, and can restore the prior application state if installation fails.

The current application core includes GitHub-authoritative `index.html` and `assets/app.js`. Store identity, advisor/employee mappings, report-specific adapter values, operational state, performance targets, dollar goals, and other dealership-specific information remain protected in the local workspace.

This checkout is not yet a standalone installed Hub. `index.html` also references local runtime styles, the freshness and daily engines, and bundled PDF/XLSX/ZIP libraries that are not tracked here. Those installed dependencies must be preserved during updates; bringing them under public source authority requires a separate privacy and licensing review.

## Offline operation

Service Operations Hub does not run from GitHub. After installation, normal Hub operation uses local application files and local data.

Internet access is only needed for functions such as checking/downloading software updates and normal external synchronization such as OneDrive. Loss of internet does not prevent the locally installed Hub from opening and using already-local data.

## Release safety

Update packages may contain approved application-core files only. Protected local paths, including `data/` and `backups/`, are not valid package targets. `backups/system-updates/` is reserved for updater rollback records and is excluded from ordinary housekeeping.

Every push to `main` and every pull request runs the repository publication check, which validates the update contract, browser-side updater tests, and public-data boundary.

`.gitignore` reduces accidental inclusion but does not protect data that is force-added, already tracked, or embedded in otherwise allowed files. Every future change and release must be checked for dealership or operational data before publication.
