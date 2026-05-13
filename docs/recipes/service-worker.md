# Recipe: Service Worker / PWA Offline Mode in Perspective

**Verified against:** Ignition 8.3.6  
**Depends on:** `docs/PERSPECTIVE_INTERNALS.md` §4 (Route 0), §13 (eval/atob delivery)

---

## What this achieves

A Service Worker (SW) registered from a Perspective session that:

1. **Caches** the Perspective shell and static assets on first load
2. **Serves cached UI** when the gateway is unreachable ("offline first")
3. **Shows a custom offline page** (not a browser error screen) when navigating offline
4. **Reports live online/offline status** into `view.custom.online` via MobX, so any downstream binding can react
5. **Surfaces SW registration state** (`active`, `error`, `not-supported`, etc.) in `view.custom.swStatus`

Bonus: once the SW is active, the browser may offer "Add to Home Screen" / standalone window via the PWA install prompt (requires a `manifest.json` linked from the Perspective page — not covered here, but the SW is the prerequisite).

---

## Secure context requirement

**Service Workers only work in a secure context:** HTTPS, or `localhost` (always treated as secure by Chrome/Firefox). A plain `http://` gateway URL will silently fail — `navigator.serviceWorker` is `undefined` (or the API exists but `register()` rejects).

Three options for this sandbox:

| Option | How | Works for |
|--------|-----|-----------|
| **A — Chrome flag** | Add origin to `chrome://flags/#unsafely-treat-insecure-origin-as-secure` | Dev/testing on LAN |
| **B — HTTPS** | TLS cert in Gateway → Settings → Certificates | Production |
| **C — localhost** | Access via `http://localhost:18088` | VM-local only |

The `swStatus` / `swError` view properties will tell you which case you're in:
- `swStatus = 'not-supported'` → secure context missing
- `swStatus = 'error'` + `swError` text → registration rejected (check Console for the specific DOMException)
- `swStatus = 'active'` → worker installed and controlling the page

---

## How the pieces fit together

```
┌──────────────────────────────────────────────────────────────────┐
│  Perspective Markdown component (escapeHtml: false)              │
│                                                                  │
│  props.source = concat(                                          │
│    '<div>... HTML scaffold ...</div>',                           │
│    '<img onload="eval(atob(\'BASE64_OF_REGISTER_JS\'))">'        │
│  )                                                               │
└────────────────────────────┬─────────────────────────────────────┘
                             │ img.onload fires once on DOM insert
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  sw_register_source.js (scripts/sw_register_source.txt)         │
│                                                                  │
│  1. window.__client.page.views → find view by resourcePath      │
│  2. window.addEventListener('online'/'offline') → v.custom.write │
│  3. navigator.serviceWorker.register('/system/webdev/cookbook/sw_handler')│
│     .then → v.custom.write('swStatus', 'active')                 │
│  4. v.custom.subscribe(syncDom) → keeps HTML status up to date  │
└────────────────────────────┬─────────────────────────────────────┘
                             │ register()
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  WebDev endpoint: /system/webdev/cookbook/sw_handler                │
│  (served with Content-Type: application/javascript)             │
│  (served with Service-Worker-Allowed: /)                        │
│                                                                  │
│  → scripts/sw_worker.js (embedded in the WebDev handler body)   │
└────────────────────────────┬─────────────────────────────────────┘
                             │ SW installs, activates, intercepts fetch
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  Browser Cache API                                               │
│  CACHE: 'perspective-cache-v1'                                   │
│                                                                  │
│  Strategy: stale-while-revalidate                               │
│  - Serve from cache immediately if cached                        │
│  - Revalidate from network in background                         │
│  - If offline + uncached → serve built-in offline page           │
└──────────────────────────────────────────────────────────────────┘
```

---

## Deliverables

| File | Purpose |
|------|---------|
| `scripts/sw_register_source.txt` | JS that registers the SW and wires online/offline events to `view.custom` |
| `scripts/sw_worker.js` | The service worker itself; embed in the WebDev `sw_handler` doGet body |
| `ignition-project/perspective_cookbook.zip` | Import in Designer to get the `SW_Demo` view + `sw_handler` WebDev endpoint |

---

## File-by-file notes

### `scripts/sw_register_source.txt`

The IIFE that runs inside the Perspective page. Key points:

- **`window.__sw` namespace** — all button handlers are attached to `window.__sw` so HTML `onclick="window.__sw.inspect&&window.__sw.inspect()"` attributes can reach them without `eval`.
- **`v.__swRegDone` guard** — prevents double-registration on Perspective re-renders. The `onload` img fires once per DOM insertion; if the DOM is torn down and rebuilt (Perspective does this on some navigations), the guard prevents a second `register()` call.
- **`v.__swSubInited` guard** — same pattern for `v.custom.subscribe(syncDom)`.
- **`window.__client.simulatingLostConnection`** — the "Simulate Offline" button sets this key on the session store (confirmed in Probe 1, `findings/recon-8.3.6-2026-05-07-probe1.txt`). It causes Perspective's WS bridge to flag its connection as lost, triggering the reconnect overlay. This is separate from the browser's `navigator.onLine` — for full offline testing, also use DevTools → Network → Offline.

### `scripts/sw_worker.js`

The service worker. Key design decisions:

- **`PASSTHROUGH` list** — all Perspective gateway communication paths (`/system/pws/`, `/system/tag`, etc.) are explicitly excluded from SW interception. Only GET requests to static/cacheable paths are intercepted.
- **Never intercept cross-origin** — `url.origin !== self.location.origin` check skips CDN resources, external APIs.
- **Stale-while-revalidate** — serve cached content immediately; fetch in background to refresh cache. Keeps the UI snappy.
- **Built-in offline page** — when offline and the request is a navigation (`req.mode === 'navigate'`), returns an HTML offline page rather than a browser error. This page includes a "Retry connection" button.
- **`skipWaiting()` on install** — activates the new worker immediately instead of waiting for all open tabs to close. Combined with `clients.claim()` on activate, the SW takes control of all open clients immediately.
- **Cache versioning** — bump `CACHE_NAME = 'perspective-cache-v1'` string to evict old cache entries when the Perspective build changes (e.g., after an IA upgrade).

### WebDev endpoint: `sw_handler`

The WebDev endpoint serves `sw_worker.js` as JavaScript. Key requirements:

1. Returns `sw_worker.js` content with `Content-Type: application/javascript`
2. Returns `Service-Worker-Allowed: /` header (allows registering with `scope: '/'`)
3. Returns `Cache-Control: no-cache` (browser must always re-fetch the SW script to detect updates)

The endpoint is pre-created in the imported project. To recreate it from scratch in Designer:

1. Right-click **Web Dev** in the project tree → **New** → **Python**
2. Name it `sw_handler` (no dots — Designer rejects names with dots)
3. In the GET method tab, paste the body from `scripts/sw_worker.js` wrapped in the return dict:
   ```python
   return {
       "contentType": "application/javascript",
       "response": """<sw_worker.js content here>""",
       "headers": {"Service-Worker-Allowed": "/", "Cache-Control": "no-cache"}
   }
   ```

> **Note:** `contentType` must be the top-level return key (camelCase). Custom headers go in
> a `headers` dict. `require-auth: false` is appropriate for sandbox; set `require-auth: true`
> for production.

---

## Deployment (sandbox)

### Step 1 — Import the project

Import `ignition-project/perspective_cookbook.zip` in Designer. The `sw_handler` WebDev endpoint
and `SW_Demo` view are included. Save All and restart the gateway.

### Step 2 — Verify WebDev endpoint

```bash
curl -I http://localhost:18088/system/webdev/cookbook/sw_handler
# Expected: HTTP/1.1 200 OK
#           Content-Type: application/javascript
#           Service-Worker-Allowed: /
```

### Step 3 — Open view and verify (requires secure context)

```
http://localhost:18088/data/perspective/client/cookbook/SW_Demo
```

Success criteria:
- `swStatus = 'active'` (may briefly show `registering…` → `installing` → `active`)
- `swScope = 'http://localhost:18088/'`
- `swCacheName = 'perspective-cache-v1'`
- Badge shows `● Online`

For LAN access over HTTP, add the gateway origin to Chrome's insecure-origins allowlist
(`chrome://flags/#unsafely-treat-insecure-origin-as-secure`), or configure HTTPS.

---

## Testing offline behavior

### Test A — Perspective simulation only

Click **Simulate Offline** in the view. Perspective's reconnect overlay appears. The cached UI HTML is still visible underneath. Click **Reconnect** to restore.

*Note: this only disconnects the Perspective WS bridge. The browser's actual network is still up.*

### Test B — Full browser offline (recommended)

1. Open DevTools → Network tab → Throttle dropdown → **Offline**
2. Reload the page (`Ctrl+R`)
3. The SW should serve the cached Perspective shell instead of a browser error
4. Restore: DevTools → Network → **No throttling**, then click **Retry connection**

### Test C — Inspect the cache

Click **Inspect Cache**. The output area shows:
```
perspective-cache-v1 [N entries]:
  http://localhost:18088/system/perspective/client/cookbook
  http://localhost:18088/system/perspective/client/cookbook/SW_Demo
  ... (dynamically cached as you browse)
```

---

## Updating the service worker

When you change `scripts/sw_worker.js`:

1. Edit the file
2. Bump `CACHE_NAME` in the new version (e.g., `perspective-cache-v2`)
3. Update the `sw_handler` WebDev endpoint body in Designer with the new content
4. Save All and restart the gateway
5. On next page load, the browser fetches the new SW script and the SW lifecycle begins: `install` → `waiting` → `activated` (visible in swStatus)

---

## Caveats and gotchas

### WebSocket is NOT interceptable by a Service Worker

Perspective's live data flows over a WebSocket (`/system/pws/<project>/<sessionId>`). SW fetch handlers **cannot intercept WebSocket frames** — only HTTP GET/POST/etc. This means:
- The Perspective UI shell (HTML, JS, CSS, fonts) → cached ✅
- Live tag values, alarm events, gateway-pushed updates → **not cached** ❌

Offline behavior: the UI renders from cache, but displayed tag values are stale. This is the expected behavior for "offline-capable" Perspective, not "offline real-time" Perspective.

### `Service-Worker-Allowed` header is mandatory for scope: '/'

The SW script lives at `/system/webdev/cookbook/sw_handler`. Without the `Service-Worker-Allowed: /` header, the browser restricts the SW's scope to `/system/webdev/cookbook/` — which doesn't cover any Perspective pages. The `doGet` handler must include this header.

### Cache poisoning on IA upgrades

After an IA upgrade, the Perspective bundle filenames change (hashed filenames). A stale cache entry for an old bundle hash will be served and may break the UI. Fix: bump `CACHE_NAME`, restart, clear old caches. The `Clear Cache` button in SW_Demo does this from the browser side.

### Multiple tabs / windows

`skipWaiting()` + `clients.claim()` causes the new SW to take control of all open tabs immediately on activation. If a user has two Perspective sessions open in different tabs, both will switch to the new cache version simultaneously. This is generally desirable.

### The `simulatingLostConnection` key

Confirmed present in 8.3.6 (Probe 1). May be renamed or removed in future IA versions. If `window.__client.simulatingLostConnection` is not found, the "Simulate Offline" button logs a warning and only updates `view.custom.online` — the Perspective reconnect overlay won't appear.

---

## Extension ideas

- **Background sync** — queue tag writes in IndexedDB when offline; flush when SW detects connectivity restored (via `sync` event, requires `SyncManager` API — Chrome only as of 2026)
- **Push notifications** — subscribe via `PushManager`; gateway sends notifications via WebPush when alarm fires (requires HTTPS + a push server)
- **PWA manifest** — create `/system/webdev/cookbook/manifest.json` and link it from Perspective's `<head>` via a custom HTML template; enables "Add to Home Screen" on mobile
- **Precache all Perspective chunk hashes** — inspect the Perspective bundle manifest at `/res/` to build a comprehensive precache list; use Workbox if the list grows large

## See also

- `docs/PERSPECTIVE_INTERNALS.md §4` — all reach routes to `window.__client`
- `docs/PERSPECTIVE_INTERNALS.md §13` — `eval(atob(...))` escape rules
- `findings/recon-8.3.6-2026-05-07-probe1.txt` — confirms `simulatingLostConnection` key
