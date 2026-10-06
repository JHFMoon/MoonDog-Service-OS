# Architecture

## Authority and direction

This public repository is the development and release authority for the generic Service Operations Hub application core, update logic, tests, and release metadata. The installed Hub runs from local files and owns its local operational state, reports, settings, history, and recovery records.

```text
GitHub: generic source + verified update packages
                    |
                    | user-approved update only
                    v
Local Service Operations Hub: application + protected store configuration + operational data
```

There is no automatic application path that uploads dealership operational data to GitHub.

## Client runtime

The end-user application is browser-only: HTML, CSS, JavaScript, and JSON. Normal operation requires no Python, Node, PowerShell, EXE, service, or registry change on end-user PCs. Python and Node in this repository are used only for CI, tests, and release validation.

The installed Hub remains offline-capable. Internet access is used for update checks/downloads and is separate from normal OneDrive synchronization.

## Public source vs local configuration

GitHub-authoritative application source includes `index.html`, `assets/app.js`, reviewed application modules, updater code, tests, schemas, and release packages.

Store identity, advisor/employee mappings, report-specific aliases, source-adapter parameters, operational state, reports, history, backups, and machine/browser state stay local. The source transition uses protected local configuration, including `data/settings.json` and the one-time `data/source-adapter-bootstrap.json` handoff described in [SOURCE-OF-TRUTH.md](SOURCE-OF-TRUTH.md).

Missing or invalid required local adapter configuration stops connection before normal application writes.

## Update contract

`updates/manifest.json` publishes independent Stable and Beta channels. Each channel declares its version, package URL, SHA-256, minimum compatible version, migration flag, and release notes.

Current channels:

- Stable: `0.10.8`
- Beta: `0.10.9-beta.8`

Beta is opt-in. Installation is never automatic.

The installed **Tools → Change how Service Operations Hub works → System Updates** page uses the browser-native updater modules under `assets/`. A user-triggered install:

1. checks the selected channel,
2. downloads the package in memory,
3. verifies the package SHA-256 and release contract,
4. performs a dry run against the approved application-file allowlist,
5. requires explicit confirmation,
6. creates and verifies a rollback backup under `backups/system-updates/`,
7. writes only approved application files,
8. reads installed bytes back for verification, and
9. rolls back or exposes explicit recovery when verification cannot complete.

Update packages cannot contain operational data or target protected local paths. Stable coverage must be able to restore every application file touched by the active or retained Beta path. Beta releases cannot require irreversible migrations.

## Update backup isolation

`backups/system-updates/` belongs only to updater and recovery logic. Normal maintenance and housekeeping skip that subtree completely. Disaster/full-system backups remain separate.

## Offline operation

After installation, Service Operations Hub runs from local application files and local data. GitHub is not a runtime host. If GitHub is unavailable, normal already-local Hub operation continues; only update availability/download functions are affected.

## Repository validation

Every pull request and push to `main` runs `.github/workflows/publication-check.yml`. The workflow runs Python release/publication tests, Node updater tests, and the tracked-publication boundary check.

The local production workspace remains the authoritative operational environment. Multi-device write coordination remains out of scope until a real shared transactional coordination layer exists.
