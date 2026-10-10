# Shared report-source learning (Beta design)

## Safety and lifecycle

MoonDog remains local-first. Store-specific `Get it from` strings are persisted only under the connected Workspace's existing settings. No free-text strings, customer information, paths, or Workspace files are transmitted by this feature.

This Beta stage exposes store-scoped consent in Tools > Settings; consent does **not** activate network requests. `deliveryConfigured` remains false until a separately reviewed secure submission endpoint is provisioned and verified. The user can disable consent at any time.

## Serverless implementation gate

Before enabling outbound submission, implement and test a managed HTTPS endpoint (e.g., Cloudflare Worker or Azure Function) with:
- A restricted schema containing only source type identifiers and reviewed navigation tokens; never send arbitrary strings.
- Deny-by-default tokenization. Private paths, hostnames, emails, account/store names, URLs, arbitrary notes and unknown values are not eligible.
- Authentication, rate limits, anti-abuse controls, bounded storage, deletion policy and tamper-resistant audit.
- An independent review/validation step before publishing suggestions as shared guidance.
- Opt-in default false, no background work on startup, fail-open for UI operation **but fail-closed for sending**.
- Test that opt-out and offline mode send zero requests.
- Keep any shared suggestions advisory; never overwrite individual Workspace locations.

Do not configure a generic webhook or public anonymous write endpoint: it would leak user-written data or allow spam. This feature is intentionally staged until a secure endpoint exists.
