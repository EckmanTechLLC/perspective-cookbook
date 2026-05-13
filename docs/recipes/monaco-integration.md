# Recipe: Monaco Editor in a Perspective View

**Version:** 0.45.0 (CDN)  
**Ignition target:** 8.3.x  
**Status:** delivered — verified in the `Monaco_Demo` view

---

## What this gives you

Microsoft's Monaco editor (VS Code's engine) embedded inside a Perspective Markdown component:

- Syntax highlighting for SQL, JSON, Python, Jinja2, and plain text
- IntelliSense / autocomplete (language-dependent)
- Multi-cursor, find/replace, code folding
- Error squiggles: JSON parse errors are automatic; custom validators via `monaco.editor.setModelMarkers`
- Bidirectional binding: editor text ↔ `view.custom.code` (MobX-backed, gateway-synced)
- Language and theme switchable via HTML `<select>` controls wired to `view.params`

---

## Quick-start: deploy the demo view

The `Monaco_Demo` view is included in `ignition-project/perspective_cookbook.zip`.
Import the project in Designer to get the pre-built view, then open:

```
http://<your-gateway-host>:18088/data/perspective/client/cookbook/Monaco_Demo
```

The demo view sets:

| Property | Initial value | Role |
|---|---|---|
| `custom.code` | sample Ignition Historian SQL | editor content |
| `params.language` | `"sql"` | active language; synced with HTML select |
| `params.theme` | `"vs-dark"` | active theme; synced with HTML select |

---

## How it works

### Three-layer stack

```
Perspective view (MobX)
  └─ view.custom.code   ◄──── write (editor → Perspective)
  └─ view.params.language ◄── write (select → Perspective)
  └─ view.params.theme  ◄──── write (select → Perspective)
       ↕  subscribe
  Monaco JS layer (in Markdown component)
  └─ monaco.editor.create('#monaco-container', ...)
  └─ onDidChangeModelContent  → v.custom.write('code', ...)
  └─ v.custom.subscribe       → editor.setValue(ext)
  └─ v.params.subscribe       → setModelLanguage / setTheme
```

### Injection mechanism

The Markdown component's `props.source` is bound to an `expr` expression:

```
concat(
  '<div ...outer wrapper...>',
  '<div ...controls bar...>',
    '...language <select id="monaco-lang-select">...',
    '...theme <select id="monaco-theme-select">...',
  '</div>',
  '<div id="monaco-container" style="flex:1;overflow:hidden">...',
  '<img src="data:image/gif;base64,R0lGO..." style="display:none"
       onload="eval(atob(\'BASE64_PAYLOAD\'))">',
  '</div>'
)
```

The `img onload` fires once per DOM insertion and bootstraps Monaco from CDN.
The `\'` around `BASE64_PAYLOAD` escapes single quotes inside the Perspective expression string — see `docs/PERSPECTIVE_INTERNALS.md` §13.

### Reach path

Route 0 (`window.__client`, canonical in 8.3.x):

```javascript
var views = Array.from(window.__client.page.views.values());
var v = views.find(function (x) { return x.resourcePath === 'cookbook/Monaco_Demo'; }) || views[0];
```

See `docs/PERSPECTIVE_INTERNALS.md` §4 for all reach routes.

---

## Bidirectional binding details

### Editor → Perspective

```javascript
editor.onDidChangeModelContent(function () {
  v.custom.write('code', editor.getValue());
});
```

Every keystroke writes to `view.custom.code`. MobX propagates this to all bound consumers (scripts, labels, other views with tag bindings to the same custom prop).

### Perspective → Editor

```javascript
v.custom.subscribe(function () {
  var ext = v.custom.read('code');
  if (typeof ext === 'string' && editor.getValue() !== ext) {
    editor.setValue(ext);
  }
});
```

When anything else writes to `custom.code` (tag binding, another session, Console paste), the editor updates. The `editor.getValue() !== ext` guard prevents feedback loops: when the editor itself triggers the write, the subscribe callback sees the same value and does nothing.

### Language / theme params → editor

```javascript
v.params.subscribe(function () {
  var lang = v.params.read('language') || 'sql';
  var theme = v.params.read('theme') || 'vs-dark';
  // ...
  monaco.editor.setModelLanguage(model, monacoLangFor(lang));
  monaco.editor.setTheme(theme);
});
```

When `view.params.language` or `view.params.theme` changes (from the HTML selects or any external writer), the editor immediately switches language and theme without a full re-render.

---

## Custom validator: SQL linter

The demo includes a SQL linter that flags `SELECT *` with a yellow warning squiggle:

```javascript
function lintSQL(model) {
  var markers = [];
  model.getValue().split('\n').forEach(function (line, i) {
    if (/SELECT\s+\*/i.test(line)) {
      var col = line.search(/\*/i) + 1;
      markers.push({
        severity: monaco.MarkerSeverity.Warning,
        message: 'Avoid SELECT * — list column names explicitly',
        startLineNumber: i + 1, startColumn: col,
        endLineNumber: i + 1, endColumn: col + 1
      });
    }
  });
  monaco.editor.setModelMarkers(model, 'monaco-demo-linter', markers);
}
```

This pattern extends to any rule: SQL injection patterns, missing WHERE clauses, deprecated syntax, etc.

**JSON validation is automatic.** When `params.language = 'json'`, Monaco's built-in JSON schema validator shows red squiggles on malformed JSON — no custom code needed.

---

## Language mapping

| `params.language` value | Monaco language ID | Notes |
|---|---|---|
| `sql` | `sql` | Full SQL syntax + custom linter |
| `json` | `json` | Built-in JSON schema validation (red squiggles) |
| `python` | `python` | Syntax highlighting + basic autocomplete |
| `jinja2` | `twig` | Closest Monaco equivalent; `{{ }}` template syntax |
| `plaintext` | `plaintext` | No highlighting |

Monaco 0.45.0 does not include a native `jinja2` language. `twig` (PHP template engine, also `{{ }}` + `{% %}` block syntax) gives the closest highlighting. For production Jinja2 editing, consider a custom Monaco language definition (see [Monaco language contributions](https://github.com/microsoft/monaco-editor/blob/main/docs/integrate-esm.md)).

---

## Theme reference

| `params.theme` value | Appearance |
|---|---|
| `vs-dark` | Dark (VS Code default dark) |
| `vs` | Light (VS Code default light) |
| `hc-black` | High contrast black |

Custom themes can be registered with `monaco.editor.defineTheme(name, themeData)` before `monaco.editor.create()`. See the [Monaco theming docs](https://microsoft.github.io/monaco-editor/docs.html#functions/editor.defineTheme.html).

---

## Wiring `custom.code` to gateway data

The demo bakes a static SQL string into `view.custom.code`. In production, wire `custom.code` to a live source:

### Option A: Tag binding

In Designer, add a binding on `custom.code` to a String tag path (e.g. `[default]Queries/ActiveQuery`). Any tag write immediately updates the editor.

### Option B: Named query result

In Designer, add an expression binding on `custom.code`:
```
runNamedQuery("getActiveQuery", {})
```
This requires a `getActiveQuery` named query that returns a single string result.

### Option C: WebDev endpoint

Fetch from a WebDev-served JSON file:
```javascript
// In the Monaco bootstrap JS, after initEditor():
fetch('/system/webdev/cookbook/getCode').then(r => r.json()).then(function(obj) {
  v.custom.write('code', obj.code);
});
```

### Option D: Write-back on Confirm

To save edits back to the gateway, add a button in the Markdown HTML:

```html
<button onclick="
  var v = Array.from(window.__client.page.views.values())[0];
  var code = v.custom.read('code');
  fetch('/system/webdev/cookbook/saveCode', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({code: code})
  }).then(function(r) { console.log('saved', r.status); });
">Save to Gateway</button>
```

---

## CDN load latency

Monaco is ~3 MB from CDN. First load takes 1–3 s on a typical office connection. Subsequent page opens in the same tab are instant (browser cache).

For air-gapped environments, serve Monaco assets from Ignition's WebDev module:

1. Download the Monaco `min/vs` directory from the npm package
2. Upload to WebDev as static files under `/system/webdev/cookbook/monaco/vs/`
3. Change `CDN_BASE` in the payload JS to `/system/webdev/cookbook/monaco/vs`
4. Re-encode the payload to base64 and redeploy

---

## Regenerating the base64 payload

After editing `scripts/monaco_payload_clean.js`:

```bash
base64 -w 0 scripts/monaco_payload_clean.js > /tmp/clean_b64.txt
# Then update scripts/monaco_source.txt with the new base64 and
# paste the updated expression into Designer's Markdown component binding
```

---

## Anti-patterns to avoid

| Don't | Do instead |
|---|---|
| Write to `component.props.write('source', ...)` | Write to `view.custom.write('code', ...)` — component props don't propagate |
| Re-init Monaco on every `img onload` | Guard with `v.__monacoEditorInited` — the `img onload` fires on every re-render |
| `JSON.stringify` on the view store | Circular refs in MobX stores will throw — don't stringify store objects |
| Hard-code the `mountPath` | Use `resourcePath` for matching — `mountPath` is opaque in 8.3.6+ |
| `meta.visible: false` on any component | Use `position.basis: 0` + `style.overflow: hidden` — `visible: false` unmounts from React tree |

---

## Files

| File | Purpose |
|---|---|
| `ignition-project/perspective_cookbook.zip` | Import in Designer to get the `Monaco_Demo` view |
| `scripts/monaco_payload_clean.js` | Readable production JS (re-encode after edits) |
| `scripts/monaco_payload_debug.js` | Readable debug JS (with `[MonacoDemo]` console logs) |
| `scripts/monaco_source.txt` | Production `props.source` expression (paste into Designer) |
| `scripts/monaco_source_debug.txt` | Debug `props.source` expression |

## See also

- `docs/PERSPECTIVE_INTERNALS.md §4` — all reach routes to `window.__client`
- `docs/PERSPECTIVE_INTERNALS.md §3` — property tree write API
- `docs/PERSPECTIVE_INTERNALS.md §13` — `eval(atob(...))` escape rules
