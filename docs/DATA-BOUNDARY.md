# Data Boundary

## Allowed in this public repository

Product architecture, application code, parser definitions, schemas, update logic, tests, and documentation. Examples and fixtures must be synthetic and checked for embedded real data.

## Local only

- Customer and employee information; names, contact details, VINs, and repair orders.
- Imported dealership reports and source workbooks, including spreadsheets, CSV, and PDFs.
- Operational state, observations, history, settings, logs, diagnostics, exports, and backups.
- Drop Reports Here and Files to Learn contents and any store-specific derived records.
- Credentials, tokens, and machine-specific configuration.

This boundary applies to source commits, pull requests, release packages, issue attachments, and diagnostic output. Public code must not contain real data even when its file path is allowed by `.gitignore`.

## Direction of data flow

Future updates may be downloaded from GitHub into a local installation after user action and verification. The application must not automatically upload local operational data to GitHub. Successful updates may rescan Files to Learn locally; those files and observations remain local.

Before publishing any future commit or release, inspect its contents for real operational data. If data is accidentally published, stop distribution and handle the exposure, including repository history and release copies.
