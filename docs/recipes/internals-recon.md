# Recipe: Internals Recon — Probing window.__client on a Live Gateway

**Ignition target:** 8.3.x (validated on 8.3.6)  
**Status:** Working pattern — verified 2026-05-07, all 94 names stable  
**Depends on:** `docs/PERSPECTIVE_INTERNALS.md` §4, §11

---

## What It Is

Six self-contained probe scripts that characterize the live state of `window.__client` and
related Perspective internals on a running Ignition gateway. Each probe is a Perspective
expression (paste into a Markdown component's `props.source` binding) that fires a base64-encoded
IIFE via `<img onload>`, writes structured output to an on-screen panel, and mirrors everything to
`console.log` for DevTools capture.

These are the "look first, then build" scripts. Every other recipe in this cookbook makes
assumptions about MobX property trees, `connection.send` wire format, fiber walk availability,
and method name stability. The probes are how you verify those assumptions are still valid after
an Inductive Automation upgrade.

---

## Why Run These

Every recipe in this cookbook depends on internals that Inductive Automation does not
document or guarantee:

- `window.__client` existing as a global
- `page.views`, `view.params`, `view.custom` being reachable from that global
- `connection.send` being the raw WebSocket send
- `page._newViewStore` working as a client-only factory
- `view.applyPropertyUpdates` accepting a specific payload shape
- 94 named methods and fields being present on the session/page/view/params objects

**After every IA upgrade, run the six probes.** Compare the output to the baseline in
`findings/recon-8.3.6-2026-05-07-probe*.txt`. Any `MISSING` result in Probe 6 means a
recipe that depends on that name is broken on the new build.

---

## The Six Probes

| # | Script | Question | Recipe dependency |
|---|--------|----------|-------------------|
| 1 | `scripts/recon_01_window_client.txt` | Does `window.__client` exist? What are its own keys? | Every recipe — all use Route 0 |
| 2 | `scripts/recon_02_property_tree_update.txt` | What methods does `params` / `view.custom` expose? Is `params.update()` callable? | D3, Monaco, Pyodide, Command Palette |
| 3 | `scripts/recon_03_connection_send.txt` | What is the WebSocket URL format? Is `connection.send` a native function? What frame types does idle traffic show? | Gateway RPC (WS capture utilities) |
| 4 | `scripts/recon_04_new_view_store.txt` | Does `page._newViewStore` work as a client-only factory? | Any pattern using ghost view stores |
| 5 | `scripts/recon_05_apply_property_updates.txt` | What is the exact payload shape for `view.applyPropertyUpdates`? | Gateway RPC (advanced frame injection) |
| 6 | `scripts/recon_06_cross_version.txt` | Are all 94 documented method and field names present? Does the fiber walk still work? | All recipes — name stability baseline |

---

## How to Run

### Option A — Import project and open Internals_Recon view (recommended)

1. Import `ignition-project/perspective_cookbook.zip` in Designer.
2. Open a Perspective session and navigate to the `Internals_Recon` view.
3. The view has six buttons, one per probe. An **auto-runner** fires all six probes on
   view load and writes output to the panel.
4. Open Chrome DevTools → Console → **Preserve Log** ON.
5. Click any probe button to re-run it. Output appears in the on-screen panel and the
   DevTools console.

### Option B — Paste probe expressions manually

1. Create any Perspective view with a Markdown component (`escapeHtml: false`).
2. Bind `props.source` to the **entire contents** of `scripts/recon_0N_*.txt`
   (including the outer `concat(...)` call).
3. Save and open the view. The probe fires on DOM insertion.
4. Check the DevTools console for output lines prefixed with the probe number.

Each probe script is fully standalone — no gateway-side setup required beyond a running
Perspective session with the Markdown component displaying.

---

## What You Should See

The baseline captures for Ignition 8.3.6 are in `findings/`. Use them as the ground
truth when verifying a new build:

### Probe 1 (`findings/recon-8.3.6-2026-05-07-probe1.txt`)

- `window.__client EXISTS (type=object)` — the global is present
- Own keys listed: ~45 entries including `page`, `connection`, `auth`, `bluetooth`,
  `simulatingLostConnection`, `fsm`, `flags`, `_token`, `sessionState`, etc.
- `window.__ignition = undefined`, `window.__perspective = undefined` — no other globals exist
- `.page exists` with its own key list; `.connection exists` with its key list

**Key facts verified:**
- `window.__client` IS the session store (same object the pre-8.3.6 fiber walk reaches at level 9)
- No other `window.__*` shorthand exists in 8.3.6

### Probe 2 (`findings/recon-8.3.6-2026-05-07-probe2.txt`)

- `params.readKeys()` and `params.export()` work without error
- `params.update(null)` errors with "Cannot read properties of null (reading '$')" — the
  encoded format uses a `$` discriminator field
- `params.update({})` errors with "Update message not encoded properly" — plain objects are rejected
- `params.operate('')` errors with "t is not a function" — it's a path-navigator, not a write API

**Key facts verified:**
- `params.write(key, value)` is the canonical write API; `update()` requires a captured frame
- `operate()` is plumbing for the binding system, not a write primitive

### Probe 3 (`findings/recon-8.3.6-2026-05-07-probe3.txt`)

- WebSocket URL: `ws://<your-gateway-host>:18088/system/pws/cookbook/<session-id>?token=<redacted>`
- `connection.send.toString()` = `"function () { [native code] }"` — it IS the underlying
  WebSocket's native `send`; no client-side wrapper
- Outgoing idle frames: `client-activity:{"lastActiveTime":<epoch-ms>}` every ~13 seconds
- Incoming frames: `client-value-update:{...}` and `keepalive:{...}` during idle

**Key facts verified:**
- Protocol is plain text `<type>:<json>`, not binary/protobuf
- The encoded property-tree format uses discriminated tuples: `{"$":["tag",...args]}`

### Probe 4 (`findings/recon-8.3.6-2026-05-07-probe4.txt`)

- `page._newViewStore` EXISTS — source shown (creates a new ViewStore with optional
  sessionState from cache)
- Calling `_newViewStore('cookbook/SomeView', {})` throws `"Converting circular structure to JSON"`
  — BUT only in the probe's `JSON.stringify` logging step; the store IS created successfully

**Key facts verified:**
- `_newViewStore` is a client-only factory — no gateway round-trip required
- The returned ViewStore has full MobX property tree API (params, custom, props, root)
- Ghost stores are NOT registered in `page.views` — keep your own JS reference

### Probe 5 (`findings/recon-8.3.6-2026-05-07-probe5.txt`)

- `view.applyPropertyUpdates` source exposed (deminified in the findings file)
- Payload shape: an object keyed by `""` for bulk updates or `"1:2:3"` for component paths
- `page.applyPropertyUpdates` is native code; expects the full WS frame envelope
  `{"values":{"views":{...},"page":{},"session":{}},"sync":[]}`

**Key facts verified:**
- Bulk view update: `view.applyPropertyUpdates({"":{"params":<encoded>,"custom":<encoded>}})`
- Session update: full `client-value-update` envelope passed to `page.applyPropertyUpdates`

### Probe 6 (`findings/recon-8.3.6-2026-05-07-probe6.txt`)

- `window.__client` → PATH A: FOUND
- Fiber walk → PATH B: BROKEN in 8.3.6 (class names changed)
- Session store: 19/19 expected keys present
- Page: 28/28 expected keys/methods present
- View store: 21/21 expected keys/methods present
- Property tree (params): 26/26 expected methods present

**Key facts verified:**
- All 94 names stable in 8.3.6; fiber walk is deprecated for 8.3.x builds
- `mountPath` is an opaque short ID (`"C"` in our capture) — use `resourcePath` for matching

---

## What "Regressing" Looks Like

After an IA upgrade, re-run the probes and compare to the baseline:

| Probe output | Meaning | Affected recipes |
|---|---|---|
| `window.__client: NOT FOUND` (Probe 1) | `window.__client` removed or renamed | **All recipes broken** — find the new global name |
| `MISSING: page.views` (Probe 6) | MobX view map moved | Every view-finding recipe |
| `MISSING: params.write` (Probe 6) | Property tree API changed | Every data-flow recipe |
| `MISSING: page._newViewStore` (Probe 6) | Ghost store factory removed | Ghost store patterns |
| `connection.send.toString()` no longer `[native code]` (Probe 3) | IA wrapped `send` in a client-side function | Gateway RPC — raw send pattern needs update |
| `params.update(null)` does NOT access `e.$` (Probe 2) | Encoded format changed | `applyPropertyUpdates` patterns |

If Probe 6 shows any `MISSING` result for a name that was previously OK, open
`docs/PERSPECTIVE_INTERNALS.md` and find the section that documents that name. The "See also"
cross-references below link each probe to its relevant INTERNALS section.

---

## Scripts

| Script | Description |
|--------|-------------|
| `scripts/recon_01_window_client.txt` | Scan `window.__client` + 9 candidate global names; dump own keys + page/connection keys |
| `scripts/recon_02_property_tree_update.txt` | Probe `params.update()` + `params.operate()` + enumerate prototype methods |
| `scripts/recon_03_connection_send.txt` | Hook `WebSocket.prototype.send` + capture all outgoing/incoming WS frames; dump URL and readyState |
| `scripts/recon_04_new_view_store.txt` | Probe `page._newViewStore`, `page.startView`, `page._findViewDef`, `page._isViewDefined` |
| `scripts/recon_05_apply_property_updates.txt` | Probe `view.applyPropertyUpdates` + `page.applyPropertyUpdates` + `page.applyPendingUpdates` |
| `scripts/recon_06_cross_version.txt` | Compare PATH A (`window.__client`) vs PATH B (fiber walk); check all 94 expected names against live session/page/view/params objects |

---

## See Also

| Probe | PERSPECTIVE_INTERNALS.md section |
|-------|----------------------------------|
| 1 (window.__client global) | §4 "Route 0 — `window.__client`" |
| 2 (property tree update / operate) | §2 "Property Tree API", §11 Q2/Q3 |
| 3 (WebSocket + connection.send) | §14 "Gateway WS Protocol", §11 Q4 |
| 4 (_newViewStore) | §16 "Ghost View Stores via _newViewStore", §11 Q5 |
| 5 (applyPropertyUpdates) | §15 "Synthesizing Property Updates Client-Side", §11 Q6 |
| 6 (cross-version stability) | §11 Q7, §5 "mountPath vs resourcePath", §12 "Fiber Walk (deprecated)" |

All six questions are answered and documented in `docs/PERSPECTIVE_INTERNALS.md §11`.
Findings for 8.3.6 are in `findings/recon-8.3.6-2026-05-07-probe*.txt`.
