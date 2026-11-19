// Cache only public synthetic-lab program files. Never cache any request or response
// outside this exact allowlist, and never accept operational report uploads.
'use strict';
const CACHE = 'moondog-synthetic-pwa-lab-v1';
const BASE = new URL('./', self.registration.scope);
const URLS = ['index.html', 'workspace.mjs', 'lab.mjs', 'style.css', 'app.webmanifest', 'icon.svg']
  .map(path => new URL(path, BASE).href);
const ALLOWED = new Set(URLS);
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const url of URLS) {
      const response = await fetch(url, { cache: 'reload', credentials: 'omit' });
      if (!response.ok || response.type === 'opaque') throw new Error('Lab asset unavailable');
      await cache.put(url, response);
    }
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('moondog-synthetic-pwa-lab-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || !ALLOWED.has(event.request.url)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const stored = await cache.match(event.request, { ignoreSearch: false });
    if (stored) return stored;
    return fetch(event.request);
  })());
});
