// sw_worker.js — Perspective PWA Service Worker
// Served by Ignition WebDev at: /system/webdev/cookbook/sw_handler
// Registered with scope: / (requires Service-Worker-Allowed: / header from WebDev handler)
//
// NOTE on the resource name: Designer's Web Dev module rejects names containing
// dots (e.g. `sw.js`). The endpoint is named `sw_handler` in Designer; the URL
// path is therefore `/system/webdev/cookbook/sw_handler`. The `.js` extension is
// not required for the browser to recognise this as JavaScript — Content-Type
// header is what counts.
//
// Strategy: stale-while-revalidate for cacheable assets.
//           Network-first for HTML navigation (so the gateway shell is always fresh when online).
//           WebSocket frames and gateway RPC paths are never intercepted.
//
// Cache versioning: bump CACHE_NAME when the Perspective build changes to force cache eviction.

var CACHE_NAME = 'perspective-cache-v1';

// Perspective shell assets to pre-cache on install.
// These paths are stable in 8.3.x. Hashed bundles (chunk.abc123.js) are captured at runtime.
// Pre-cache may 404 on items that don't exist yet (handled gracefully — no abort).
var PRECACHE_ASSETS = [
  '/system/perspective/client/cookbook',
  '/system/perspective/client/cookbook/SW_Demo'
];

// URL path prefixes that MUST pass through without SW interception.
// These are Perspective's gateway communication endpoints.
var PASSTHROUGH = [
  '/system/pws/',        // Perspective WebSocket bridge (WS upgrade)
  '/system/ws/',         // generic gateway WS
  '/system/gateway',     // gateway config/status
  '/system/DsData',      // dataset streaming
  '/system/tag',         // tag reads / writes
  '/system/named-query', // named query execution
  '/system/alarm',       // alarm actions
  '/main/data',          // legacy Perspective data bridge
];

// ─── Install ─────────────────────────────────────────────────────────────────
self.addEventListener('install', function (event) {
  console.log('[SW] install — cache:', CACHE_NAME);
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      // Add each asset individually — a single 404 won't abort the entire install.
      return Promise.all(
        PRECACHE_ASSETS.map(function (url) {
          return cache.add(url).catch(function (err) {
            console.warn('[SW] pre-cache miss:', url, '—', err.message);
          });
        })
      );
    }).then(function () {
      console.log('[SW] install complete');
      // Skip the waiting phase; activate immediately on next page load.
      return self.skipWaiting();
    })
  );
});

// ─── Activate ────────────────────────────────────────────────────────────────
self.addEventListener('activate', function (event) {
  console.log('[SW] activate');
  event.waitUntil(
    // Evict caches from previous SW versions.
    caches.keys().then(function (names) {
      return Promise.all(
        names
          .filter(function (n) { return n !== CACHE_NAME; })
          .map(function (n) {
            console.log('[SW] deleting old cache:', n);
            return caches.delete(n);
          })
      );
    }).then(function () {
      // Take control of all open clients without requiring a page reload.
      return self.clients.claim();
    })
  );
});

// ─── Fetch ───────────────────────────────────────────────────────────────────
self.addEventListener('fetch', function (event) {
  var req = event.request;
  var url;

  // Only intercept GET — tag writes / form POSTs must always hit the server.
  if (req.method !== 'GET') { return; }

  try { url = new URL(req.url); } catch (e) { return; }

  // Never intercept cross-origin requests (CDN, external APIs).
  if (url.origin !== self.location.origin) { return; }

  // Never intercept Perspective gateway communication paths.
  for (var i = 0; i < PASSTHROUGH.length; i++) {
    if (url.pathname.indexOf(PASSTHROUGH[i]) === 0) { return; }
  }

  event.respondWith(
    caches.match(req).then(function (cached) {
      // Always kick off a background revalidation.
      var networkFetch = fetch(req).then(function (resp) {
        if (resp && resp.ok && resp.type === 'basic') {
          // Don't re-cache the SW script itself (would pin stale code).
          if (url.pathname !== '/system/webdev/cookbook/sw_handler') {
            // Clone synchronously — the body of `resp` will be consumed by the
            // outer `return resp`. If we cloned inside the async caches.open
            // callback, the body would already be used and clone() would throw.
            var clone = resp.clone();
            caches.open(CACHE_NAME).then(function (c) { c.put(req, clone); });
          }
        }
        return resp;
      }).catch(function () { return null; });

      if (cached) {
        // Serve stale from cache; network revalidation runs silently in background.
        return cached;
      }

      // Nothing cached — wait for network.
      return networkFetch.then(function (resp) {
        if (resp) { return resp; }

        // Offline and no cached response — serve built-in offline page for navigations.
        if (req.mode === 'navigate') {
          return new Response(
            '<!DOCTYPE html>' +
            '<html lang="en"><head><meta charset="utf-8">' +
            '<meta name="viewport" content="width=device-width,initial-scale=1">' +
            '<title>Offline — Ignition</title>' +
            '<style>' +
            'body{margin:0;font-family:system-ui,sans-serif;background:#1a1a2e;color:#e0e0e0;' +
            'display:flex;align-items:center;justify-content:center;min-height:100vh}' +
            '.card{text-align:center;padding:40px;max-width:420px}' +
            'h1{font-size:3.5em;margin:0 0 8px}' +
            'h2{margin:0 0 12px;font-weight:400;opacity:.85}' +
            'p{opacity:.6;line-height:1.6;margin:0 0 20px}' +
            'button{padding:11px 28px;background:#3d7ef8;color:#fff;border:none;' +
            'border-radius:6px;font-size:1em;cursor:pointer}' +
            'button:hover{background:#5a93ff}' +
            '</style></head>' +
            '<body><div class="card">' +
            '<h1>📵</h1>' +
            '<h2>You are offline</h2>' +
            '<p>Cannot reach the Ignition gateway.<br>' +
            'The cached Perspective shell may still be available.<br>' +
            'Live tag values will not update.</p>' +
            '<button onclick="location.reload()">Retry connection</button>' +
            '</div></body></html>',
            { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        }

        // Non-navigation offline — 503.
        return new Response('Service unavailable (offline)', {
          status: 503,
          statusText: 'Service Unavailable'
        });
      });
    })
  );
});

// ─── Message ──────────────────────────────────────────────────────────────────
// Allows the page to query or control the SW at runtime.
self.addEventListener('message', function (event) {
  if (!event.data) { return; }

  // Force activate a waiting worker (sent after user acks an update prompt).
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  // Reply with the current cache name so the page can display the SW version.
  if (event.data.type === 'GET_VERSION') {
    event.source.postMessage({ type: 'VERSION', version: CACHE_NAME });
  }
});
