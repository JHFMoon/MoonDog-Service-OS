# Browser-only MoonDog feasibility lab (synthetic only)

This standalone lab **does not run the dashboard**. It proves three prerequisites to a PWA transition without asking for an executable, ZIP extraction or a Windows Desktop folder: OPFS isolation for two randomly named synthetic stores, durable byte verification after reopening a handle, and narrow offline service worker caching.

It is deliberately unlinked from the production Repair Center. Never import or enter operational data. Clearing the browser profile's website data destroys local OPFS, so this is not yet acceptable dealership storage or a backup system. Browser persistence is checked but not presumed.

Run a local HTTPS or localhost static server and browse to `/web-lab/index.html` in current Edge/Chromium. Create two synthetic test stores, reload the page, and confirm the count remains two. Then use offline mode to test the service worker's static cache. This does **not** prove real report ingestion, durable store configuration, backup/restore, production offline synchronization, update recovery or Windows/Edge physical field behavior.

Before real deployment: unify the current production runtime with an HTTPS-served authority; implement and prove the private Workspace adapter, recovery/exportable backups, strict store separation, file and scheduler semantics, quota handling, service-worker versioning/rollback, offline restart, and the existing Guided Setup/SAPR/RO/report calculations. Public site workflow or Stable changes remain separately protected.
