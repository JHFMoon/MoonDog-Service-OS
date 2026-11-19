# MoonDog browser-only synthetic preview — NOT a production installation

This is an isolated browser-only installation-test path, **not** a replacement for the existing local `file://` MoonDog release or a dealership-ready app.

- Requires desktop Microsoft Edge supporting OPFS, Web Locks and module service workers.
- The user selects the **original official Stable ZIP** through a normal file input; the website verifies its SHA-256 and full clean-install inventory. The browser handles ZIP extraction to OPFS automatically. **No EXE, PowerShell, ZIP extraction in Explorer, or Windows directory picker** is required.
- The actual immutable Stable browser application files are stored under a newly generated, isolated OPFS store. A service worker serves only SHA-verified public runtime files. Its reviewed script overlay connects the existing dashboard to the selected browser-private Workspace; all app files are read-only through the bridge.
- The service worker caches **only a fixed list of public preview-shell files** for offline restart. Workspace, reports, store settings, operational data and exports are never entered into CacheStorage or uploaded.
- UI allows **synthetic test data only**. External backup and restore proofs are staged separately but not wired to app operation or proven on real Edge, so no real dealership data may be imported or entered. Browser site-data deletion erases the private store. The service worker/app shell is not a substitute for verified independent backups.
- Opening a second browser tab for the same store is blocked by an exclusive Web Lock; the existing app write-authority rules remain in place. Full startup, Guided Setup, imports, backup/restore, recovery and multi-tab field proof remain required before operational rollout.
- `modules/*.mjs` are exact reviewable copies of `src/pwa/*.mjs`, enforced by `tests/pwa-web-preview.test.cjs` because the existing Pages workflow copies only `distribution/site`.
- No Stable promotion, protected publisher workflow edits, real-store migration or Windows installation is performed by this preview.

The separate CI browser smoke, when run, uses a synthetic browser profile and the official built Stable ZIP to verify the real dashboard opens, connects to browser-private Workspace and reloads offline. Passing it does not constitute real dealership or Windows/Edge field proof.