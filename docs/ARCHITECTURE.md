# Architecture

## Authority and direction

This repository is the public source, clean-install distribution authority, and update authority for the generic Service Operations Dashboard application. The installed Dashboard runs from local files and owns its protected local operational state.

```text
GitHub source
   |
   +-- Publication check
   |
   +-- Stable updater package --------------------+
   |                                              |
   +-- clean-install build -> Release ZIP          |
   |                         -> Pages storefront   |
   |                                              v
   +--------------------------------------> local installation

Dashboard Interface/
├── 00 - OPEN DASHBOARD.html
├── index.html                  (hidden compatibility document when required)
└── System Files/
    ├── index.html
    ├── assets/
    ├── vendor/
    └── Workspace/             (protected operational data)
```

No application path uploads dealership operational data to GitHub.

## Client runtime

The end-user application is browser-only HTML, CSS, and JavaScript. Normal operation requires no Python, Node, PowerShell, EXE, service, registry change, or public runtime service.

A migrated installation preserves the original root `index.html` document path so Edge can retain the browser-local storage context used for the saved folder handle and authoritative-computer identity. The visible launcher is `00 - OPEN DASHBOARD.html`; maintained application files are under `System Files/`.

A fresh clean installation launches directly into `System Files/index.html` and uses the extracted installation root as its selected working folder.

## Operational workspace

Protected state is under `System Files/Workspace/`, including data, history, reports/inbox material, Files To Learn, imports/exports, support records, and backups.

Backup storage is managed by bounded automatic retention. Validated full backups are refreshed every 30 days, all are retained for the first 30 days, then one validated monthly recovery point is retained for 12 months, and the newest three full backups are always preserved. A full backup is never pruned unless a newer validated full backup exists. Resolved system-update rollbacks are retained at most 3 / 30 days; restore-safety backups at most 2 / 30 days; automatic pre-change backups at most 50 / 30 days. An interrupted update recovery artifact is treated as active recovery state rather than ordinary backup inventory and blocks another software installation until resolved.

Application updates target `System Files/` but must reject the protected `Workspace/` subtree.

One store has one designated authoritative writer. Browser-local authority plus a non-secret workspace marker is required before durable writes are enabled. Copied or independently synchronized workspace copies do not inherit authority and remain read-only. OneDrive synchronization is not treated as a distributed lock.

Durable changes are guarded by authority and revision checks and use persistent recovery journals. Failed or interrupted writes/deletes must not falsely advance the store revision.

## Clean-install distribution contract

`scripts/build_distribution.py` reads the same `HANDOFF_RUNTIME_PATHS` catalog used by application handoff/runtime integrity checks. The builder:

1. requires the application source version to equal the Stable manifest version;
2. rejects protected or traversal runtime paths;
3. includes only cataloged application/runtime files;
4. obtains the four pinned third-party browser runtime files from the release workflow;
5. creates only an empty Workspace folder structure;
6. rejects initialized operational-state files from the package;
7. writes a deterministic ZIP, a SHA-256 checksum, and a per-file manifest; and
8. verifies all required runtime paths before publication.

The third-party browser libraries are pinned at release-build time:

- JSZip 3.10.1;
- PDF.js 5.6.205, converted from the upstream module distribution into the classic browser bundles required by the local `file://` runtime; and
- SheetJS CE 0.20.3 from the authoritative SheetJS distribution.

The GitHub Pages site is a static storefront pointing to the current Stable release asset. It never receives local operational data.

## Update contract

`updates/manifest.json` publishes Stable and Beta channels.

Current channels:

- Stable: `0.10.14`
- Beta: `0.10.15-beta.1`

Stable 0.10.14 requires `0.10.9` or later. This is intentional: the 0.10.8-era updater cannot safely perform the application/workspace layout separation.

A Stable version is considered published only when the matching formal GitHub Release exists at tag `v<version>` and contains the exact updater package asset whose SHA-256 is declared by `updates/manifest.json`. The Stable manifest points to the **same tagged package** through GitHub's CORS-compatible raw file endpoint because browser-based local `file://` apps cannot fetch GitHub Release assets directly. The tag, manifest SHA-256, and formal Release asset must match. After the `Publication check` succeeds on `main`, `.github/workflows/stable-release.yml` creates or verifies the matching release automatically.

The installed **Tools → Change how Service Operations Dashboard works → System Updates** workflow:

1. checks the selected public channel,
2. downloads the package in memory,
3. verifies package identity and SHA-256,
4. performs a dry run against the approved application allowlist,
5. rejects protected workspace targets,
6. requires explicit confirmation,
7. creates and verifies rollback material under `System Files/Workspace/backups/system-updates/`,
8. writes approved application files,
9. verifies written bytes, and
10. rolls back or exposes explicit recovery when verification cannot complete.

When the package updates application `index.html`, the layout-aware updater also maintains the root compatibility document required by migrated installs.

## Public source vs local configuration

Generic first-party runtime source, distribution/build logic, updater logic, tests, release metadata, and reviewed third-party notices may be public.

Store identity, advisor/employee mappings, source-adapter values, targets, operational state, source reports, history, backups, browser authority credentials, and other dealership-specific information remain local.

## Validation

Every pull request and push to `main` runs the publication workflow. It also verifies the clean-install source contract. Stable distribution publication reruns those checks, builds the complete ZIP, verifies the checksum, attaches immutable-matching assets to the Stable GitHub Release, and deploys the Pages storefront.

See [Offline distribution](DISTRIBUTION.md) and [Operating Intelligence](OPERATING-INTELLIGENCE.md).
