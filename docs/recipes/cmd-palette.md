# Recipe: Global Command Palette

**Status:** complete  
**Depends on:** `docs/PERSPECTIVE_INTERNALS.md` §4 (Route 0), §13 (eval/atob delivery)

## What It Is

A VS Code-style command palette (Ctrl+K / Ctrl+Shift+P) that overlays any Perspective session.
Type to fuzzy-search a list of actions; select to execute.

The palette is delivered as a **Docked View** — Perspective mounts it once at session start,
on every page. The keyboard listener registers on `document` (capture phase), so it intercepts
the shortcut before Perspective's own key handlers.

## Files

| File | Purpose |
|------|---------|
| `ignition-project/perspective_cookbook.zip` | Import in Designer to get the `CommandPalette` view |
| `scripts/cmd_palette_source.txt` | Raw Perspective expression (`concat(...)`) for the binding |
| `scripts/cmd_palette_payload.js` | Readable JS source — re-encode after edits: `base64 -w0 cmd_palette_payload.js` |

## Architecture

```
Docked View (CommandPalette) mounts once per session
  └─ Markdown component (escapeHtml:false, position basis:0px)
       └─ <img onload="eval(atob('...'))">   ← fires once on mount
            └─ JS IIFE:
                 ├─ window.__cmdPaletteInited guard (no double-registration)
                 ├─ document.addEventListener('keydown', ..., true)   ← capture phase
                 ├─ window.__cmdPalette = {open, close, addCommand}
                 └─ REGISTRY = [...static commands...]

Ctrl+K / Ctrl+Shift+P
  └─ openPalette()
       ├─ buildTheme()      ← reads body background color
       ├─ buildCommands()   ← REGISTRY + one dynamic "Go to view" per open view
       └─ DOM overlay appended to document.body (z-index 9999)
            ├─ backdrop click → closePalette()
            ├─ input[type=text]  ← autofocused, fuzzyFilter on input
            ├─ ArrowUp/Down → navigate list
            ├─ Enter        → runCmd() → closePalette + cmd.action()
            └─ Escape       → closePalette()
```

## Built-In Commands (10)

| Command | Description | Status |
|---------|-------------|--------|
| Dump page.views to Console | Lists all open views (mountPath + resourcePath) | ✅ working |
| Toggle Theme (Dark / Light) | Tries `sessionProps.write('theme', ...)`, falls back to CSS class | ✅ working |
| Log Out | Calls `auth.logout()` or navigates to `/data/perspective/logout/<project>` | ✅ working |
| Reload Session | `window.location.reload()` | ✅ working |
| Read Tag... | Stub — logs a warning (wire to Gateway RPC library — see `docs/recipes/gateway-rpc.md`) | ⏳ stub |
| Set Tag... | Stub — logs a warning | ⏳ stub |
| Run Named Query... | Stub — logs a warning | ⏳ stub |
| Go to view: `<resourcePath>` | One per open view, dynamic | ✅ working |

## Deployment — One-Time Setup

### Step 1: Import the project and get the view

Import `ignition-project/perspective_cookbook.zip` in Designer. The `CommandPalette` view is
included. Verify it appears in the Views tree.

> **Rebuild from source (optional):** If you need to redeploy a modified `CommandPalette` view
> after editing the payload:
>
> 1. Re-encode the JS:
>    ```bash
>    base64 -w 0 scripts/cmd_palette_payload.js > /tmp/new_b64.txt
>    ```
> 2. Update `scripts/cmd_palette_source.txt` with the new base64 and paste it into the
>    Markdown component's `props.source` binding in Designer.
> 3. Save All.

### Step 2: Install as a Docked View (one-time, in Designer)

1. Open Designer → `cookbook` project.
2. **Project → Project Properties → Perspective → Session Props → Docked Views** tab.
   - (Or: right-click the project in the Designer Project Browser → Properties.)
3. Click **+ Add Docked View**.
4. Set:
   - **View:** `CommandPalette`
   - **Dock position:** `Top` (or any edge — the view is 0px tall so it's invisible)
   - **Size:** `0` (or `1` if 0 causes issues)
   - **Interact:** unchecked (it takes no user interaction itself)
5. Save and commit the project.

After this one-time configuration, the palette is available on **every page** of the session
without any further setup.

### Step 3: Verify

Open a Perspective session in Chrome. Press **Ctrl+K**.

**Success:** A dark (or light, matching your system theme) modal slides in at the top-center
of the page. Typing `go` shows "Go to view: ..." entries for each open view. Arrow keys
navigate, Enter selects, Escape closes.

Check Chrome console for: `[CmdPalette] v1.0 registered -- Ctrl+K or Ctrl+Shift+P to open`

## Adding Custom Commands

Append to `REGISTRY` in `scripts/cmd_palette_payload.js`:

```javascript
var REGISTRY = [
  // ... existing commands ...
  {
    id: 'my-custom-cmd',
    label: 'My Custom Command',
    description: 'Does something useful',
    action: function () {
      // Any JS -- full window.__client access available
      var views = Array.from(window.__client.page.views.values());
      console.log('Custom command ran on', views.length, 'views');
    }
  }
];
```

Then re-encode and redeploy:

```bash
# 1. Re-encode
base64 -w 0 scripts/cmd_palette_payload.js > /tmp/new_b64.txt

# 2. Rebuild source.txt and paste into Designer
python3 -c "
import base64, json

b64 = open('scripts/cmd_palette_payload.js','rb').read()
b64s = base64.b64encode(b64).decode('ascii')
gif = 'R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='

expr = (
    \"concat(\n\"
    \"  '<div id=\\\"cmd-palette-host\\\" style=\\\"display:none\\\">CmdPalette v1.0</div>',\n\"
    \"  '<img src=\\\"data:image/gif;base64,\" + gif + \"\\\" style=\\\"display:none\\\"\"
    \" onload=\\\"eval(atob(\\\\'\" + b64s + \"\\\\'))\\\">'>)\"
)
print(expr[:120], '...')
open('scripts/cmd_palette_source.txt', 'w').write(expr)
"

# 3. In Designer: update the Markdown component's props.source binding
#    with the new content from scripts/cmd_palette_source.txt, then Save All.
```

### Runtime injection (no redeploy needed)

If the palette is already running, inject a command without redeploying:

```javascript
// In Chrome DevTools Console:
window.__cmdPalette.addCommand({
  id: 'alert-test',
  label: 'Show Alert',
  description: 'Test command injected at runtime',
  action: function () { alert('Hello from runtime injection!'); }
});
```

Commands added via `addCommand` persist until page reload.

## Fuzzy Search Mechanics

Hand-rolled — no external library. Scoring:

1. Exact substring match in **label** → score = character index of match start (0 = match at start = best)
2. Exact substring match in **description** → score = index + 10000 (always ranked below label matches)
3. No match → excluded from results

All comparisons are case-insensitive. Results sorted ascending by score.

**Example:** Query `"go"` matches:
- `Go to view: CommandPalette` (label index=0, score=0) → first
- `Go to view: D3_Demo` (label index=0, score=0) → tied → stable order
- `Log Out` (description contains "log", which doesn't contain "go") → excluded
- `Toggle Theme` (label index=1, `to**go**gle`? No — "go" not in "Toggle") → excluded

## Theme Detection

The palette reads `getComputedStyle(document.body).backgroundColor` and computes luminance
(Rec.601: `0.299R + 0.587G + 0.114B < 128` → dark). Falls back to
`prefers-color-scheme: dark` media query if background is not an `rgb(...)` color.

## Navigation Mechanism

For "Go to view" commands:

```javascript
// Primary: React Router history (works without full reload)
window.__client.history.push(
  '/data/perspective/client/' + window.__client.projectName + '/' + resourcePath
);

// Fallback: URL navigation (causes page reload)
window.location.href = '/data/perspective/client/' + projectName + '/' + resourcePath;
```

The `resourcePath` is read from `view.resourcePath` (NOT `mountPath` — which is an opaque
short ID in 8.3.6+). See `docs/PERSPECTIVE_INTERNALS.md` §5 and §10.

## Wiring the Tag Stubs to Gateway RPC

Three commands log a warning by default. After installing the Gateway RPC library
(see `docs/recipes/gateway-rpc.md`), replace their stub `action` functions in `REGISTRY`:

```javascript
action: function () {
  if (!window.__gw) { showToast('Visit Gateway_RPC_Demo first to install gw library'); return; }
  window.__gw.readTag('[default]cookbook/test_value').then(function (r) {
    showToast('Tag value: ' + r.value);
  }).catch(function (e) { showToast('Read failed: ' + e.message); });
}
```

## Escape Pattern Reference

Per `docs/PERSPECTIVE_INTERNALS.md` §13, the `eval(atob(...))` delivery pattern:

```
Perspective expression (concat string):
  '...<img ... onload="eval(atob(\'BASE64_HERE\'))">'
                                   ^^            ^^
                                   \' escapes the ' string delimiter
                                   in Perspective expression strings

In JSON (expression field value):
  "...<img ... onload=\"eval(atob(\\'BASE64_HERE\\'))\">"
  \\' = JSON \\ (backslash) + ' (literal apostrophe) → produces \' in the expression
```

## Gotchas

- **Re-registration guard:** `window.__cmdPaletteInited` prevents stacking multiple listeners
  if the docked view unmounts and remounts (Perspective may cycle it on navigation).
- **ASCII-only payload:** the JS source must contain only bytes 0–127. `atob()` decodes
  base64 as Latin-1, not UTF-8 — non-ASCII bytes produce garbled strings. Use `\uXXXX`
  JS escape notation for any non-ASCII characters in string values.
- **Position `basis: 0px`:** the Markdown component takes no layout space while still being
  mounted in the React tree. `meta.visible: false` would unmount it entirely (breaking onload).
- **`document.body` target for overlay:** the overlay div is appended to `document.body`, not
  inside the Perspective view's DOM subtree, so it truly overlays all Perspective components
  regardless of z-index stacking within Perspective.
- **Ctrl+K in Chrome:** Chrome uses Ctrl+K for the address bar. The palette listener uses
  `capture: true` and calls `e.preventDefault()` + `e.stopPropagation()` so it wins.
  If Chrome still captures it, focus a non-URL-bar element first (click anywhere in the
  Perspective session content area).

## See also

- `docs/PERSPECTIVE_INTERNALS.md §4` — all reach routes to `window.__client`
- `docs/PERSPECTIVE_INTERNALS.md §5` — `mountPath` vs `resourcePath`
- `docs/PERSPECTIVE_INTERNALS.md §13` — `eval(atob(...))` escape rules
- `docs/recipes/gateway-rpc.md` — wiring the tag read/write stubs
