# Scripts

Source files for every recipe in this cookbook. There are three file variants per recipe:

| Variant | Naming | Purpose |
|---------|--------|---------|
| `_source.txt` | e.g. `d3_chart_source.txt` | Full Perspective expression (`concat(...)`) — paste into the Markdown component's `props.source` binding in Designer. Contains the base64-encoded payload already embedded. |
| `_source_debug.txt` | e.g. `d3_chart_source_debug.txt` | Same expression format, but the base64 encodes the debug payload variant (includes `console.log` calls and on-screen output panels). Use this for initial validation and re-probing after an IA upgrade. |
| `_payload_clean.js` | e.g. `d3_chart_payload_clean.js` | Human-readable JS source for the production payload — the code that is base64-encoded into `_source.txt`. Edit this, then re-encode: `base64 -w 0 <file>.js` and paste the result into the `props.source` expression. |
| `_payload_debug.js` | e.g. `d3_chart_payload_debug.js` | Human-readable JS source for the debug payload. |

---

## Recipe → Script File Mapping

### D3 Charts (`docs/recipes/d3-integration.md`)

| File | Role |
|------|------|
| `d3_chart_source.txt` | Perspective expression — paste into Markdown `props.source` binding |
| `d3_chart_source_debug.txt` | Debug expression with console output + on-screen log panel |
| `d3_chart_payload_clean.js` | Readable production JS (re-encode after edits) |
| `d3_chart_payload_debug.js` | Readable debug JS |

### Monaco Editor (`docs/recipes/monaco-integration.md`)

| File | Role |
|------|------|
| `monaco_source.txt` | Perspective expression — paste into Markdown `props.source` binding |
| `monaco_source_debug.txt` | Debug expression |
| `monaco_payload_clean.js` | Readable production JS |
| `monaco_payload_debug.js` | Readable debug JS with `[MonacoDemo]` console prefixes |

### Service Worker / PWA (`docs/recipes/service-worker.md`)

| File | Role |
|------|------|
| `sw_register_source.txt` | Perspective expression — the SW registration + online/offline wiring |
| `sw_worker.js` | The service worker itself — embed in the WebDev `sw_handler` doGet body |

### Pyodide (`docs/recipes/pyodide.md`)

| File | Role |
|------|------|
| `pyodide_source.txt` | Perspective expression — paste into Markdown `props.source` binding |
| `pyodide_source_debug.txt` | Debug expression with status and verbose logging |
| `pyodide_payload_clean.js` | Readable production JS |
| `pyodide_payload_debug.js` | Readable debug JS |

### Command Palette (`docs/recipes/cmd-palette.md`)

| File | Role |
|------|------|
| `cmd_palette_source.txt` | Perspective expression — paste into Markdown `props.source` binding |
| `cmd_palette_payload.js` | Readable JS — contains the full REGISTRY, fuzzy-filter, and DOM overlay |

### Gateway RPC (`docs/recipes/gateway-rpc.md`)

| File | Role |
|------|------|
| `gateway_rpc.js` | The full RPC library — `window.__gw` with `readTag`, `writeTag`, `runNamedQuery`, WS hooks |

### Internals Recon (`docs/recipes/internals-recon.md`)

These are Perspective expressions (include the outer `concat(...)` call). Paste directly
into a Markdown component's `props.source` binding.

| File | Probe question |
|------|----------------|
| `recon_01_window_client.txt` | Does `window.__client` exist? What are its own keys? |
| `recon_02_property_tree_update.txt` | What does `params.update()` / `params.operate()` accept? |
| `recon_03_connection_send.txt` | WS intercept — URL format, `connection.send`, live frame capture |
| `recon_04_new_view_store.txt` | Does `page._newViewStore` work client-only? |
| `recon_05_apply_property_updates.txt` | Payload shape for `view.applyPropertyUpdates` |
| `recon_06_cross_version.txt` | 94-name stability checklist — session/page/view/params |

### Color Picker (origin pattern, no dedicated recipe in v1)

| File | Role |
|------|------|
| `color_picker_markdown_source.txt` | Debug expression for the original color picker proof-of-concept |
| `color_picker_markdown_source_clean.txt` | Production expression (minimal logging) |

The color picker was the origin pattern that demonstrated the `view.params.write` technique.
It is not a full recipe in v1 of this cookbook, but the source files ship here as a reference
for the pattern described in the README acknowledgements.

---

## Regenerating Payloads

After editing a `_payload_clean.js` file:

```bash
# 1. Encode
base64 -w 0 scripts/<name>_payload_clean.js > /tmp/new_b64.txt

# 2. Rebuild the expression
#    Replace the base64 string between eval(atob('...' in the _source.txt file
#    with the new encoded string, keeping the outer concat() and \'...\' wrapping.

# 3. In Designer: update the Markdown component's props.source binding,
#    then Save All.
```

See `docs/PERSPECTIVE_INTERNALS.md §13` for the full escape rules for embedding base64
inside Perspective expression strings.
