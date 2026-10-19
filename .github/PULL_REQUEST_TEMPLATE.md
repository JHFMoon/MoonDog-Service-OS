# Pull request safety checklist

Before merging a public change:

- [ ] No real customer, employee, advisor, technician, contact, VIN, repair-order, report, history, backup, Files To Learn, diagnostics, or store-specific configuration is included.
- [ ] No credentials, tokens, private keys, machine-specific state, or local Workspace contents are included.
- [ ] Examples and fixtures are synthetic.
- [ ] Git commit trailers only credit actual contributors; never use `ci@users.noreply.github.com` to identify MoonDog automation.
- [ ] Stable is unchanged unless an explicit Stable promotion was authorized.
- [ ] Runtime changes either carry the verified Beta package or are eligible for the guarded post-merge Beta packager.
- [ ] Publication Check and Clean Install Proof pass on the exact PR head.

Do not paste sensitive findings into this pull request. Use redacted category/count reporting only.

## Roadmap acceptance and automatic closure handoff

- Linked issue(s): #___ (or state why none).
- Acceptance criterion ID(s): ___ (example `164-05`).
- Actual production change / synthetic fixture and tests: ___.
- Required protected Beta package: pending / published / not needed (test-only).

A criterion may only be marked `**VERIFIED COMPLETE**` after its real acceptance requirement has been satisfied, tested and protected-merged, with a trusted published Beta for runtime changes. Then update **both** `docs/ROADMAP-ACCEPTANCE-MATRIX.md` and `docs/ISSUE-CLOSEOUT-EVIDENCE.json` in a reviewed PR. The protected Python CI suite rejects VERIFIED COMPLETE entries that are missing structured evidence. For cumulative engineering, cite all contributing PRs using `prs: [123, 124]` (or the legacy `pr: 123`) and the real regression paths those PRs delivered.

Missing owner-run Windows/Edge/OneDrive field tests **never** block closure. Do not claim synthetic CI measures physical-device behavior. Do not put `Closes #164` or another umbrella issue's automatic-close keyword in a partial engineering PR. Automated closure is handled by the trusted evidence evaluator.

