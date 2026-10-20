# Interrupted restore — safe review protocol

An interrupted whole-state restore can leave a mixture of original and restored operational files. It is **not safe** to assume that the newest backup, the oldest backup, or every file in the folder is the correct state. The Dashboard cannot lock independently synchronized OneDrive copies or other devices.

## What the Dashboard does

A persistent `System Files/Workspace/data/restore-in-progress.json` hold is written before operational restore mutations. A reconnecting browser cannot authorize edits while the hold is present. Beta 126 checks that hold **before** journal recovery or revision initialization.

On a read-only reconnect, the Dashboard may inspect the marker, validated restore-safety ZIP and original restore-source ZIP and compare their SHA-256 file inventories with the current canonical and history files. The summary counts files that match the original safety snapshot, the restore source, both, or neither. If a file cannot be read or a backup cannot be verified, the Dashboard reports that it cannot prove recovery readiness. The assessment is read-only and is a **snapshot in time**, not a distributed lock or permission to clear the hold.

## Manager / support decision procedure

1. **Do not reconnect to a different copy and keep editing.** Pause new imports and manual edits on all computers using the affected Workspace.
2. Preserve a separate, complete byte-for-byte copy of the **entire** selected Workspace, including current files, any `.moondog-txn-*.json` recovery journals, the restore marker, the source backup and the restore-safety backup. Never remove the marker as a workaround.
3. Examine the Dashboard's read-only recovery counts. Confirm both ZIPs validate, and independently inventory conflicting, missing and unreadable files using the preserved copy. A zero-conflict count alone is not authorization to resume; the files may reflect different restore stages.
4. Before any recovery action, determine which intended state to retain and identify independent edits performed after the safety backup. Obtain explicit manager approval for a documented recovery plan that accounts for those edits.
5. Use a **separate verified recovery procedure** to reconcile the preserved copy and current state. The current read-only assessment does **not** offer automatic rollback, merge, marker removal or forced write access. Validate every canonical and history file and keep an audit trail before restoring normal editing.

No developer should report recovery completed, restored customer data, cleared journals, or successful Windows/Edge/OneDrive validation without direct corresponding evidence. Synthetic CI proves software behavior, not a real user's installation.

## Fault cases to retain in regression coverage

- Missing, corrupt or inaccessible safety backup or source ZIP
- Malformed marker and unsafe/relative ZIP paths
- Original-only, restore-only and mixed canonical files
- New, missing, modified or unreadable history files
- Independent changes after the assessment (TOCTOU)
- Any recovery attempt that writes or deletes data without a separate, authorized conflict-aware process

**Related:** #164-05, #59-05 and #61-03. Keep all three partially complete until a verified controlled recovery mechanism and the remaining multi-file and reimport fault matrix are delivered.
