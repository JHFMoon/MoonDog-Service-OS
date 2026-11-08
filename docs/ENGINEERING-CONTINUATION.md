# MoonDog engineering continuation

This replaces the historical continuation ledger. Reconcile live main, manifests, open PRs and CI before continuing. Earlier execution details remain in their PRs, issues and acceptance documents; they are not current instructions.

## Verified source and release baseline

Protected PR #793 merged as `662451d60e0f6e1652a9d163e77f9384547187b2` after James approved exact head `ada82cf724eca2f1318a477f62a38036e7ee22a7`. Its Publication run `42494467787` and Clean Install run `42494468000` passed: 237 Python tests, 1,685 disjoint Node tests, both complete history scans, deterministic ZIP and full packaged browser/install proof. Required checks and GitHub protection were preserved.

Beta remains `0.10.18-beta.403`, SHA-256 `447a8958afb1547f89adba047f387e10690be2cddbeea8ee5b4c8a7a4e384356`. Stable remains `0.10.17`, SHA-256 `10d9801feb53063c5b88ea69e3250622b498bfbef04aef58cd8f1ffe08bf6141`. The 7,087,504-byte Beta was independently hashed after both a raw download and connected GitHub blob retrieval. This ledger update changes documentation only; read live GitHub for its eventual merge SHA.

Observed Publication wall time was 13m24s on baseline run `42491019953` and 9m38s on protected PR #793 run `42494467787`. These are GitHub observations, not controlled hardware benchmarks. Both full-history scanners remain; their execution overlaps. The final full browser proof was retained and is not claimed faster. Record subsequent ordinary-path measurements in #799.

## Ordinary ChatGPT route

During the active conversation, use connected GitHub actions to inspect source, create/update a branch, commit the smallest correct change, open/update its PR, inspect automatically triggered CI, correct failures, allow eligible guarded merge and independently verify main plus the published Beta digest. Follow [Direct ChatGPT engineering](DIRECT-CHAT-ENGINEERING.md) and the live [release authorization](RELEASE-AUTHORIZATION.md).

No separate coding agent, external reviewer, Work session, manual Git commands, owner status relay or manual CI dispatch is required for eligible routine changes. A local runtime is optional tooling. The repository cannot grant tools missing from a particular ChatGPT session, operate another store's files or provide indefinite background implementation. Do not default to writing another execution prompt or asking James to say “Continue.”

For large files, the GitHub file-content endpoint may return an empty body with a valid blob SHA. Fetch that immutable blob and hash its actual bytes. An empty response or Git blob SHA is not the manifest's SHA-256 proof. The Beta verification above exercised this connected-tool fallback without a local runtime. Missing/truncated bytes block a verification claim.

Standing authorization covers ordinary implementation, focused testing, corrective commits, PRs and qualifying Beta publication. Protected updater/security/release controls and critical preservation tests retain one separately authorized exact-head review/bootstrap after complete evidence. A workflow cannot approve its own controls. Stable promotion, real-store installation, destructive operations and private Workspace access retain separate authorization.

## Verification

The trusted immutable-base classifier uses the complete exact-tree diff, including deleted/renamed paths. Non-policy Markdown uses publication/package/source boundary checks. Beta-only metadata with unchanged software/tests/dependencies and Stable retains deterministic ZIP, extracted smoke and verified package installation. Shared runtime, UI, imports, calculations, persistence, recovery, updates, security, tests and unknown scope retain focused production regressions plus the complete wider functional/browser proof. Candidate classifiers cannot reduce their own bootstrap proof.

Required Publication Check depends on successful functional/publication proof and both full-history scans. Failed, cancelled, skipped and missing results remain blocking. The scans run independently; no unauthenticated object cache or stale head substitutes for them. Separate release/artifact/discussion and scheduled all-ref audits remain. Four pinned public library cache files are rehashed against reviewed SHA-256 pins before ZIP builds. Obsolete PR browser heads are cancelled; trusted packaging refuses stale authority before expensive work.

This meaningful documentation correction also exercises the ordinary route after #793. Its GitHub history, rather than this text, establishes whether automatic merge succeeded without formal review metadata.

## Separate product work

- #797 remains open for its own self-healing acceptance. PR #798 shipped recurring software repair, installation-bound journals and a standalone recovery page in Beta .403. Synthetic proof does not establish native folder permissions, physical Windows/OneDrive or another store installation.
- #59 remains open for remaining data authority, cross-view lineage, scheduler, recovery, history readiness and bounded health checks. Reuse existing evidence and PRs #773/#782; #781 handles protected test CRLF compatibility. Release-process improvements do not establish product acceptance.
- #58 is closed with scoped synthetic performance evidence. Preserve its guards. The owner removed mandatory physical testing as an issue-closure gate; voluntary device diagnostics do not justify reopening completed software criteria.
- #212 remains deliberately deferred. #784's installation-check site and #780's portable-publisher proposal are separate. Do not introduce a competing publisher or bypass package reservations.

Use synthetic fixtures only. No real dealership data, real installation, Stable promotion, Workspace migration or distributed OneDrive atomicity is claimed.
