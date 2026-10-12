# Pull request safety checklist

Before merging a public change:

- [ ] No real customer, employee, advisor, technician, contact, VIN, repair-order, report, history, backup, Files To Learn, diagnostics, or store-specific configuration is included.
- [ ] No credentials, tokens, private keys, machine-specific state, or local Workspace contents are included.
- [ ] Examples and fixtures are synthetic.
- [ ] Stable is unchanged unless an explicit Stable promotion was authorized.
- [ ] Runtime changes either carry the verified Beta package or are eligible for the guarded post-merge Beta packager.
- [ ] Publication Check and Clean Install Proof pass on the exact PR head.

Do not paste sensitive findings into this pull request. Use redacted category/count reporting only.
