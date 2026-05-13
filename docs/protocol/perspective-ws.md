# Perspective Gateway WebSocket Protocol

Observed wire format for the Ignition Perspective (8.3.6) WebSocket bridge.
Primary observations from Probe 3 (2026-05-07) on `cookbook-ignition`.
See `docs/PERSPECTIVE_INTERNALS.md` §14 for inline reference; this document
is the standalone protocol spec for the `gateway_rpc.js` library.

---

## WS URL Pattern

```
ws://<gateway-host>:<port>/system/pws/<project-name>/<sessionId>?token=<token>
```

**Example captured (Probe 3):**
```
ws://<your-gateway-host>:18088/system/pws/cookbook/<session-id>?token=<redacted>
```

- `<sessionId>` — opaque 8-hex-char string assigned per session
- `<token>` — per-session bearer token embedded in the URL (NOT the session cookie)
- The browser session cookie is also required and sent automatically

---

## Frame Format

**Plain text. No binary. No protobuf.**

```
<message-type>:<json-payload>
```

A literal ASCII colon (`:`) separates the type string from the JSON payload.
Both parts are UTF-8 plain text.

**Access the live socket from JS:**
```javascript
var ws = window.__client.connection.webSocket;
ws.readyState;  // 1 = OPEN
ws.url;         // the full WS URL (contains token)
```

---

## Message Type Catalog

### Confirmed (Probe 3, 2026-05-07)

| Dir | Type | Payload shape | Notes |
|---|---|---|---|
| C->G | `client-activity` | `{"lastActiveTime": <epoch-ms>}` | Idle heartbeat, ~13-15 s cadence; fires immediately on user interaction |
| G->C | `client-value-update` | `{"values": {...}, "sync": []}` | Gateway property push (tag value changes, session prop refresh, etc.) |
| G->C | `keepalive` | `{"ts": <JVM-nanoTime>}` | Gateway heartbeat; `ts` is JVM `System.nanoTime()` (large nanosecond value, NOT epoch-ms) |

### Expected but unverified (Probe 3b needed to confirm)

| Dir | Type | Likely payload fields | Status |
|---|---|---|---|
| C->G | `named-query-request` | `{id, queryPath, params, maxRows}` | **Sent, no response** (see below) |
| G->C | `named-query-response` | `{id, data, ...}` | Not yet captured |
| C->G | `tag-subscribe` | `{paths: [...]}` | Not yet captured |
| C->G | `tag-unsubscribe` | `{paths: [...]}` | Not yet captured |
| C->G | `tag-write` | `{writes: [{path, value}]}` | Not yet captured |
| C->G | `view-start` | `{resourcePath, params, mountPath, options}` | Not yet captured |
| C->G | `view-stop` | `{mountPath}` | Not yet captured |
| C->G | `component-message` | `{resourcePath, messageType, payload}` | Not yet captured |
| C->G | `alarm-ack` | `{alarmIds: [...]}` | Not yet captured |

#### Probe 3b artifact -- `named-query-request` sent, no response (2026-05-11)

During task-11 live testing, the following frame was sent by `gw.runNamedQuery()`:

```
[OUT] named-query-request:{"id":"gwnq1_12530","queryPath":"cookbook/test_query","params":{},"maxRows":-1}
```

No corresponding `[IN]` frame followed within the 10 s timeout. The frame was
confirmed outgoing (visible in `window.__gw.captures`). The gateway either:
- Does not recognise the `named-query-request` type name, or
- Requires a different payload shape (different field names or structure), or
- Named query execution is not available via a standalone WS frame outside a binding

**Conclusion:** the `named-query-request` type is unconfirmed. Use the WebDev wrapper
endpoint (`/system/webdev/cookbook/named_query_run`) until Probe 3b reverse-engineers
the actual frame format. See `.odin/backlog/probe-3b-ws-frame-types.md`.

**To extend this catalog:** install WS hooks via `window.__gw.hookWS()` (or visit
the Gateway_RPC_Demo view which installs them automatically), then trigger the
relevant action in the session. All outgoing and incoming frames are captured in
`window.__gw.captures` and shown in the demo view's live frame log.

---

## `client-value-update` Payload Shape

```json
{
  "values": {
    "views": {
      "<mountPath>": {
        "":            { "params": {...}, "props": {...}, "custom": {...} },
        "1:2:3":       { ... }
      }
    },
    "page": {},
    "session": {
      "props": {
        "$": ["map/merge"],
        "lastActivity": { "$": ["ts", 0, 1778190946278], "$ts": 1778190946278 }
      }
    }
  },
  "sync": []
}
```

When the session is idle, `views` and `page` are `{}`. A tag-binding value change
or named query result would populate `views["<mountPath>"]` with a view-level payload
matching the shape accepted by `view.applyPropertyUpdates()` (see INTERNALS §15).

---

## Encoded Property-Tree Tuple Format

Property values in incoming frames use discriminated tuples tagged by a `$` field:

```json
{ "$": ["tag", ...args] }
```

**Confirmed tags (Probe 3):**

| Tag | Args | Meaning |
|---|---|---|
| `"map/merge"` | (none) | Treat the enclosing object as a merge-into-map operation |
| `"ts"` | `[flag, epochMs]` | Typed timestamp; `$ts` shadow holds the raw numeric value |

**Full vocabulary** (`"str"`, `"num"`, `"bool"`, `"date"`, `"dataset"`, array wrapper,
color, etc.) not yet enumerated. See task-02-followups.md Probe 3c.

---

## Heartbeat Sequencing (Observed)

```
  [client] session loads
      |
      +-- client-activity:{"lastActiveTime": T0}         (immediate)
  [gateway] client-value-update:{"values":{...},"sync":[]}  (session.props refresh)
      |
  [gateway] keepalive:{"ts": 4413615912952065}
      |
  ... every ~13-15 s while idle ...
      |
      +-- client-activity:{"lastActiveTime": T1}
  [gateway] client-value-update:{"values":{...},"sync":[]}
```

No client response is required for `keepalive`. The gateway's session expires
after `connection.maxIdleTimeMs` without a `client-activity`.

---

## Tag I/O

**No public REST API exists in stock Ignition 8.3.** Live testing on 2026-05-11
confirmed that every candidate path tried returns 404:

```
GET /data/tag/read      -> 404
GET /system/tag/read    -> 404
GET /data/tags/read     -> 404
```

The earlier `gateway_rpc.js` v1.0 used these paths based on a wrong assumption
about IA's HTTP surface.

**Working solution (task-11a / v1.1):** use WebDev wrapper endpoints that call
`system.tag.readBlocking` / `system.tag.writeBlocking` server-side:

```
GET  /system/webdev/cookbook/tag_read?path=<encoded>
POST /system/webdev/cookbook/tag_write   body: {"path":"...","value":...}
```

See `docs/recipes/gateway-rpc.md` for the full deployment guide.

**WS frame alternative (Probe 3b research):** tag I/O may also be possible via
WS frame types like `tag-subscribe` / `tag-write`, but the exact frame format is
not yet captured. See `.odin/backlog/probe-3b-ws-frame-types.md`.

---

## Named Query -- Protocol Status

Named queries in Perspective are evaluated server-side as component bindings.
The gateway pushes results to clients via `client-value-update`. Whether the
client can directly request a named query execution via a standalone WS frame
(outside a Perspective binding) is **not confirmed**.

**Current working solution (task-11a):** use the WebDev wrapper endpoint:
```
POST /system/webdev/cookbook/named_query_run
Body: {"path":"cookbook/test_query","params":{}}
```
Returns `{"ok":true,"columns":[...],"data":[...],"rowCount":N}`.

**Best-guess WS frame (sent in task-11, no response):**
```
named-query-request:{"id":"gwnq1_12530","queryPath":"cookbook/test_query","params":{},"maxRows":-1}
```

**How to find the actual WS frame format (Probe 3b):**
1. Open the Gateway_RPC_Demo view (installs WS hooks automatically)
2. Navigate to a Perspective view that has a named query binding
3. Observe the captured WS frames in the demo view's live capture panel
4. The outgoing frame just before the named query result appears in
   `client-value-update` is the actual request format
5. Update this section and `gateway_rpc.js` with the confirmed type

See `.odin/backlog/probe-3b-ws-frame-types.md` for the full Probe 3b plan.

---

## Security Note

Any JavaScript with access to `window.__client.connection.webSocket` can:
- Read all incoming frames (including tag values, named query results, session props)
- Send arbitrary frames as the logged-in user (tag writes, alarm acks, etc.)

This is the full power/attack surface of the Markdown `escapeHtml: false` injection
technique. Never wire `props.source` to user-controlled data. See INTERNALS §10 and §14.

---

## References

- `docs/PERSPECTIVE_INTERNALS.md` §14 -- WS protocol (inline reference)
- `docs/PERSPECTIVE_INTERNALS.md` §15 -- synthesizing property updates client-side
- `findings/recon-8.3.6-2026-05-07-probe3.txt` -- raw WS capture (3 frame types + analysis)
- `scripts/gateway_rpc.js` -- library that uses this protocol
- `docs/recipes/gateway-rpc.md` -- usage guide
- `.odin/backlog/task-02-followups.md` -- Probe 3b (interactive catalog) + Probe 3c (tuple vocab)
