# Security Policy

## Scope and trust boundary

This is a public source and future update repository. The installed MoonDog application and its dealership data are local to the end user's machine. GitHub is not an operational data store or a destination for application uploads.

Customer, employee, repair order, VIN, contact, report, history, settings, backup, Files to Learn, credentials, and diagnostic material containing real dealership data must never be committed or included in releases. Use synthetic data in examples and tests.

## Security requirements for future code and updates

- Update traffic flows from GitHub to the local installation. No automatic uploads or telemetry containing operational data.
- Stable is the default update channel. Beta requires explicit opt-in.
- The user chooses when to apply an update. Before replacing installed files, the updater must verify the intended version, compatibility, and artifact integrity and preserve a rollback path.
- A failed update must leave the installation recoverable and must not discard local operational data.
- Any post-update Files to Learn rescan runs locally. Its files and observations stay local.
- Future releases require a check that source, packages, logs, and examples contain no real operational data.

These are requirements for future implementation, not claims that an updater or release pipeline exists today. `.gitignore` is a guard against accidents, not a security boundary.

## Reporting a problem

Do not put sensitive data in a public issue. Use GitHub's private vulnerability reporting for this repository if available, or contact the repository owner privately. If operational data appears in a public commit or release, treat it as an exposure requiring prompt removal and review of its history and any copies; deleting the latest file alone is insufficient.
