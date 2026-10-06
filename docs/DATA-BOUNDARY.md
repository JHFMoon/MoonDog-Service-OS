# Data Boundary

## Allowed in this public repository

Product architecture, generic application code, parser definitions, schemas, update logic, tests, release packages, release metadata, and documentation. Examples and fixtures must be synthetic and checked for embedded real data.

## Local only

- Customer and employee information; names, contact details, VINs, and repair orders.
- Advisor/technician identity mappings and dealership-specific source-adapter configuration.
- Imported dealership reports and source workbooks, including spreadsheets, CSV, and PDFs.
- Operational state, observations, history, settings, logs, diagnostics, exports, and backups.
- Drop Reports Here and Files to Learn contents and store-specific derived records.
- Credentials, tokens, machine-specific configuration, and browser/workstation state.

This boundary applies to source commits, pull requests, update packages, GitHub Releases, issue attachments, and diagnostic output. Public code must not contain real dealership data even when its file path is otherwise allowed by `.gitignore`.

## Direction of data flow

Software updates are downloaded from GitHub into a local installation only after update checks, verification, and user approval. The application does not automatically upload local operational data to GitHub.

Successful updates may rescan Files to Learn locally; those files and derived observations remain local.

Before publishing any commit or update package, inspect its contents for dealership operational data. If data is accidentally published, stop distribution and handle the exposure across repository history and downstream copies.
