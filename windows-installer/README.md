# Native Windows first-install foundation — NOT PUBLISHED

This folder contains source code only. **Do not distribute, run, or recommend an unsigned binary built from it.** It is a staged response to MoonDog issue #899 and does not authorize a Stable release change, signed package publication, or actual store installation.

## Intended user experience

1. Double-click the verified, code-signed installer on Windows; confirm a brand-new installation.
2. Windows Known Folder API resolves the user's Desktop, including redirected/OneDrive Desktop.
3. The installer automatically creates a **new** `Service Operations Dashboard` folder (or a unique numbered alternative), verifies the embedded official Stable ZIP's pinned SHA-256 and inventory, installs approved bytes, verifies readback, then opens the launcher in Edge when installed.
4. Complete same-store identity and validated SAPR Guided Setup **in the local app**; no store data is bundled, invented or migrated.

The public GitHub Pages installer cannot write directly to Desktop because Edge rejects protected root directory pickers. The native Windows process has different OS permission boundaries; it does not bypass browser protections.

## Release and execution gate (separately authorized)

- Obtain immutable tagged official Stable `Service-Operations-Dashboard.zip` from its verified GitHub Release; match SHA-256 `7360a65d29e61947f613f066e5cfa50b641d3fdc676fa2a774012eea34a68dce` and required inventory **before** staging under `windows-installer/package/` (untracked local build input).
- Build and test on real Windows with pinned .NET SDK and synthetic folders; include clean Windows/Edge and redirected OneDrive Desktop tests. Validate native exclusive-create collision semantics, zip validation, durable readback and launcher. Perform protected release-builder review and supply trusted code signing (Authenticode); never turn off SmartScreen or require elevated/admin rights by default.
- Owner must separately authorize protected packaging/signing, publication and actual use. Never promote Stable without separate approval. Signed release is not a field installation.

## Source-only test harness

A dependency-free .NET test runner under `tests/` exercises the same ZIP-verification and installation core with fully synthetic packages and filesystem roots. Because the active engineering environment does not have the .NET SDK or Windows/Edge, these tests are **not yet executed**; CI/Windows results are mandatory. No unsigned executable or private dealership data is committed.

## Recovery guarantee and limits

- The destination is exclusively created; existing files and Workspace are never adopted.
- Every approved file is created with `FileMode.CreateNew` and read back. The signed inventory is written last. Interrupted installs leave `MOONDOG-INSTALL-INCOMPLETE.txt` and should not be used.
- Concurrent desktop sync processes and filesystem reparse behavior require Windows/OneDrive field validation; this is not a transactional or distributed filesystem lock. An incomplete folder is retained rather than deleted or silently overwritten.
