# Gateway RPC from Perspective Markdown Injection

How to make direct gateway calls (tag read/write, named queries, raw WS frames) from
any Perspective Markdown component with `escapeHtml: false`.

No Perspective bindings are needed. All calls go through three WebDev Python wrapper
endpoints that live in the `cookbook` project (Path B — working baseline).

**Path A (pure-WS RPC)** is a research backlog item: reverse-engineering the exact WS
frame types for tag I/O and named-query execution on stock Ignition 8.3. Live testing
confirmed that stock Ignition 8.3 has no public HTTP REST API for tag I/O, and a
speculative `named-query-request:` WS frame type is not recognized by the gateway.
WebDev wrappers are the reliable path until those frame types are characterized.

---

## Prerequisites

| Prerequisite | Setup |
|---|---|
| Gateway running | `docker compose up -d` (from `ignition-project/`) or your own gateway |
| `cookbook` Perspective project imported | Import `ignition-project/perspective_cookbook.zip` in Designer |
| **WebDev module enabled** | Verify: `http://localhost:18088/system/webdev/cookbook/sw_handler` returns JS |
| Test tag `[default]cookbook/test_value` | Create in Designer (Memory tag, any type, initial value `42`) |
| Test named query `cookbook/test_query` | Create in Designer → Named Queries → `cookbook/test_query` |
| Three WebDev endpoints created | Pre-created in the imported project — see **WebDev Endpoints** below |

---

## WebDev Endpoints

The imported project includes three pre-created WebDev endpoints:

| Endpoint | Method | URL | Purpose |
|---|---|---|---|
| `tag_read` | GET | `/system/webdev/cookbook/tag_read?path=<enc>` | `system.tag.readBlocking` wrapper |
| `tag_write` | POST | `/system/webdev/cookbook/tag_write` | `system.tag.writeBlocking` wrapper |
| `named_query_run` | POST | `/system/webdev/cookbook/named_query_run` | `system.db.runNamedQuery` wrapper |

All three use `require-auth: false` for sandbox convenience. **For any non-sandbox
deployment, set `require-auth: true` and add appropriate `required-roles`.**

### Recreating endpoints from scratch

WebDev resources **must** be created through Designer — Ignition's content-addressable
resource store is only populated by Designer. For each endpoint:

1. In Designer, right-click **Web Dev** in the project tree → **New** → **Python**
2. Name it exactly as shown (no dots, no spaces):
   - `tag_read`
   - `tag_write`
   - `named_query_run`
3. Click the appropriate method tab (GET for `tag_read`, POST for the others)
4. Paste the Python handler body (see the endpoint source in the imported project via Designer)
5. **Save All** (Ctrl+S or File → Save All)

---

## Quick Start

### 1. Install the library in any view

Add a Markdown component with `escapeHtml: false`. Bind `props.source` to:

```
concat(
  '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" style="display:none" onload="eval(atob(\'BASE64_OF_GATEWAY_RPC_JS\'))">'
)
```

Generate `BASE64_OF_GATEWAY_RPC_JS`:
```bash
base64 -w 0 scripts/gateway_rpc.js
```

Alternatively, **open the Gateway_RPC_Demo view first** — it installs `window.__gw`
for the whole session; every other view in the session can then use it via `window.__gw`.

The `Gateway_RPC_Demo` view is included in `ignition-project/perspective_cookbook.zip`.
Import the project in Designer and open the view in a Perspective session.

### 2. Use the API

```javascript
// Tag read
window.__gw.readTag('[default]cookbook/test_value')
  .then(function (r) { console.log('value:', r.value, 'quality:', r.quality); })
  .catch(console.error);

// Tag write
window.__gw.writeTag('[default]cookbook/test_value', 99)
  .then(function (r) { console.log('write result:', r); })
  .catch(console.error);

// Named query (returns {ok, columns, data, rowCount})
window.__gw.runNamedQuery('cookbook/test_query', {})
  .then(function (r) { console.log('rows:', r.data); })
  .catch(console.error);

// WS frame capture (auto-installed; view all traffic)
console.log(window.__gw.captures);

// Send raw WS frame (for WS-protocol research)
window.__gw.sendRaw('client-activity:{"lastActiveTime":' + Date.now() + '}');
```

---

## API Reference

### `gw.readTag(tagPath)` -> Promise

Reads one tag value via `GET /system/webdev/cookbook/tag_read?path=<encoded>`.

| Arg | Type | Example |
|---|---|---|
| `tagPath` | string | `'[default]cookbook/test_value'` |

Resolves with:
```javascript
{
  value: 42,
  quality: 'Good_Data',
  timestamp: 1715443200000,   // epoch ms
  _raw: { /* full WebDev response */ }
}
```

Rejects if the WebDev endpoint returns `{"ok": false, ...}` or a network error.

**Multiple tags (advanced):**
```javascript
Promise.all([
  gw.readTag('[default]cookbook/a'),
  gw.readTag('[default]cookbook/b')
]).then(function (results) { console.log(results); });
```

---

### `gw.writeTag(tagPath, value)` -> Promise

Writes a value to one tag via `POST /system/webdev/cookbook/tag_write`.

Request body: `{"path": "<tagPath>", "value": <any>}`

| Arg | Type | Example |
|---|---|---|
| `tagPath` | string | `'[default]cookbook/test_value'` |
| `value` | any | `42`, `'hello'`, `true` |

Resolves with `{"ok": true, "qualityCode": "Good_Data"}`. Rejects on error.

Requires the gateway user to have tag write permission (Ignition role enforcement,
not WebDev layer — `require-auth: false` bypasses WebDev auth, not tag permission).

---

### `gw.runNamedQuery(queryPath, params)` -> Promise

Runs a named query via `POST /system/webdev/cookbook/named_query_run`.

Request body: `{"path": "<queryPath>", "params": {...}}`

| Arg | Type | Example |
|---|---|---|
| `queryPath` | string | `'cookbook/test_query'` or `'test_query'` |
| `params` | object | `{}` or `{ myParam: 'value' }` |

**Path format:** the query path is relative to the `cookbook` project, matching the
named query folder structure in Designer (e.g. a query at `Named Queries / cookbook /
test_query` has path `cookbook/test_query`). Pass the same path you'd use in
`system.db.runNamedQuery(path, params)` in a Designer script.

Resolves with:
```javascript
{
  ok: true,
  columns: ['col1', 'col2', ...],
  data: [
    { col1: val1, col2: val2 },   // one object per row
    ...
  ],
  rowCount: N
}
```

Rejects if the endpoint returns `{"ok": false, "error": "..."}`.

> **Note:** Named queries require a configured database connection on the gateway —
> even simple ones like `SELECT 1`. If `runNamedQuery` returns an error about
> "Cannot find database connection", create a DB connection in Gateway → Config
> first.

---

### `gw.hookWS()` -> WebSocket | null

Installs WS send/receive hooks. Called automatically on library load.
Safe to call multiple times (no-op if already hooked).
Returns the live WebSocket instance.

---

### `gw.onCapture(fn)`

Registers a callback fired for every captured WS frame (in and out).

```javascript
gw.onCapture(function (dir, frame) {
  // dir: 'in' or 'out'
  // frame: raw string e.g. 'client-value-update:{...}'
  console.log(dir, frame.slice(0, 80));
});
```

---

### `gw.captures` -> Array

Array of `{ dir: 'in'|'out', frame: string, ts: number }` objects for all
captured WS frames since the library was installed (or since last `clearCaptures()`).

---

### `gw.clearCaptures()`

Empties the capture array.

---

### `gw.sendRaw(frame)`

Sends a pre-formatted WS frame string directly through the live WebSocket.
Throws if the socket is not open. Useful for WS-protocol research.

```javascript
gw.sendRaw('client-activity:{"lastActiveTime":' + Date.now() + '}');
```

---

## Gateway_RPC_Demo View

The `Gateway_RPC_Demo` view (included in the imported project) provides a full
interactive UI for all `gw.*` operations with no Perspective bindings. It:

- Auto-installs `window.__gw` v1.1 on load
- Shows tag read/write buttons with configurable paths
- Shows a named query section with path + params inputs
- Shows a raw WS frame sender for manual protocol exploration
- Shows a live WS capture panel (incoming + outgoing frames, color-coded, auto-scrolling)

---

## WebDev Endpoint Reference

| Operation | Method | URL | Body |
|---|---|---|---|
| Tag read | GET | `/system/webdev/cookbook/tag_read?path=<enc>` | — |
| Tag write | POST | `/system/webdev/cookbook/tag_write` | `{"path":"...","value":...}` |
| Named query | POST | `/system/webdev/cookbook/named_query_run` | `{"path":"...","params":{}}` |

All endpoints return HTTP 200 with `{"ok": true/false, ...}`. The `ok` field is the
error signal — the HTTP status is always 200 to simplify client-side handling.

Full WS protocol reference: `docs/protocol/perspective-ws.md`

---

## Transport Paths

### Path B (current — WebDev wrappers)

Working on stock Ignition 8.3 with WebDev module enabled. Three Python scripts
deployed as WebDev resources wrap `system.tag.readBlocking`, `system.tag.writeBlocking`,
and `system.db.runNamedQuery`. Same-origin session cookie authenticates automatically.

**Pros:** portable, stable API, no WS frame reverse-engineering needed.
**Cons:** requires WebDev module, three extra Designer-created resources.

### Path A (research direction — pure WS RPC)

Goal: use only the Perspective WebSocket connection, no WebDev. Requires knowing the
exact WS frame types for tag I/O and named query execution.

**Status:** blocked pending further WS-protocol research.
- A speculative `named-query-request:` frame was sent in testing but got no response.
- No tag I/O frame types have been captured yet (no `/data/tag/read` REST endpoint either).

See `docs/protocol/perspective-ws.md` for the WS frame catalog observed so far.

---

## Extending the Library

### Add a new operation (after confirming WS frame format or another WebDev endpoint)

```javascript
// After characterizing tag-subscribe frame format:
window.__gw.subscribeTag = function (tagPath) {
  var frame = 'tag-subscribe:' + JSON.stringify({ paths: [tagPath] });
  window.__gw.sendRaw(frame);
  // Listen for the response via gw.onCapture(...)
};
```

### Integrate with the Command Palette

The CommandPalette view has stubbed "Read Tag", "Set Tag", and "Run Named Query"
commands. Update them:

```javascript
action: function () {
  if (!window.__gw) { showToast('Visit Gateway_RPC_Demo first to install gw library'); return; }
  window.__gw.readTag('[default]cookbook/test_value').then(function (r) {
    showToast('Tag value: ' + r.value);
  }).catch(function (e) { showToast('Read failed: ' + e.message); });
}
```

---

## Risks and Notes

- **Tag writes are real.** Writing to a memory tag in the sandbox is fine.
  Writing to an OPC-UA or device tag could affect hardware.
- **Named query execution respects Ignition user permissions.** The gateway user's
  roles determine access; `require-auth: false` in WebDev doesn't bypass tag/DB ACLs.
- **Malformed WS frames may drop the session.** The gateway will boot the session;
  the browser reconnects automatically (new session token). This flushes `gw.captures`.
- **The `gw.onCapture` callback accumulates across view re-renders.** The demo view
  uses a session-scoped flag to prevent duplicate subscriptions:
  ```javascript
  if (!window.__myViewCaptureSub) {
    window.__myViewCaptureSub = true;
    gw.onCapture(myHandler);
  }
  ```

## See also

- `docs/PERSPECTIVE_INTERNALS.md §4` — reach routes to `window.__client`
- `docs/PERSPECTIVE_INTERNALS.md §14` — WebSocket wire format
- `docs/protocol/perspective-ws.md` — WS frame type catalog
- `docs/recipes/cmd-palette.md` — wiring the Command Palette tag stubs
