# Shared report-source sharing — retired

This proposed cross-store sharing feature was explicitly retired and is not part of MoonDog Service OS.

- No opt-in control for cross-store report-source sharing appears in Tools or Settings.
- No cross-store upload, submission, network endpoint, or opt-in settings API is provided.
- MoonDog may check GitHub for application updates and download verified application packages. No Workspace files, customer records, locally entered report-source locations, or correction history are transmitted by this process.
- The private **Get it from** descriptions remain local to each Workspace and help staff retrieve source reports. They are not shared.
- Files To Learn remains a local ingestion/triage workflow and is never a cross-store sharing channel. It must not upload local Workspace content.
- Separate, explicitly approved declarative layout mappings for supported report families may be saved locally in the connected Workspace. These mappings contain field/header and worksheet structure only; they do not retain report rows, add executable rules, or change business meaning. Unknown business semantics still require a reviewed source adapter.
- No local mapping or correction history is uploaded or shared.

Any future external sharing capability would require a new explicit user decision and separate security review. This retired design must not be re-enabled through an existing settings flag.
