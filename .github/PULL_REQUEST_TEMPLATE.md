# Pull request safety checklist

Before merging a public change:

- [ ] No real customer, employee, advisor, technician, contact, VIN, repair-order, report, history, backup, Files To Learn, diagnostics, or store-specific configuration is included.
- [ ] No credentials, tokens, private keys, machine-specific state, or local Workspace contents are included.
- [ ] Examples and fixtures are synthetic.
- [ ] Git commit trailers only credit actual contributors; never use `ci@users.noreply.github.com` to identify MoonDog automation.
- [ ] Stable changes are proposed only through a reviewed PR and the existing Stable Release workflow.
- [ ] Runtime changes either carry the verified Beta package or are eligible for the guarded post-merge Beta packager.
- [ ] Publication Check and Clean Install Proof pass on the exact PR head.

Do not paste sensitive findings into this pull request. Use redacted category/count reporting only.


## Automatic merge authorization

MoonDog-Auto-Merge: yes
