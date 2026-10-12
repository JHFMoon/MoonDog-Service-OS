# Shared report-source learning — retired

This proposed cross-store sharing feature was explicitly retired and is not part of MoonDog Service OS.

- No opt-in control for cross-store report-source sharing appears in Tools or Settings.
- No cross-store upload, submission, network endpoint, or opt-in settings API is provided.
- MoonDog may check GitHub for application updates and download verified application packages. No Workspace files, customer records, locally entered report-source locations, or correction history are transmitted by this process.
- The private **Get it from** descriptions remain local to each Workspace and help staff retrieve source reports. They are not shared.
- Files To Learn remains a separate, local ingestion/triage workflow. It is not a correction-learning database, not a cross-store sharing channel, and must not upload local Workspace content.
- Report adapters and interpreter behavior change only through reviewed source updates and instructions, not by silently accumulating a local correction database.

Any future external sharing capability would require a new explicit user decision and separate security review. This retired design must not be re-enabled through an existing settings flag.
