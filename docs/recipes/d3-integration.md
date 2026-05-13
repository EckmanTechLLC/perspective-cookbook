# Recipe: D3 Charts in a Perspective View

**Status:** Working pattern — verified architecture against Ignition 8.3.6  
**Date:** 2026-05-09

---

## What this achieves

A D3.js visualization embedded directly inside a Perspective Markdown component, with:
- Data flowing **in** from `view.custom.chartData` (re-renders on change via MobX `subscribe`)
- Interaction flowing **out** via `view.params.write('selectedRunUid', uid)` on dot click

No gateway historian required for first delivery — a 50-point synthetic dataset is baked into
`view.custom.chartData`. See [Swapping to real tag history](#swapping-to-real-tag-history) below.

---

## How it works — the three-part pattern

### 1. HTML scaffold (in the Markdown expression)

```
concat(
  '<div style="...wrapper...">',
  '<div id="d3-chart" style="flex:1;min-height:360px;background:#0d1117;..."></div>',
  '<div id="d3-selected" ...>Click a data point to select</div>',
  '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=="
       style="display:none"
       onload="eval(atob(\'BASE64_OF_YOUR_JS\'))">',
  '</div>'
)
```

- `escapeHtml: false` on the Markdown component lets HTML through.
- The `<img>` `onload` is the injection entry point — fires once per DOM insertion.
- The base64 payload avoids all quoting issues (only `A-Za-z0-9+/=` characters).
- The `\'` around the base64 inside `eval(atob(\'...\'))` escape the JS single-quote string
  delimiter **within** the Perspective expression string (see
  `docs/PERSPECTIVE_INTERNALS.md §13`).

### 2. D3 loading (inside the base64 payload)

```javascript
(function () {
  function run() { /* reach view store, render, subscribe */ }

  if (typeof d3 !== 'undefined') {
    run();  // D3 already loaded (re-render path)
  } else {
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/d3@7';
    s.onload = run;
    document.head.appendChild(s);
  }
})();
```

- `<script src="...">` tags injected via innerHTML are NOT executed — always load D3 via
  `document.createElement('script')` appended to `document.head`.
- The `typeof d3 !== 'undefined'` guard makes re-render safe (on second `img onload` fire, D3
  is already present and we skip the script injection).

### 3. Bidirectional data flow

**Perspective → D3 (data in):**

```javascript
var views = Array.from(window.__client.page.views.values());
var v = views.find(function(x) { return x.resourcePath === 'cookbook/D3_Demo'; }) || views[0];

// Initial render
renderChart(v.custom.read('chartData'), v);

// Re-render on data changes
if (!v.__d3SubInited) {
  v.__d3SubInited = true;  // prevent stacking duplicate listeners
  v.custom.subscribe(function () {
    renderChart(v.custom.read('chartData'), v);
  });
}
```

- Use `window.__client` (canonical in 8.3.x — see `PERSPECTIVE_INTERNALS.md §4 Route 0`).
- Use `resourcePath` to find the view — `mountPath` is an opaque short ID in 8.3.6+.
- `v.__d3SubInited` is a plain JS property on the view-store object (non-observed by MobX)
  that prevents stacking multiple `subscribe` listeners when the `img onload` re-fires.

**D3 → Perspective (selection out):**

```javascript
.on('click', function (event, d) {
  v.params.write('selectedRunUid', d.uid);
  // ... visual feedback
});
```

- `view.params.write(key, value)` is the canonical write that triggers MobX reactions,
  propertyChange scripts, and gateway sync. See `PERSPECTIVE_INTERNALS.md §3`.

---

## Data format

`view.custom.chartData` is an array of objects:

```json
[
  { "ts": 1743465600000, "value": 44.71, "uid": "run-001" },
  { "ts": 1743469200000, "value": 52.36, "uid": "run-002" },
  ...
]
```

| Field | Type | Description |
|-------|------|-------------|
| `ts` | number | Unix milliseconds — fed to `new Date(d.ts)` for D3 time scale |
| `value` | number | Y-axis value |
| `uid` | string | Unique identifier written to `params.selectedRunUid` on click |

---

## Deploying the view

The `D3_Demo` view is included in `ignition-project/perspective_cookbook.zip`. Import the project
in Designer to get the pre-built view. To open it in a browser session:

```
http://<your-gateway-host>:18088/data/perspective/client/cookbook/D3_Demo
```

To rebuild the view from source (or update the base64 payload after editing the JS):

```bash
# 1. Encode the updated payload
base64 -w 0 scripts/d3_chart_payload_clean.js > /tmp/d3_b64.txt

# 2. Update the Markdown component's props.source expression in Designer
#    with the new base64 string, then Save All.
```

> **Note (internal-dev reference):** The original development workflow used `docker cp` to push
> view JSON directly into the container and then restarted the gateway. For standard use, the
> Designer import flow is preferred — import `ignition-project/perspective_cookbook.zip` and
> open the `D3_Demo` view.

---

## Verifying the success criteria

Open Chrome DevTools (F12) before loading — keep **Preserve Log** ON.

### Chart renders initial data

The 50-point synthetic time-series should appear immediately after D3 loads (~1–2 s).

### Subscribe re-renders on data change

Paste into Chrome Console (NOT DevTools Sources — the Console tab):

```javascript
var v = window.__client.page.views.values().next().value;
// Replace the dataset with 10 random points
var newData = Array.from({length: 10}, function(_, i) {
  return {
    ts: Date.now() - (9 - i) * 3600000,
    value: 20 + Math.random() * 60,
    uid: 'live-' + String(i + 1).padStart(3, '0')
  };
});
v.custom.write('chartData', newData);
```

The chart should re-render with the new 10-point dataset without a page reload.

### Click writes to params

Click any dot in the chart, then check:

```javascript
window.__client.page.views.values().next().value.params.read('selectedRunUid')
// → 'run-042' (or whichever dot was clicked)
```

The `d3-selected` label in the view should also update.

### Survives session reload

Refresh the browser tab. The chart re-renders from the initial `view.custom.chartData` value
baked into the view JSON. No console errors.

---

## Swapping to real tag history

When a Perspective Tag History binding is available, swap the static `custom.chartData` for a
live binding in Designer.

**Option A — Perspective Tag History binding on `view.custom.chartData`:**

1. In Designer, select the D3_Demo view.
2. Select the `chartData` custom property.
3. Add a **Tag History** binding targeting your historian tag.
4. Set result columns to `t_stamp` (→ `ts` in milliseconds) and `value` (→ `value`).
5. Add a **Script Transform** to reshape the rows into `[{ts, value, uid}]` objects.

The `v.custom.subscribe` listener fires on every historian poll — the chart re-renders
automatically.

**Option B — Named Query binding on `view.custom.chartData`:**

Same flow but use a Named Query that returns rows with `ts` (bigint milliseconds) and `value`
columns. The Script Transform maps rows to `{ts, value, uid}`.

**Option C — Script writing to `view.custom.chartData` from a gateway timer:**

```python
# In a Gateway Timer script (Jython):
import system
# Fetch tag history
end   = system.date.now()
start = system.date.addHours(end, -48)
results = system.tag.queryTagHistory(
    paths=['[default]MyTag/ProcessValue'],
    startDate=start, endDate=end,
    returnSize=200
)
rows = results.getUnderlyingDataset()
data = []
for i in range(rows.getRowCount()):
    data.append({
        'ts': int(system.date.toMillis(rows.getValueAt(i, 't_stamp'))),
        'value': float(rows.getValueAt(i, 'v')),
        'uid': 'row-' + str(i)
    })

# Write to the session's view custom property
# (requires locating the session — use system.perspective.getSessionInfo)
```

---

## Extending the chart type

The `renderChart` function in `scripts/d3_chart_payload_clean.js` is a standard D3 time-series
line + dot chart. To swap it for another chart type:

- **Bar chart:** replace `d3.line()` path with `svg.selectAll('.bar').data(data).enter().append('rect')`.
- **Scatter plot:** keep the dots, remove the line path.
- **Multi-series:** pass a map of `{series: string, points: [{ts, value}][]}` in `chartData`,
  iterate over series, use `d3.scaleOrdinal` for colors.
- **Sankey / treemap:** swap `renderChart` body entirely — the data-flow mechanism (custom.subscribe,
  params.write) is independent of chart type.

---

## Gotchas

| Symptom | Cause | Fix |
|---------|-------|-----|
| Blank chart, no error | `escapeHtml: false` not set | In Designer: Markdown component → `props.markdown.escapeHtml = false` |
| `D3 load failed` message | CDN blocked by network policy | Self-host d3.min.js as a Perspective WebDev resource and change `s.src` to the local URL |
| `v.custom.read('chartData')` returns `undefined` | `chartData` not in view custom | Check `view.custom` in Designer — it must have a `chartData` property defined |
| Chart renders but doesn't update on data change | `subscribe` stacked multiple times | The `v.__d3SubInited` guard should prevent this; check if the view store object is the same instance across calls |
| `window.__client` is `undefined` | Older Ignition build (< 8.3.x) | Fall back to fiber walk (see `PERSPECTIVE_INTERNALS.md §12`) |
| Clicks don't register | D3 `.on('click')` conflict | Ensure no `pointer-events: none` CSS on parent elements |

---

## File inventory

| File | Purpose |
|------|---------|
| `ignition-project/perspective_cookbook.zip` | Import in Designer to get the `D3_Demo` view |
| `scripts/d3_chart_source.txt` | Production `props.source` expression (paste into Designer binding) |
| `scripts/d3_chart_source_debug.txt` | Debug expression — adds on-screen log panel + verbose console output |
| `scripts/d3_chart_payload_clean.js` | Readable source of the production JS (re-encode after edits: `base64 -w0 d3_chart_payload_clean.js`) |
| `scripts/d3_chart_payload_debug.js` | Readable source of the debug JS |

## See also

- `docs/PERSPECTIVE_INTERNALS.md §4` — all reach routes to `window.__client`
- `docs/PERSPECTIVE_INTERNALS.md §3` — property tree write API
- `docs/PERSPECTIVE_INTERNALS.md §13` — `eval(atob(...))` escape rules
