# Browser-only apply and rollback design

This contract has a browser-only `install.js` transaction and a System Updates control in `settings-ui.js`. `apply-design-model.js` remains an in-memory reference model. The end-user flow uses only Edge/Chrome browser APIs and HTML/CSS/JavaScript/JSON; Node runs repository tests only, never on an end-user PC.

## Browser access and reconnection

- Target Edge or Chrome in a secure browser context. The updater reuses the already-connected application root. After explicit install confirmation, it creates a unique rollback record under that root's `backups/system-updates/` directory. No backup-folder picker is required. [Directory picker requirements](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker)
- Before reading or writing, check each handle with `queryPermission({ mode: "readwrite" })`; if needed, request permission from a user gesture. Permission may be denied, revoked, or lost between visits. Do not assume that a saved handle is still authorized. [Permission behavior](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemHandle/queryPermission), [Chrome permission guidance](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)
- After a reload or lost permission, the user reconnects the application root and grants access again. Recovery reads a selected update journal only from that root's `backups/system-updates/` directory. If the File System Access API is unavailable, permission is denied, or the user cancels, stop before touching application files. There is no alternate runtime or automatic fallback.

## Approved targets

Only files in a trusted allowlist supplied by the installed application may be targets. A future package cannot add itself to that allowlist. Validate every package path as a relative, canonical path; reject traversal, absolute paths, Windows drive/UNC forms, case-insensitive duplicates, protected directories, local-state filenames, report/source file types, and any file outside the allowlist. Resolve each approved path under the selected application-folder handle only. Never replace a whole directory or recursively delete one.

Protected paths include `data/`, `history/`, `backup/`, `backups/`, `reports/`, `exports/`, `logs/`, `temp/`, `tmp/`, `Files to Learn/`, `Drop Reports Here/`, report inboxes, settings/state directories and JSON files, credentials, secrets, customer/employee/contact/RO/store data directories, report/source formats such as XLSX, XLS, CSV, PDF, and archives, and external-runtime files such as EXE, Python, and PowerShell. These are denied even if a package lists them. All `backups/` paths, including update rollback records and separate disaster/full-system backups, are never update targets.

## Transaction sequence

1. Require a package that passed SHA-256 verification. Validate its per-file inventory and installed-version compatibility. Block concurrent update attempts and stop if target files change during preflight.
2. Before the first application-file write, make a new, uniquely named backup under `backups/system-updates/`. Record the existence and exact bytes of every installed application file in the trusted catalog, plus an absence marker for each approved new target. Write a recovery journal with paths and hashes, then read back every backup item and the journal. Any backup or read-back failure stops before application-file mutation. Keep this backup; do not overwrite an earlier backup.
3. Mark the journal as applying. Replace only approved application files, one at a time, through file handles and `createWritable()`; close and read back each file to verify exact bytes. [Browser write semantics](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)
4. If any apply or verification step fails, restore every original target from the backup, and remove only approved targets that were absent beforehand. Read back every restored file and confirm original path presence and byte hashes. Protected paths are outside this rollback set. A successful apply or rollback retains the backup and journal for recovery review.
5. If permission, storage, browser, or machine failure prevents completed rollback, keep the backup and journal intact, block further updates, and require the user to reconnect the application root and finish recovery. Do not claim that the original state is restored until its bytes and file presence are verified.

The intended exact-state guarantee covers application-file bytes and whether each target file existed. Browser file APIs cannot promise preservation of every filesystem timestamp or ACL, and no browser can guarantee automatic rollback after lost access or hardware failure. A retained, read-back-verified backup is the recovery path in those cases. System Updates offers explicit recovery from an interrupted update's backup journal.
