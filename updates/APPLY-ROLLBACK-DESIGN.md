# Browser-only apply and rollback design

This is a design contract, not an updater. No code in this phase opens, writes, or deletes local files. `apply-design-model.js` is an in-memory model used only to test the path and transaction rules. Production MoonDog is unchanged.
The future end-user flow uses only Edge/Chrome browser APIs and HTML/CSS/JavaScript/JSON; Node runs repository tests only, never on an end-user PC.

## Browser access and reconnection

- Target Edge or Chrome in a secure browser context. A user starts the operation with a click, chooses the local MoonDog application folder with `showDirectoryPicker({ mode: "readwrite" })`, and separately chooses a backup folder outside that application folder. Reject the same folder or overlapping parent/child folders before writing. Never infer a folder from a path string or select one silently. [Directory picker requirements](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker)
- Before reading or writing, check each handle with `queryPermission({ mode: "readwrite" })`; if needed, request permission from a user gesture. Permission may be denied, revoked, or lost between visits. Do not assume that a saved handle is still authorized. [Permission behavior](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemHandle/queryPermission), [Chrome permission guidance](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)
- Do not store handles in this phase. After a reload or lost permission, the user reselects both folders and grants access again. If an unfinished backup journal exists, offer recovery before any new update. If the File System Access API is unavailable, permission is denied, or the user cancels, stop before touching application files. There is no alternate runtime or automatic fallback.

## Approved targets

Only files in a trusted allowlist supplied by the installed application may be targets. A future package cannot add itself to that allowlist. Validate every package path as a relative, canonical path; reject traversal, absolute paths, Windows drive/UNC forms, case-insensitive duplicates, protected directories, local-state filenames, report/source file types, and any file outside the allowlist. Resolve each approved path under the selected application-folder handle only. Never replace a whole directory or recursively delete one.

Protected paths include `data/`, `history/`, `backup/`, `backups/`, `reports/`, `exports/`, `logs/`, `temp/`, `tmp/`, `Files to Learn/`, `Drop Reports Here/`, report inboxes, settings/state directories and JSON files, credentials, secrets, customer/employee/contact/RO/store data directories, report/source formats such as XLSX, XLS, CSV, PDF, and archives, and external-runtime files such as EXE, Python, and PowerShell. These are denied even if a package lists them. Operational data and the separate backup folder are never update targets.

## Transaction sequence for a future implementation

1. Require a package that passed SHA-256 verification. Validate its per-file inventory and installed-version compatibility. Block concurrent update attempts and stop if target files change during preflight.
2. Before the first application-file write, make a new, uniquely named backup in the separate user-selected folder. Record the existence and exact bytes of every installed application file in the trusted catalog, plus an absence marker for each approved new target. Write a recovery journal with paths and hashes, then read back every backup item and the journal. Any backup or read-back failure stops before application-file mutation. Keep this backup; do not overwrite an earlier backup.
3. Mark the journal as applying. Replace only approved application files, one at a time, through file handles and `createWritable()`; close and read back each file to verify exact bytes. [Browser write semantics](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)
4. If any apply or verification step fails, restore every original target from the backup, and remove only approved targets that were absent beforehand. Read back every restored file and confirm original path presence and byte hashes. Protected paths are outside this rollback set. A successful apply or rollback retains the backup and journal for recovery review.
5. If permission, storage, browser, or machine failure prevents completed rollback, keep the backup and journal intact, block further updates, and require the user to reconnect the folders and finish recovery. Do not claim that the original state is restored until its bytes and file presence are verified.

The intended exact-state guarantee covers application-file bytes and whether each target file existed. Browser file APIs cannot promise preservation of every filesystem timestamp or ACL, and no browser can guarantee automatic rollback after lost access or hardware failure. A retained, read-back-verified backup is the recovery path in those cases. No install, migration, rollback execution, or production integration is implemented here.
