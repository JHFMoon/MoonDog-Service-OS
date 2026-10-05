# MoonDog Service OS

MoonDog Service OS is a locally operated service department application. This public repository is the authority for product architecture, distributable code, and future update definitions.

The running application and all dealership operational data stay on each end user's machine. Customer, employee, repair order, VIN, contact, report, history, settings, backup, and Files to Learn data do not belong in this repository.

## Repository boundary

Public content may include product structure, code, parser definitions, schemas, update logic, tests, and documentation using synthetic examples. See [Data Boundary](docs/DATA-BOUNDARY.md) and [Architecture](docs/ARCHITECTURE.md).

No application release or update package is published yet. This repository currently contains only the Phase 1 foundation.

## Future updates

The intended update flow is GitHub to a local installation only. Stable is the default channel; beta requires user opt-in. The user applies an update after verification, with a rollback path. A successful update may rescan Files to Learn locally; the files and results remain local.

`.gitignore` reduces accidental inclusion but does not protect data that is force-added, already tracked, or embedded in otherwise allowed files. Check every future change and release for operational data before publication.
