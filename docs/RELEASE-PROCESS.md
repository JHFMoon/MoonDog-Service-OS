# Stable release process

Stable is a formal GitHub Release, not only an updater-manifest entry.

For every Stable version `X.Y.Z`, all of the following must agree:

- `updates/manifest.json` publishes Stable version `X.Y.Z`.
- The Stable package is `updates/packages/moondog-X.Y.Z.json`.
- The package SHA-256 exactly matches the Stable manifest.
- The formal GitHub Release asset is:
  `https://github.com/JHFMoon/MoonDog-Service-OS/releases/download/vX.Y.Z/moondog-X.Y.Z.json`.
- The Stable manifest uses the **same tagged package**, served from GitHub's
  browser-compatible raw files service:
  `https://raw.githubusercontent.com/JHFMoon/MoonDog-Service-OS/vX.Y.Z/updates/packages/moondog-X.Y.Z.json`.
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

A Stable version is not complete without its matching formal GitHub Release and
attached asset. Because `file://` browser pages cannot reliably fetch GitHub
Release download assets (the redirects lack CORS access), the updater **must not
download directly from `github.com/.../releases/download/`**. Instead, it fetches
the immutable-version **Release-tagged source mirror** above using `no-store`,
then verifies the identical package SHA-256 from the manifest. The formal
GitHub Release asset is still published and independently hash-checked by CI;
a manifest-only version is never a finished Stable publication.

The version tag, package, release asset, and manifest digest must agree.
No third-party proxy, customer data transfer, special token, or runtime service
is required. A tag-mirror URL is unavailable before the tag exists, preventing
successful installation before formal release publication.

## Repair behavior

If the formal release is missing, the Stable-release workflow creates it from the validated `main` commit.

If the release exists but the package asset is missing, the workflow uploads the verified package.

If the release asset exists but its SHA-256 differs from the manifest, the workflow fails instead of silently replacing a published Stable asset. Publish a new Stable version to correct an immutable-release mismatch.

## Beta

Beta remains an opt-in test channel. Beta packages may continue to use the repository package path while under test. A Beta becomes public Stable only when the exact validated build is promoted to a Stable version and the formal GitHub Release contract above is satisfied.

When the Beta package is self-contained and requires no migration, it must support the same oldest compatible installed architecture as Stable. Do not force users to install an intermediate Stable release without a verified technical dependency. The current 0.10.12-beta.1 is installable directly from the 0.10.9 layout-aware updater; 0.10.8 remains unsupported. A documented Beta-only migration can justify a different minimum, but it requires an explicit compatibility and rollback test before promotion.
