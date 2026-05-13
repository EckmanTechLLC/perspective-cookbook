# Recipe: Pyodide — Python in Browser, Inside Perspective

**Verified against:** Ignition 8.3.6, Pyodide 0.25.0, Chrome 124+  
**Status:** Delivered. Demonstrated with numpy + pandas. Main-thread only (no Web Worker).  
**See also:** `scripts/pyodide_payload_clean.js`, `scripts/pyodide_source.txt`

The `Pyodide_Demo` view is included in `ignition-project/perspective_cookbook.zip` — import
the project in Designer to get the pre-built view.

---

## What This Enables

A full CPython interpreter (Pyodide = WebAssembly port) running in the browser tab, with:

- `numpy`, `pandas`, `scipy`, `matplotlib`, `scikit-learn`, and 100+ packages from the scientific Python stack
- stdout capture → Perspective `view.custom.output`
- Return values (list-of-dicts → `toJs()`) → Perspective `view.custom.chartData` → chart
- Bidirectional bridge: Perspective writes code → Python runs → result written back to Perspective

No gateway round-trip. No Jython. All computation client-side.

---

## Core Pattern

```javascript
// 1. Load Pyodide (10-30 MB on first open; cached by browser after)
window.pyodide = await loadPyodide();
await pyodide.loadPackage(['numpy', 'pandas']);

// 2. Capture stdout
pyodide.runPython(
  'import io as _io, sys as _sys\n' +
  '_old_stdout = _sys.stdout\n' +
  '_sys.stdout = _io.StringIO()'
);

// 3. Run arbitrary Python (async to avoid blocking UI)
var result = await pyodide.runPythonAsync(code);

// 4. Get captured stdout
var stdout = pyodide.runPython(
  '_out = _sys.stdout.getvalue()\n' +
  '_sys.stdout = _old_stdout\n' +
  '_out'
);

// 5. Convert Pyodide proxy to JS value
var jsResult = result && result.toJs
  ? result.toJs({ dict_converter: Object.fromEntries })
  : result;
if (result && result.destroy) { result.destroy(); }  // free memory

// 6. Write back to Perspective
view.custom.write('output', stdout);
view.custom.write('chartData', jsResult);  // if array-of-dicts
```

---

## CDN URL

```
https://cdn.jsdelivr.net/pyodide/v0.25.0/full/pyodide.js
```

This is the "full" distribution (~10 MB JS + additional wasm). The `loadPyodide()` function is
exported globally after the script loads.

For the "minimal" distribution (smaller, fewer preloaded packages):
```
https://cdn.jsdelivr.net/pyodide/v0.25.0/min/pyodide.js
```

---

## Injection Pattern (Markdown component)

Same as all cookbook patterns: base64-encode the JS payload, fire from `<img onload>`.

```
// Perspective expression:
concat(
  '<div id="pyodide-status">Loading...</div>',
  '<textarea id="pyodide-code"></textarea>',
  '<button id="pyodide-run-btn" onclick="if(window.__pyodideRun)window.__pyodideRun()">Run</button>',
  '<pre id="pyodide-output"></pre>',
  '<div id="pyodide-chart"></div>',
  '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" style="display:none"',
  ' onload="eval(atob(\'BASE64_OF_PAYLOAD\'))">'
)
```

To regenerate the base64 from the payload JS file:
```bash
base64 -w 0 scripts/pyodide_payload_clean.js
```

Paste the output as `BASE64_OF_PAYLOAD` in the expression. The `\'` around the base64 escapes
the single-quote delimiter inside the Perspective expression string (see INTERNALS §13).

**CRITICAL:** Keep the JS payload ASCII-only (no UTF-8 characters above 0x7F). Use `\uXXXX`
JS escape sequences for any non-ASCII text you need. The `atob()` → `eval()` pipeline passes
decoded bytes directly to the JS engine; UTF-8 multi-byte sequences become garbage in string
values.

---

## Reaching the View Store

Use Route 0 (canonical for 8.3.x):

```javascript
var VIEW_PATH = 'cookbook/Pyodide_Demo';
var views = Array.from(window.__client.page.views.values());
var v = views.find(function (x) { return x.resourcePath === VIEW_PATH; }) || views[0];
```

See `docs/PERSPECTIVE_INTERNALS.md` §4 for the full reach pattern.

---

## view.custom Properties Used

| Key | Type | Description |
|---|---|---|
| `code` | string | Python source baked into view; syncs with textarea |
| `pyodideReady` | bool | `false` while loading, `true` once numpy+pandas loaded |
| `output` | string | stdout + result written after each `Run` |
| `chartData` | array | List-of-dicts returned from Python; drives SVG chart |
| `result` | any | Scalar/string result when return value is not array-of-dicts |

---

## Data Exchange

### Perspective → Python

```javascript
// In JS: pass data from Perspective to Python global namespace
pyodide.globals.set('input_data', v.custom.read('inputData'));
// In Python:
// result = [x * 2 for x in input_data.to_py()]
```

### Python → Perspective (list of dicts)

```python
# Python code returns list-of-dicts
import pandas as pd
df = pd.DataFrame({'x': range(10), 'y': range(0, 20, 2)})
df.to_dict('records')   # <- this value is the return value
```

```javascript
// In JS after runPythonAsync:
var jsResult = result.toJs({ dict_converter: Object.fromEntries });
// jsResult is now a plain JS array of plain objects
result.destroy();  // free Pyodide proxy
v.custom.write('chartData', jsResult);
```

### Python → Perspective (scalar)

```python
# Python: just return a scalar
42
# or
"hello from Python"
```

```javascript
// In JS:
var jsResult = result;  // primitives don't need toJs()
v.custom.write('result', jsResult);
```

### Passing large arrays efficiently

```javascript
// JS -> Python: convert JS array to Python list
pyodide.globals.set('js_array', pyodide.toPy([1, 2, 3, 4, 5]));

// Python:
// data = list(js_array)  # or use directly in numpy: np.array(js_array)
```

---

## Loading Additional Packages

After `await pyodide.loadPackage(['numpy', 'pandas'])`, you can load more at runtime:

```javascript
await pyodide.loadPackage(['scipy', 'scikit-learn']);
```

Or from Python inside a `runPythonAsync`:

```python
import micropip
await micropip.install('some-pure-python-package')
import some_pure_python_package
```

Note: packages with C extensions must be built for Pyodide specifically. The full package list is
at https://pyodide.org/en/stable/usage/packages-in-pyodide.html

---

## Sample Script (baked into view.custom.code)

```python
import numpy as np
import pandas as pd

# Synthetic sensor readings (20 points)
rng = np.random.default_rng(42)
n = 20
df = pd.DataFrame({
    'x': np.arange(n),
    'y': (rng.standard_normal(n).cumsum() * 8 + 50).round(2)
})

# Rolling mean smoothing (3-period)
df['rolling'] = df['y'].rolling(3, min_periods=1).mean().round(2)

print(f"Shape: {df.shape}")
print(df.to_string(index=False))

# Return list-of-dicts -> toJs() -> chart
df[['x', 'y', 'rolling']].to_dict('records')
```

When Run is clicked, this produces:
- stdout: DataFrame shape + table printed to the output panel
- result: 20-row list → chart update (teal = y, orange dashed = rolling avg)

---

## Performance Notes

- **First load:** ~10–30 MB download (Pyodide runtime + packages). Expect 30–60 s on a
  fast network; longer on slow ones. Pyodide is cached by the browser after first load.
- **Subsequent page opens** (same browser session): `window.pyodide` is already set. The
  `initPyodide()` function detects this and sets status to "Ready" immediately.
- **Main-thread execution:** `runPythonAsync` is technically async but still runs on the main
  thread via Pyodide's internal scheduler. Long-running Python (>0.5 s) will freeze the UI.
  For heavy workloads, move to a Web Worker'd Pyodide (see upgrade path below).

---

## Upgrade Path

### Monaco editor for code input

Wire `view.custom.code` to the Monaco editor from `docs/recipes/monaco-integration.md`. Set Monaco language to `python`.
The textarea in this demo would be replaced by the Monaco Markdown component. Both views can
coexist in a tabbed layout.

### Web Worker'd Pyodide (UI stays responsive)

```javascript
// In a Web Worker script (served via WebDev):
importScripts('https://cdn.jsdelivr.net/pyodide/v0.25.0/full/pyodide.js');
// ... same loadPyodide / loadPackage / runPythonAsync pattern
// communicate via postMessage / onmessage

// Main thread:
var worker = new Worker('/system/webdev/cookbook/pyodide_worker');
worker.postMessage({ code: pythonCode, inputData: data });
worker.onmessage = function (e) {
  v.custom.write('chartData', e.data.result);
};
```

### Offline / airgap Pyodide

1. Download the Pyodide distribution tarball from the GitHub releases.
2. Host it via a WebDev resource (see `docs/recipes/service-worker.md` for
   the WebDev resource creation workflow).
3. Change `PYODIDE_CDN` to point at `/system/webdev/cookbook/pyodide/pyodide.js`.

Note: the Pyodide tarball is ~50 MB. Ignition's content-addressable store will hold it, but
WebDev resources cannot be created by file copy — they must be created through Designer.

---

## Known Limitations

- **atob() is byte-transparent, not UTF-8 aware.** If your JS payload contains non-ASCII
  characters (e.g. Unicode symbols in string literals), they will be decoded as Latin-1 bytes
  by `atob()` and display as garbled text in the DOM. Workaround: use JS `\uXXXX` escape
  sequences throughout the payload (they are ASCII and interpreted by the JS engine as Unicode).
- **No DOM manipulation from Python.** Pyodide can call JS via `from js import document`,
  but this runs synchronously on the main thread and can conflict with Perspective's React
  render cycle. Prefer the write-to-custom / subscribe pattern for UI updates.
- **Perspective WebSocket is NOT interceptable.** Pyodide runs client-side; gateway tag
  reads/writes still go through `connection.send` (see `docs/PERSPECTIVE_INTERNALS.md §14`). Pyodide can compute
  a result and then JS writes it to a tag via the WS bridge — that's the correct pattern.

## See also

- `docs/PERSPECTIVE_INTERNALS.md §4` — all reach routes to `window.__client`
- `docs/PERSPECTIVE_INTERNALS.md §13` — `eval(atob(...))` escape rules
- `docs/PERSPECTIVE_INTERNALS.md §14` — WebSocket wire format
- `docs/recipes/monaco-integration.md` — integrate Monaco as the code editor
- `docs/recipes/service-worker.md` — WebDev resource creation workflow
