/**
 * A zero-file-picker package transport for MoonDog's SYNTHETIC web preview.
 *
 * The official immutable Stable release SHA in the site's reviewed latest.json
 * remains authoritative. A future publisher may expose the matching ZIP at a
 * same-origin versioned URL; until then this code must fail closed, not fetch
 * GitHub release assets via an unreliable cross-origin browser redirect.
 *
 * This is a public SOFTWARE transport. Never transport or cache Workspace data.
 */
const MAX_ZIP_BYTES = 64 * 1024 * 1024;
const VERSION = /^\d+\.\d+\.\d+$/;
const SHA = /^[0-9a-f]{64}$/;
const fail = message => { throw new Error(message); };

export function verifiedSitePackageUrl({siteUrl, version, sha256} = {}) {
  const site = new URL(siteUrl);
  if (site.protocol !== 'https:' || site.search || site.hash ||
      !site.pathname.endsWith('/web-preview/') || !VERSION.test(version || '') ||
      !SHA.test(sha256 || '')) fail('A trusted website and Stable package fingerprint are required.');
  const packageUrl = new URL('./packages/moondog-' + version + '.zip', site);
  if (packageUrl.origin !== site.origin || !packageUrl.pathname.startsWith(site.pathname))
    fail('Package URL escaped the trusted MoonDog website.');
  return packageUrl.href;
}

function boundBytes(response) {
  const declared = response.headers?.get?.('content-length');
  if (declared != null && declared !== '') {
    const size = Number(declared);
    if (!Number.isSafeInteger(size) || size < 1 || size > MAX_ZIP_BYTES)
      fail('Website package has an invalid or excessive length.');
  }
}

function trustedResponse(response, expectedUrl) {
  if (!response?.ok || response.type === 'opaque' || response.redirected ||
      response.url !== expectedUrl)
    fail('Trusted MoonDog website package is unavailable or redirected.');
  boundBytes(response);
}

function requireEnvironment(cryptoImpl, fetchImpl) {
  if (typeof fetchImpl !== 'function' || typeof cryptoImpl?.subtle?.digest !== 'function')
    fail('Secure package download and verification are unavailable.');
}

function options(method, signal) {
  return {method, mode:'same-origin', credentials:'omit', redirect:'error',
    cache:'no-store', ...(signal ? {signal} : {})};
}

export async function probeSitePackage({siteUrl, version, sha256, fetchImpl, crypto: cryptoImpl, signal} = {}) {
  const url = verifiedSitePackageUrl({siteUrl, version, sha256});
  requireEnvironment(cryptoImpl, fetchImpl);
  try {
    const response = await fetchImpl(url, options('HEAD', signal));
    trustedResponse(response, url);
    return true;
  } catch (_) { return false; } // Not published is a normal, non-authorizing state.
}

export async function fetchVerifiedSitePackage({
  siteUrl, version, sha256, fetchImpl, crypto: cryptoImpl, signal
} = {}) {
  const url = verifiedSitePackageUrl({siteUrl, version, sha256});
  requireEnvironment(cryptoImpl, fetchImpl);
  const response = await fetchImpl(url, options('GET', signal));
  trustedResponse(response, url);
  if (typeof response.body?.getReader !== 'function')
    fail('A bounded streaming download is required for a verified installation.');
  const reader = response.body.getReader();
  const blocks = [];
  let length = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) fail('Package download contained invalid bytes.');
      length += value.byteLength;
      if (length > MAX_ZIP_BYTES) fail('Website package exceeds the allowed size.');
      blocks.push(value);
    }
  } catch (error) {
    try { await reader.cancel(); } catch (_) {}
    throw error;
  }
  if (!length) fail('Website package was empty.');
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const block of blocks) { bytes.set(block, offset); offset += block.length; }
  const hash = Array.from(new Uint8Array(await cryptoImpl.subtle.digest('SHA-256', bytes)),
    item => item.toString(16).padStart(2, '0')).join('');
  if (hash !== sha256) fail('Website package SHA-256 does not match the official Stable release.');
  return bytes;
}
