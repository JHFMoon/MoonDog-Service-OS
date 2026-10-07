# Stable release process

Stable is a formal GitHub Release, not only an updater-manifest entry.

For every Stable version `X.Y.Z`, all of the following must agree:

- `updates/manifest.json` publishes Stable version `X.Y.Z`.
- The Stable package is `updates/packages/moondog-X.Y.Z.json`.
- The package SHA-256 exactly matches the Stable manifest.
- The Stable package URL is the GitHub Release asset:
  `https://github.com/JHFMoon/MoonDog-Service-OS/releases/download/vX.Y.Z/moondog-X.Y.Z.json`.
- The formal GitHub Release tag is `vX.Y.Z`.
- The GitHub Release contains that exact package as an asset.
- The release is not a draft or prerelease.
- The release is marked latest.

## Publication sequence

1. Finish and validate the candidate locally.
2. Update source, package, changelog, and `updates/manifest.json` together in a pull request.
3. The Publication check must pass on the pull request and on `main`.
4. After the successful Publication check on `main`, `.github/workflows/stable-release.yml` creates or verifies the matching GitHub Release.
5. The workflow verifies the release asset SHA-256 against the Stable manifest before considering publication complete.

The updater may advertise a Stable version only through the package URL declared in the Stable manifest. That URL must be the matching GitHub Release asset.

## Repair behavior

If the formal release is missing, the Stable-release workflow creates it from the validated `main` commit.

If the release exists but the package asset is missing, the workflow uploads the verified package.

If the release asset exists but its SHA-256 differs from the manifest, the workflow fails instead of silently replacing a published Stable asset. Publish a new Stable version to correct an immutable-release mismatch.

## Beta

Beta remains an opt-in test channel. Beta packages may continue to use the repository package path while under test. A Beta becomes public Stable only when the exact validated build is promoted to a Stable version and the formal GitHub Release contract above is satisfied.

When the Beta package is self-contained and requires no migration, it must support the same oldest compatible installed architecture as Stable. Do not force users to install an intermediate Stable release without a verified technical dependency. The current 0.10.12-beta.1 is installable directly from the 0.10.9 layout-aware updater; 0.10.8 remains unsupported. A documented Beta-only migration can justify a different minimum, but it requires an explicit compatibility and rollback test before promotion.
