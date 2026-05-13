# Perspective Internals — Architectural Reference

What we know about Ignition Perspective's client-side architecture, distilled from reverse-engineering against live Ignition gateways (April–May 2026) plus follow-up reading. Use this as the seed knowledge so future sessions don't re-derive it.

**Verified against:** Ignition 8.1.x, 8.3.0–8.3.6 (as of May 2026).
**Source disclaimer:** all of this is from minified production builds. Names like `viewMountPath`, `applyPropertyUpdates`, `_newViewStore` are stable (unmangled) but everything else is one IA build optimization away from breaking.

---

## 1. The high-level architecture

Perspective's browser session is a **React app**, but the binding system sits **on top of MobX**. There are two separate state machines:

1. **React state** — drives the rendered DOM. Component-local state. Resyncs from props on every render.
2. **MobX-backed property trees** — the source of truth for view params, custom props, component bound props, and gateway sync. Bindings, propertyChange scripts, and `requestSync` to the gateway are all reactions wired to these trees.

**The mistake we made for hours:** trying to update React state hoping it would propagate to MobX. It doesn't. React state is a **derived cache** of MobX values; mutations there are overwritten on the next render.

**The fix:** write directly to the MobX property tree. The bindings react automatically.

---

## 2. The MobX property tree shape

Each property tree (e.g. `view.params`, `view.custom`, `store.props`) is a class instance with this prototype interface:

```javascript
{
  // Read methods
  read(key)              // returns plain value
  readString(key)        // typed reads
  readStringIfExists(key) // like readString but returns undefined (not error) if key absent
  readNumber(key)
  readBoolean(key)
  readDate(key)
  readArray(key)
  readObject(key)
  readStyle(key)         // typed reads for style/color/dataset/type values (added 8.3.x)
  readColor(key)
  readDataset(key)
  readType(key)
  readQualified(key)     // returns {value, qualityCode, timestamp}
  readEncoded(key)       // serialized form
  readKeys()             // all keys at root
  readLength()           // for arrays
  qualityOf(key)
  isObject(key) / isArray(key) / isPrimitive(key) / isDataset(key)

  // Write methods
  write(key, value)      // ★ THE ONE THAT TRIGGERS BINDINGS
  update(encodedMessage) // bulk update — thin wrapper: this.root.update(e) && this.notify()
                         // encoded format: discriminated tuple {"$":["tag",...args]} e.g.
                         // {"$":["map/merge"],"key":{"$":["ts",0,epochMs]}}
                         // cannot synthesize without knowing full tag vocabulary; use write() instead
  operate(pathString, mapCb, primitiveCb, arrayCb)
                         // path-navigator, NOT a write API — walks the property tree following
                         // dotted/bracketed syntax and dispatches to callback at the leaf;
                         // internal binding plumbing, all 3 callbacks are required

  // Hooks
  subscribe(fn)          // listen for changes
  onWrite(fn)
  onWriteCallback        // settable callback property

  // Diagnostic
  isDirty()
  getDirtyWrites()
  getQualities()
  toPlainObject()
  export()
}
```

**`write(key, value)` is the canonical write.** It triggers MobX reactions, which cascade through:
- bound consumers (other props, styles, scripts)
- `propertyChange` scripts on consumers
- `requestSync()` which queues the change for gateway sync

---

## 3. The two levels you can write at — only one works

```
view.params                    ← SOURCE OF TRUTH (write here)
  ↓ (binding: view.params.color → component.props.text)
component.props                ← derived cache (writing here is local-only)
  ↓ (componentDidUpdate resyncs from React props)
DOM input.value                ← derived display (writing here is render-only)
```

| Layer | Write here? | Effect |
|---|---|---|
| **DOM `input.value` directly** (HTMLInputElement.prototype.value setter) | ❌ | Updates pixel value briefly. React re-renders, overwrites back. |
| **`__reactProps$<id>.onChange(syntheticEvent)`** | ❌ | Updates React state → updates DOM. MobX never sees it. |
| **Component `setState`/`forceUpdate`/`updateFromText`** | ❌ | Same — React-only. `componentDidUpdate` resyncs from props. |
| **Component-store `sn.props.store.props.write('text', value)`** | ❌ | Updates the component's MobX cache. Bindings between component-store and view-store don't fire on this. Visible text updates; param doesn't. |
| **View-store `view.params.write('color', value)`** | ✅ | The source of truth. Bindings fire, propertyChange scripts run, `requestSync` queues, gateway sees it. |

---

## 4. Reaching the view store from arbitrary JS

Three routes. **Route 0 is the canonical choice for 8.3.x** — use it unless targeting older
builds or builds where the global has been removed (Route A is the fallback in that case).

### Route 0 — `window.__client` (canonical in 8.3.x) ✅ verified 8.3.6

`window.__client` is the session-level MobX store, confirmed present and functional in 8.3.6
by Probe 1 (2026-05-07). It is the **same object** the fiber walk reaches at L9. Use it as
the zero-overhead shortcut for all 8.3.x work.

```javascript
// Direct reach — no DOM walk required
var views = Array.from(window.__client.page.views.values());

// Find a specific view by its mountPath, or use views[0] for the active view.
var view = views.find(v => v.mountPath === 'cookbook/Internals_Recon@0') || views[0];

// Write to its params (triggers bindings, gateway sync).
view.params.write('color', '#FF0000');

// Other useful paths:
// window.__client.page          — page/view management
// window.__client.connection    — WebSocket bridge (.send, .webSocket)
// window.__client.auth          — session auth state
// window.__client.system        — gateway info
// window.__client.notifications — session-level notifications
```

**Full own-key list** (8.3.6): `error, _redundancyStatus, _fullscreenTransition, bluetooth,
deviceSettings, networkLatencyTimestampedData, simulatingLostConnection, subscriptionMap, flags,
upTimeStartTime, sessionPropsChangeDisposer, subscribe, notify, projectName, _tabId,
tabIdUrlSafe, projectTitle, edition, coBrandingEnabled, _autoIdpAuthAllowed, sessionId,
activeContextMenuRef, sessionClosedMessage, pageClosedMessage, created, lastHelloCheck,
stateReactionMap, fsm, history, instrumentation, connection, resources, mounts, page,
defaultsStore, auth, system, notifications, location, idle, keyEvent, iconRendererStore,
symbolRendererStore, formSubmissionStore, autoIdpAuth, _token, sessionState`

---

### Route A — fiber walk from any DOM node in the view

Use this when `window.__client` is absent (older builds, possible future hardening). See §12
for the updated, robust fiber-walk pattern.

**Quick reference** (for when you need it):

```javascript
// Pick any DOM element rendered by Perspective
var el = document.querySelector('input[type=text]');  // or whatever exists in your view

// Get the React fiber attached to it
var fk = Object.keys(el).filter(k => k.indexOf('__reactFiber') === 0)[0];
var fiber = el[fk];

// The picker's own component is at fiber level 2 (input → wrapper → component).
// L2's stateNode.props.store has viewMountPath — the mount key for this view.
var f = fiber;
for (var i = 0; i < 2; i++) f = f.return;
var viewMountPath = f.stateNode.props.store.viewMountPath;

// Continue up to L9 — the page/session shell.
for (var i = 0; i < 7; i++) f = f.return;
var page = f.stateNode.props.store.page;

// page.views is a MobX ObservableMap of ALL open view stores.
var views;
try { views = Array.from(page.views.values()); }
catch (e) { views = Object.values(page.views._data || {}); }

// Find this picker's own view by matching the mountPath.
var ourView = views.find(v => v.mountPath === viewMountPath);

// Now write to its params.
ourView.params.write('color', '#FF0000');
```

### Route B — other `window.*` globals

In 8.3.6, only `window.__client` exists. `window.__ignition`, `window.__perspective`,
`window.__pg`, `window.__session`, `window.__store`, `window.__app`, `window.__gateway`,
`window.__IA`, and `window.__Perspective` are all `undefined`. (Confirmed by Probe 1.)

---

## 5. The view store — what's inside

Every entry in `page.views` has these instance keys (verified 8.3):

```javascript
{
  // Identity
  mountPath,             // ⚠️ opaque short ID in 8.3.6+ (e.g. "C") — NOT a path-like string.
                         // Do NOT pattern-match; use resourcePath for the human-readable path.
  resourcePath,          // human-readable view path, e.g. "cookbook/Internals_Recon" — use for matching
  addressPathString,
  birthDate, instanceId,

  // State
  running, accessDenied, viewLoadedFromSessionState,

  // Property trees (each with the read/write/update API from §2)
  params,
  custom,
  props,
  root,             // composite root — visit/write/addChild
  sessionState,

  // Internal
  componentEvents, dockOffsetState, subscriptionMap,
  inputBehavior, def, page, dirtyProps, resourcePaths,
  outputDisposer, initialParams,

  // Subscriptions
  subscribe, notify
}
```

And these prototype methods:

```javascript
constructor, requestPrint, setAccessDenied, initRoot,
hasInput, readInputs, writeInputs,
_newComponentStore,
setOutputListener, startup, shutdown, _disposeOutputListener,
updateOnReconnect, applyPropertyUpdates, dispatchEvent, onPropChange,
prepareSyncRequest, clearSyncedModels, isDirty
```

`applyPropertyUpdates` is documented in **§15** (synthesizing property updates client-side).
`_newComponentStore` creates per-component stores — internal plumbing for `startView`. For
spawning ghost view stores from JS, see **§16** (`page._newViewStore`).

---

## 6. The page / session level

`page` (reachable as `f.stateNode.props.store.page` at fiber L9) has these notable members:

```javascript
{
  // View management
  views,                       // MobX Map of view stores
  pendingPropertyUpdates,      // queue of pending updates
  dirtyViews, missingViewUpdates, eventsToSync,
  pageProps, sessionProps, sessionStateCache, sessionCustom,

  // Methods
  applyPropertyUpdates,        // bound, native code — accepts encoded messages
  applyPagePropertyUpdates,
  applySessionPropertyUpdates,
  applyPendingUpdates,
  applyPropertyUpdates,
  onPropWrite(e,t){this.requestSync()},  // ← single-line bridge to gateway sync
  findView, observeView, isOpen,
  startView, stopView, _newViewStore, _findViewDef, _isViewDefined,
  isLoadAheadSafe, startViewLoadAhead, onViewWrite,
  requestSync, sync, sendResynchronizeViews,

  // File / download / event handling
  downloadFile, onFileDownload,
  eventFiredFromGateway, onEventFired,

  // Lifecycle
  initSessionProps, onPagePropsChange, onSessionPropsChange,
  applyPagePropertyUpdates, applySessionPropertyUpdates,
  reloadSymbolStyles
}
```

Higher up (the L9 store itself, not `page`) has the entire client:

```javascript
{
  system,        // gateway info, modules, license — read-only client metadata
  notifications, // session-level notification triggers
  location,      // geolocation, session location
  page,          // the above
  defaultsStore, auth, system, notifications,
  connection,    // ★ webSocket + send for direct gateway RPC
  iconRendererStore, autoIdpAuth, _token, sessionState,
  history, instrumentation, mounts, fsm,
  flags, error, idle, keyEvent
}
```

`connection.send` + `connection.webSocket` are the gateway bridge. Reverse-engineering the protocol is task-11.

---

## 7. Component-level store (for completeness)

Each Perspective component has its own store reachable at fiber L2's `stateNode.props.store`:

```javascript
{
  childComponents, contextSubmenus, subscriptionMap,
  view,                 // back-reference to the view store
  viewMountPath,        // the view's mount key
  parent,               // parent component store
  addressPath, addressPathString, path,
  def, componentTooltipFlag, clientStore,
  props,                // property tree — but writes here DON'T propagate
  meta, _position, componentMeta, Component,
  componentEvents, domEvents,
  subscribe, notify, _custom, _ref
}
```

**Reminder: writing to `componentStore.props.write(...)` updates the component's local cache only.** Use the view store instead.

---

## 8. The Markdown injection vector — practical setup

```json
{
  "type": "ia.display.markdown",
  "props": {
    "markdown": { "escapeHtml": false }
  },
  "propConfig": {
    "props.source": {
      "binding": {
        "type": "expr",
        "config": {
          "expression": "concat('<div>your html here, <script-like-content>...</div>')"
        }
      }
    }
  }
}
```

- `markdown.escapeHtml: false` lets HTML through. Without this, all your tags become escaped text.
- Use `concat(...)` over `+ ... +` for cleaner string building.
- Inline event handlers (`oninput`, `onclick`, `onload`) are the simplest way to run code. Wrap with `(function(){...})()` IIFE if you need scope isolation.
- For complex JS, load via `<script src="https://cdn.example.com/lib.js"></script>` — CDN-loadable libraries are fair game.

### Bridge component

For value-back-to-Perspective workflows, you typically need at least one Perspective component as a "hop point" so `document.querySelector` finds something with a known fiber. A hidden TextField with `style.display: none` works. Avoid `meta.visible: false` — that unmounts the component from the React tree, breaking the fiber walk.

When the view has multiple inputs, target the bridge with `style.classes: "myBridge"` and select via `.myBridge input`.

---

## 9. Browser API capabilities matter

Once JS runs in a Perspective session, all standard browser APIs are available (subject to permission prompts and HTTPS requirements):

| API | Use case | Requires HTTPS |
|---|---|---|
| Web Bluetooth | BLE scanners, sensors, calibration devices | Yes |
| Web Serial | COM/RS-232 devices | Yes |
| WebUSB | Direct USB device access | Yes |
| Web HID | Game controllers, custom HID devices | Yes |
| getUserMedia | Camera/mic, QR scanning, voice input | Yes |
| WebRTC | Peer video/audio, data channels | Yes |
| Service Workers | Offline / push notifications / PWA | Yes |
| Web Workers | Off-main-thread computation | No |
| IndexedDB | Large client-side cache | No |
| File System Access API | Local file read/write | Yes (Chrome) |
| Geolocation | GPS coordinates | Yes |
| Speech Recognition / Synthesis | Voice control / TTS | Yes |
| Web NFC | NFC tag read/write (Android Chrome) | Yes |

For HTTPS-required APIs, the gateway can be configured with TLS — or for dev use Chrome's `chrome://flags/#unsafely-treat-insecure-origin-as-secure` allowlist.

---

## 10. Known gotchas

- **`escapeHtml: false` + bound user-controlled data = stored XSS.** Never wire `props.source` to a tag, DB field, URL param, or anything else a non-trusted user can influence. Static markup only.
- **Fiber depths can shift.** "Level 2" / "Level 9" depths are stable as long as the view structure stays similar — but if you embed views, layer in extra wrappers, etc., the offsets change. Better long-term: walk up until you find a fiber whose stateNode has `viewMountPath` (level 2-ish target) or `page` (level 9-ish target), rather than fixed offsets.
- **MobX ObservableMap iteration.** `page.views.values()` works in some IA builds; `page.views._data` map fallback works in others. Always have both.
- **`meta.visible: false` removes from DOM.** Use `position: { basis: 0 }` + `style: { overflow: hidden }` for hiding without unmounting.
- **Multiple input[type=text] in one view.** Bridge selector collides. Use a unique CSS class on the bridge component and select via `.bridgeClass input`.
- **Markdown source is treated as a static string** unless you bind it via expression. Direct property values are NOT interpolated — `value="{view.params.color}"` ends up literal text.
- **`mountPath` is opaque in 8.3.6+.** Don't pattern-match against it. In 8.3.6 it is a single-char opaque ID (e.g. `"C"`), not a readable path. Use `resourcePath` for human-readable view matching (e.g. `views.find(v => v.resourcePath === 'cookbook/Internals_Recon')`).

---

## 11. Open questions — probe status (task-02)

Probes are in `scripts/recon_*.txt` and `views/Internals_Recon.json`. Each item below notes
what the probe tests and what to look for. Items marked ✅ are answered; 🔬 means "probe written,
awaiting execution results".

### Q1 — `window.__client` ✅ ANSWERED (2026-05-07, Probe 1, Ignition 8.3.6)

**Finding:** `window.__client` EXISTS in 8.3.6. It is the session-level MobX store — the same
object the fiber walk reaches at L9. It has a `.page.views` MobX ObservableMap with all open
view stores, and `.connection.webSocket` for the live WebSocket. No other `window.__*` globals
matched. Direct access pattern:

```javascript
var views = Array.from(window.__client.page.views.values());
var view = views.find(v => v.mountPath === '<viewMountPath>') || views[0];
view.params.write('key', value);
```

**Implication:** the §4 fiber walk is no longer required as the primary reach mechanism for
8.3.x. `window.__client` is faster, simpler, and immune to DOM class-name changes. Probes 2–6
have been rewritten to use this path. Probe 6 retains the fiber walk as a secondary pass to
detect when `window.__client` disappears in future builds.

Capture: `findings/recon-8.3.6-2026-05-07-probe1.txt`.

---

### Q2 — `propertyTree.update()` argument format ✅ ANSWERED (2026-05-07, Probe 2 + Probe 3)

**Finding:** `update()` is a thin wrapper — full source: `update(e){ this.root.update(e) && this.notify() }`.
The actual encoding lives on `params.root`. All untyped payloads (`{}`, `[]`, `ArrayBuffer`) throw
`"Update message not encoded properly"`. `update(null)` exposes the discriminator — it crashes
reading `e.$`, confirming the encoded format has a `$` discriminator field.

Probe 3's captured `client-value-update` WS frame revealed the actual wire format:

```json
{
  "$": ["map/merge"],
  "lastActivity": { "$": ["ts", 0, 1778190946278], "$ts": 1778190946278 }
}
```

The encoded format uses **discriminated tuples in a `$` field**: `["tag", ...args]`. Tags observed:
`"map/merge"` (merge-into-map) and `"ts"` (typed timestamp: `[flag, epochMs]`). Full tag vocabulary
not yet enumerated — see `task-02-followups.md` Probe 3c for the follow-up.

**Practical:** use `params.write(key, value)` for single-key updates. For bulk updates use
`view.applyPropertyUpdates` (§15), which accepts the same tuple format.

Capture: `findings/recon-8.3.6-2026-05-07-probe2.txt` + `findings/recon-8.3.6-2026-05-07-probe3.txt`.

---

### Q3 — `propertyTree.operate()` argument format ✅ ANSWERED (2026-05-07, Probe 2)

**Finding:** `operate()` is **not a write API** — it is an internal path-navigator with this
signature (deminified from live source):

```javascript
operate(pathString, mapCallback, primitiveCallback, arrayCallback)
```

It walks `this.root` following dotted/bracketed path syntax (`foo.bar[0].baz`), descends into
`isMap` or `isArray` nodes, and dispatches to the matching callback at the leaf. All 3 callback
arguments are mandatory — omitting any throws `"t/o is not a function"`. This is binding-system
plumbing, not a user-facing write primitive.

**Practical:** ignore `operate()` for our purposes. Use `write(key, value)`.

Capture: `findings/recon-8.3.6-2026-05-07-probe2.txt`.

---

### Q4 — `connection.send` wire format ✅ ANSWERED (2026-05-07, Probe 3)

**Finding:** the gateway WebSocket protocol is **plain text — no binary, no protobuf**. Frame
format: `<message-type>:<json-payload>` (literal colon separator).

`connection.send.toString()` → `"function () { [native code] }"` — it IS the native WebSocket
`send` bound to the socket. Frames are pre-formatted strings with no client-side wrapping.

Observed message types so far:
- `client-activity` (out) — heartbeat: `{"lastActiveTime": <epoch-ms>}`
- `client-value-update` (in) — gateway → client property push (see §14)
- `keepalive` (in) — gateway → client heartbeat: `{"ts": <JVM-nanoTime>}`

WebSocket URL pattern: `ws://<host>:<port>/system/pws/<project>/<sessionId>?token=<token>`

For the full wire-format spec and direct-send recipe see **§14 — Gateway WebSocket protocol**.

**Implication:** anyone with access to the Markdown-injection vector can call `connection.send`
to make arbitrary gateway RPC calls as the logged-in user. See §14 security caveat.

Capture: `findings/recon-8.3.6-2026-05-07-probe3.txt`.

---

### Q5 — `page._newViewStore` ✅ ANSWERED (2026-05-07, Probe 4)

**Finding:** `_newViewStore` is a **client-only factory** — creates a fully functional ViewStore
without any gateway round-trip. The view path does not need to exist on the server.

Deminified source:
```javascript
_newViewStore(viewPath, params, mountPath, options, sessionState) {
  const key = w.instanceKeyFor(viewPath, params);
  const cachedState = this.sessionStateCache.remove(key);
  return new f.ViewStore(this, viewPath, params, mountPath, options, cachedState, sessionState);
}
```

The probe log showed `"ERR Converting circular structure to JSON"` — that was the probe's logging
helper (`JSON.stringify` on a MobX store with circular refs), not the call itself. The ViewStore
was successfully created. Ghost stores have full property-tree API but are **not registered in
`page.views`** — you must hold your own JS reference.

For patterns, use cases, and the `startView` relationship see **§16 — Ghost view stores**.

Capture: `findings/recon-8.3.6-2026-05-07-probe4.txt`.

---

### Q6 — `applyPropertyUpdates` ✅ ANSWERED (2026-05-07, Probe 5)

**Finding:** two distinct methods at different levels — both documented with source or inferred shape.

**`view.applyPropertyUpdates(payload)`** — view-level, full source obtained. Takes a plain object
(not an array) keyed by `""` for bulk tree updates or `"1:2:3"` for numeric component ID paths:
```javascript
// Bulk params update:
view.applyPropertyUpdates({
  "": { params: { "$": ["map/merge"], "color": { "$": ["str", "#FF0000"] } } }
});
// Component-tree update:
view.applyPropertyUpdates({ "1:2:3": <encoded-component-payload> });
```

**`page.applyPropertyUpdates(frame)`** — session-level, native code. Expects the full incoming
WS-frame envelope (confirmed by cross-referencing error messages with Probe 3 captured frames):
```javascript
page.applyPropertyUpdates({
  values: { views: { "<mountPath>": <view-payload> }, page: {}, session: {} },
  sync: []
});
```

**`page.applyPendingUpdates()`** — no-arg, drains `page.pendingPropertyUpdates` queue.

For deminified source, worked examples, and when to use these vs. `params.write()` see **§15**.

Capture: `findings/recon-8.3.6-2026-05-07-probe5.txt`.

---

### Q7 — Cross-version stability ✅ ANSWERED for 8.3.6 (2026-05-07, Probe 6)

**Finding:** all documented surface names from §2, §5, §6 are present and functional in 8.3.6.
Probe 6 ran a 94-item named checklist against the live session with 0 regressions:

- **19/19** expected session-store keys (`window.__client.*`)
- **28/28** expected page-level methods/fields
- **21/21** expected view-store keys/methods
- **26/26** expected property-tree methods

**Name stability verdict:** MobX/JS layer names are stable 8.3.0 → 8.3.6. DOM class names are
NOT stable — `.ia-display-markdown` returns null in 8.3.6 (fiber walk broken). Never depend
on DOM class names.

**`mountPath` mystery solved:** `page.views` has exactly 1 view (our `Internals_Recon` view,
the only one created) with `mountPath = "C"`. In 8.3.6 `mountPath` is an opaque short ID.
The human-readable path lives in `resourcePath`. See §5 and §10.

**For 8.3.x:** always use `window.__client` (§4 Route 0). Fiber walk is broken in this build.
For older builds or if the global disappears in a future build, see §12.

Capture: `findings/recon-8.3.6-2026-05-07-probe6.txt`.

---

## 12. Fiber walk — fallback for older builds / future hardening of `window.__client`

> **⚠️ Broken in 8.3.6.** Probe 6 (2026-05-07) confirmed: all three selector candidates
> (`.ia-display-markdown`, `input[type=text]`, `[class*="ia-"]`) return `null` in the current
> build — the Markdown component's rendered wrapper class changed and none of the fallbacks match.
> The fiber walk cannot reach `page.views` via DOM in 8.3.6.
>
> **For 8.3.x always use `window.__client` (§4 Route 0).** Preserve this section as the
> fallback for older builds (pre-8.3.x) or for any future IA version that removes the global.

The original color picker pattern required an `input[type=text]` bridge. For builds where
the fiber walk is still needed, use a dynamic startEl chain and a depth-bounded upward walk:

```javascript
var startEl = document.querySelector('.ia-display-markdown') ||
              document.querySelector('input[type=text]') ||
              document.querySelector('[class*="ia-"]');

if (!startEl) { /* fall back to window.__client */ }

var fk = Object.keys(startEl).filter(k => k.indexOf('__reactFiber') === 0)[0];
```

**Recommended fiber-walk pattern** (replaces the fixed-depth `for (i < 9)` walk):

```javascript
var f = startEl[Object.keys(startEl).find(k => k.startsWith('__reactFiber'))];
var sessionStore = null;
for (var i = 0; i < 60 && f; i++, f = f.return) {
  try {
    if (f.stateNode?.props?.store?.page) {
      sessionStore = f.stateNode.props.store;
      break;
    }
  } catch(e) {}
}
// sessionStore.page, sessionStore.connection, etc.
var views = Array.from(sessionStore.page.views.values())
         || Object.values(sessionStore.page.views._data || {});
```

The depth-60 walk with early-exit is more robust than the fixed-depth approach when view
nesting changes across IA versions. Probe 6 uses both the fiber walk AND `window.__client`
and compares them so future breakage is immediately detectable.

---

## 13. Probe delivery pattern — `eval(atob(...))`

For complex probe scripts injected via the Markdown component, the cleanest delivery
mechanism is base64-encoded JS evaluated in an `onload` handler:

```javascript
// Perspective expression (concat produces the HTML):
concat(
  '<div id="recon-output" ...>Running...</div>',
  '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=="',
  ' style="display:none"',
  ' onload="eval(atob(\'BASE64_OF_PROBE_JS\'))">'
)
```

**Advantages over inline JS in the `oninput` handler:**
- Base64 contains only `A-Za-z0-9+/=` — no quoting issues inside the Perspective expression
- The probe JS can be written cleanly (no `\'` escaping throughout)
- Easily regenerated: `base64 -w 0 probe.js`
- The img fires exactly once per DOM insertion (no repeat on re-render since the src is a
  stable data URI — the browser caches it and doesn't re-fire `onload`)

**Interaction buttons** use the same pattern:
```javascript
'<button onclick="eval(atob(\'BASE64\'))">Run probe</button>'
```
The `\'` around `BASE64` escapes the single-quote string delimiter inside the Perspective
expression string. The resulting HTML has `onclick="eval(atob('BASE64'))"` which the browser
executes as valid JS.

---

---

## 14. Gateway WebSocket protocol — observed wire format

All observations from Probe 3 (2026-05-07) on Ignition 8.3.6. See
`findings/recon-8.3.6-2026-05-07-probe3.txt` for the raw capture.

### WS URL pattern

```
ws://<gateway-host>:<port>/system/pws/<project-name>/<sessionId>?token=<token>
```

Example captured: `ws://<your-gateway-host>:18088/system/pws/cookbook/<session-id>?token=<redacted>`

### Frame format

**Plain text. No binary. No protobuf.**

```
<message-type>:<json-payload>
```

A literal colon separates the message type from the JSON payload. Both fields are plain UTF-8 text.

### Message type catalog (observed so far)

| Direction | Type | Payload shape |
|---|---|---|
| Out (client → gateway) | `client-activity` | `{"lastActiveTime": <epoch-ms>}` — idle heartbeat ~every 13–15 s |
| In (gateway → client) | `client-value-update` | `{"values":{...}, "sync":[]}` — property push (see below) |
| In (gateway → client) | `keepalive` | `{"ts": <JVM-nanoTime>}` — gateway heartbeat |

More types exist (tag reads/writes, named queries, view nav, alarm events, script runs, etc.) but
have not yet been captured. See `task-02-followups.md` Probe 3b for the interactive catalog
follow-up.

**Note on `keepalive.ts`:** the timestamp is very large (~4.4 trillion) — JVM `System.nanoTime()`,
not epoch-ms. Different time domain from `client-activity.lastActiveTime`.

### `client-value-update` payload shape

```json
{
  "values": {
    "views":   { "<mountPath>": "<view-level-payload>" },
    "page":    {},
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

When the session is idle `views` and `page` are empty `{}`. A view-level update (e.g., a tag
binding change) would populate `views["<mountPath>"]` with a per-view payload keyed by `""`
(bulk tree update) or `"1:2:3"` (component numeric ID path) — the same shape accepted by
`view.applyPropertyUpdates` (§15).

### Encoded property-tree tuple format

Property values in wire frames use **discriminated tuples** tagged by a `$` field:

```json
{ "$": ["tag", ...args] }
```

Observed tags so far:

| Tag | Args | Meaning |
|---|---|---|
| `"map/merge"` | (none) | treat the enclosing object as a merge-into-map operation |
| `"ts"` | `[flag, epochMs]` | typed timestamp; `$ts` shadow for fast numeric access |

Full tag vocabulary (`"str"`, `"num"`, `"bool"`, `"date"`, `"dataset"`, etc.) not yet enumerated.
See `task-02-followups.md` Probe 3c.

### Direct-send recipe via `connection.send`

`connection.send` IS the native `WebSocket.send` bound to the live socket — no wrapper, no
serializer. Pre-format the `<type>:<json>` string yourself and call it directly:

```javascript
var conn = window.__client.connection;
// Example: send a manual heartbeat
conn.send('client-activity:{"lastActiveTime":' + Date.now() + '}');
```

### ⚠️ Security caveat

Anyone who can execute JS in the Perspective session (including via the Markdown `escapeHtml:false`
vector) can call `connection.send` to make **arbitrary gateway RPC calls as the logged-in user** —
tag writes, named query calls, script runs, alarm acks, session-prop writes, etc.

This is the full scope of the injection technique and is also the full attack surface.

**Never wire `props.source` to user-controlled data.** See §10 for the stored-XSS note.

---

## 15. Synthesizing property updates client-side

From Probe 5 (2026-05-07). Two entry points depending on scope. See
`findings/recon-8.3.6-2026-05-07-probe5.txt` for the raw capture.

### `view.applyPropertyUpdates(payload)` — view-level

**Full deminified source** (obtained directly from the live session):

```javascript
applyPropertyUpdates(e) {
  Object.keys(e).forEach((t) => {
    try {
      if ("" === t) {
        // Bulk update for the view's own property trees
        const inner = e[""];
        inner.params && this.params.update(inner.params);
        inner.props  && this.props.update(inner.props);
        inner.custom && this.custom.update(inner.custom);
      } else {
        // Component-tree update by numeric ID path
        const path = t.split(":").map((s) => parseInt(s));
        this.root.dispatchUpdates(path, e[t]);
      }
    } catch (err) {
      h.fatalException(`Error applying property updates on ${this.instanceId}.${t}`, err);
    }
  });
}
```

**Payload shape:** a plain object (not an array) whose keys are:

| Key | Value | Effect |
|---|---|---|
| `""` | `{params?, props?, custom?}` | Bulk-updates each named property tree via `.update(encodedTree)` |
| `"1:2:3"` | encoded component payload | Updates a specific component in `view.root` by numeric ID path |

### Worked example — bulk params update

```javascript
var view = Array.from(window.__client.page.views.values())[0];

// Bulk update via applyPropertyUpdates (once tag vocabulary is known):
view.applyPropertyUpdates({
  "": {
    params: {
      "$": ["map/merge"],
      "color": { "$": ["str", "#FF0000"] }
    }
  }
});

// Simpler alternative for a single key (no encoding required):
view.params.write("color", "#FF0000");
```

Use `applyPropertyUpdates` when replaying a captured gateway frame or applying many keys
atomically in one MobX reaction batch. Use `params.write(key, value)` for simple single-key
updates.

### `page.applyPropertyUpdates(frame)` — session-level

Native code (no source). Expects the **full incoming-WS-frame envelope** from the gateway
(confirmed by cross-referencing error messages against Probe 3's captured frames):

```javascript
window.__client.page.applyPropertyUpdates({
  values: {
    views:   { "C": { "": { params: { "$": ["map/merge"], "color": "#FF0000" } } } },
    page:    {},
    session: {}
  },
  sync: []
});
```

This is literally the entry point the WS message handler calls when a `client-value-update` frame
arrives. Replaying a captured frame means feeding it here verbatim (or after modifications).

### `page.applyPendingUpdates()` — drain the queue

```javascript
window.__client.page.applyPendingUpdates();
```

No arguments. Drains `page.pendingPropertyUpdates`. Useful for batch-queue workflows.

### When to use which

| Goal | Method |
|---|---|
| Set a single param | `view.params.write(key, value)` — simplest, no encoding needed |
| Set multiple params atomically | `view.applyPropertyUpdates({"": {params: <encoded>}})` |
| Replay a full captured WS frame | `page.applyPropertyUpdates(<frame>)` |
| Drain the pending update queue | `page.applyPendingUpdates()` |

---

## 16. Ghost view stores via `page._newViewStore`

From Probe 4 (2026-05-07). `_newViewStore` is a client-only ViewStore factory — no gateway
round-trip, no server-side view definition required. See
`findings/recon-8.3.6-2026-05-07-probe4.txt` for the raw capture.

### Signature

```javascript
page._newViewStore(viewPath, params, mountPath?, options?, sessionState?)
```

Deminified source:

```javascript
_newViewStore(viewPath, params, mountPath, options, sessionState) {
  const key = w.instanceKeyFor(viewPath, params);
  const cachedState = this.sessionStateCache.remove(key);
  return new f.ViewStore(this, viewPath, params, mountPath, options, cachedState, sessionState);
}
```

### Worked example

```javascript
// Spawn a ghost store (view path need not exist on the gateway)
var ghost = window.__client.page._newViewStore('ghost/scratch', {});

// Read / write params — full property-tree API available
ghost.params.write('counter', 0);
ghost.params.read('counter');    // → 0

// Subscribe to changes
ghost.params.subscribe(function() {
  console.log('counter is now', ghost.params.read('counter'));
});
ghost.params.write('counter', 1);  // fires the subscriber

// Keep a global ref — ghost stores are NOT in page.views
window.__myGhostStore = ghost;
```

> **Note on the Probe 4 error log.** The probe's `tryIt()` helper called `JSON.stringify` on
> the returned ViewStore. MobX stores have circular refs (`componentEvents.component` cycles
> back), so JSON.stringify threw. The ViewStore was successfully created — the "ERR" was from
> the logger, not the call. Future probes should use a circular-safe formatter instead of
> `JSON.stringify` on MobX store return values:
> ```javascript
> try { return JSON.stringify(r); }
> catch(e) { return Object.prototype.toString.call(r) + ' [circular-ok]'; }
> ```

### ⚠️ Caveats

- Ghost stores are **not registered in `page.views`**. `Array.from(page.views.values())` will
  not find them. You must hold your own JS reference (`window.__myStore = ghost`).
- Ghost stores **do not sync to the gateway** — no server-side view definition means no sync
  target. Writes are client-local only.
- Ghost stores survive DOM re-renders as long as the JS reference is alive (they are plain
  objects, not tied to the React tree or React lifecycle).

### Use cases

- **Cross-component shared state** within one Perspective session — multiple Markdown injection
  components can share a single ghost store without polluting any real view's params.
- **MobX-backed scratch space** for D3 charts, Monaco editor state, or other client libraries
  that need reactive/observable data.
- **Replaying captured updates** — create a ghost, call `applyPropertyUpdates`, inspect the
  resulting property tree offline without touching the live gateway state.
- **Testing reactivity** — write to a ghost store, subscribe, verify MobX reactions fire
  without any gateway involvement.

### Relationship to `page.startView`

`_newViewStore` creates the store object only. `page.startView` (observed source:
`function(){return ye(e,t,n||this,arguments)}`) additionally registers the store in `page.views`
and initiates the full gateway sync lifecycle (view definition fetch, startup scripts, etc.). Use
`startView` for a fully-mounted, gateway-registered view. Use `_newViewStore` for lightweight
client-side state buckets.

For a full reverse-engineering of `startView`'s inner `ye(...)` call chain, see
`task-02-followups.md` Probe 4c.

---

<!-- The original "What's still unknown / TODO" section was superseded by §11
above (probe status table). All items moved into §11 Q1–Q7. -->

