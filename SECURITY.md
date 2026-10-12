# Security Policy

## Scope and trust boundary

This is the public source and software-update repository for the user-facing **Service Operations Dashboard**. The installed Dashboard and its dealership data remain local to the end user's machine. GitHub is not an operational data store and is not a destination for application uploads.

Customer, employee, advisor, technician, repair order, VIN, contact, report, history, settings, backup, Files To Learn, credentials, and diagnostics containing real dealership data must never be committed or included in update packages. Examples and tests must use synthetic data.

## Security requirements

- Update traffic flows from GitHub to the local installation. The application does not automatically upload operational data or telemetry to this repository.
- Stable is the default update channel. Beta requires explicit opt-in.
- Installation always requires user approval.
- Before replacing installed files, the updater verifies the intended version, compatibility, package SHA-256, approved paths, and file hashes.
- Update packages may contain application files only. Protected local paths such as `data/` and `backups/` are not valid package targets.
- A rollback backup is created and verified before application-file writes.
- Installed bytes are read back and verified. Failed installs roll back when possible; interrupted transactions retain explicit recovery information.
- `backups/system-updates/` is reserved for updater/recovery records and excluded from ordinary housekeeping.
- Local store configuration, including source-adapter mappings, is never published in source or update packages.
- Files to Learn rescans, report parsing, and derived observations remain local.
- Every public change must pass the publication boundary checks before it is treated as release-ready.

`.gitignore` is an accident-reduction measure, not a security boundary.

## Continuous public-data guard

The repository is public, so every branch and tag must be treated as public the moment it is pushed. Publication Check validates the current source/package boundary on pull requests and `main`. The separate **Public Repository History Safety Audit** scans all reachable branch/tag history, commit and tag messages, commit identities, historical paths, and supported secret/PII indicators. It runs on pull requests, every `main` push, daily, and on manual request.

After changes reach `main`, the same safety workflow also audits public GitHub surfaces outside ordinary Git blobs, including release metadata/assets, retained Actions artifacts, issue/PR bodies, issue comments, and PR review comments. The audit records only redacted category counts; matched sensitive values are never printed or persisted by the audit.

The guards fail closed for blocked operational paths, local state, common report/document/image formats, credentials/secrets, unsafe email addresses, valid VIN-shaped identifiers, SSN-shaped identifiers, and other defined exposure candidates. Findings require review; a match is not automatically proof that real dealership data was exposed.

## Reporting a problem

Do not put sensitive data in a public issue. Use GitHub's private vulnerability reporting for this repository if available, or contact the repository owner privately.

If operational data appears in a public commit, package, issue, or release, treat it as an exposure requiring prompt containment and review of repository history and any downstream copies. Deleting only the latest file is not sufficient.
