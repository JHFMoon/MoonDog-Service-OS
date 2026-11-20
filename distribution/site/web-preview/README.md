# MoonDog browser-only synthetic preview — NOT a production installation

This is an isolated browser-only installation-test path, **not** a replacement for the existing local `file://` MoonDog release or a dealership-ready app.

- Requires desktop Microsoft Edge supporting OPFS, Web Locks and module service workers.
- **Two synthetic installer transports:** A future verified same-origin website package can be fetched with *no file or directory picker*; until that exact approved ZIP is published at the fixed versioned `web-preview/packages/moondog-<version>.zip` path, the direct button stays disabled and clearly explains why. The existing official Stable ZIP file-input fallback still verifies the SHA-256 and full package inventory, then installs privately into OPFS. No EXE, PowerShell, Explorer extraction or Windows directory picker is required for either path.
- The actual immutable Stable browser application files are stored under a newly generated, isolated OPFS store. A service worker serves only SHA-verified public runtime files. Its reviewed script overlay connects the existing dashboard to the selected browser-private Workspace; all app files are read-only through the bridge.
- The service worker caches **only a fixed list of public preview-shell files** for offline restart. It does not cache the prospective official ZIP transport or private data. Workspace, reports, store settings, operational data and exports are never entered into CacheStorage or uploaded.
- UI allows **synthetic test data only**. Close the dashboard before preparing a backup. Download the verified Workspace snapshot and save its receipt separately. Recovery requires that receipt, the backup file, and the same verified software from the site. It creates a new isolated store, verifies durable readback, and offers the dashboard only after completion. Browser site-data deletion erases the private store.
- Opening a second browser tab for the same store is blocked by an exclusive Web Lock; the existing app write-authority rules remain in place. Full startup, Guided Setup, imports, backup/restore, recovery and multi-tab field proof remain required before operational rollout.
- `modules/*.mjs` are exact reviewable copies of `src/pwa/*.mjs`, enforced by `tests/pwa-web-preview.test.cjs` because the existing Pages workflow copies only `distribution/site`.
- No Stable promotion, protected publisher workflow edits, real-store migration or Windows installation is performed by this preview.

Browser verification uses a fresh Chromium profile and the published Stable ZIP. It checks the real dashboard, its Workspace connection and offline reload. Windows Edge field testing and production recovery remain separate.
