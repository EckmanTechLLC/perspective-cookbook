# Perspective Cookbook

A collection of reproducible patterns for extending Ignition Perspective using the
Markdown component's `escapeHtml: false` capability. Each recipe is a working,
self-contained example you can import and run against your own gateway.

The technique is not a hack or a workaround — Inductive Automation ships this flag
on purpose, and it has been present and unchanged across 8.1 through 8.3+. What
this cookbook demonstrates is how far that single knob reaches: third-party UI
libraries, browser-native APIs, bidirectional MobX property bindings, and direct
gateway WebSocket RPC — all from inside a Perspective view with no gateway-side
scripting required for most patterns.

---

## Status

Validated on Ignition 8.3.6. Built and tested in a Docker sandbox. No customer
code, no production gateways. All experiments run against a fresh
`inductiveautomation/ignition:8.3.6` container on a project-local bridge network.

---

## About the Code — Why `eval(atob(...))`?

If you skim the view JSONs and see `eval(atob('...'))` in the Markdown source
expressions, that pattern is the canonical malware fingerprint and the reflex
to nope out is reasonable. Here's what's actually going on:

**Every JS payload is also published in plain readable form** under
`scripts/*_payload_clean.js` (production variant) and `scripts/*_payload_debug.js`
(with `console.log` calls for tracing). The base64-encoded form in the view JSON
is the *delivery mechanism*, not the source of truth.

**Why base64 at all?** Perspective's Markdown `props.source` is a Perspective
expression string, not raw HTML. Embedding multi-line JS through that parser
means navigating three nested escape layers (expression string → HTML attribute
→ JS string literal), where every `'` has to be escaped as `\'` and newlines
get mangled. Base64-encoding the JS into a single ASCII line sidesteps the
entire escape-soup problem. It's encoding for transport, not obfuscation.

**Auditing any recipe takes one click:** open `scripts/<recipe>_payload_clean.js`,
read the JS in its original form. The encoding instructions are in
`scripts/README.md` if you want to modify a payload and re-encode.

---

## Recipes

Seven working patterns are included in this repository. Recipe docs live in
`docs/recipes/`; the corresponding view JSON and scripts are in the imported project.

1. **D3 Charts** — Embed a D3 v7 time-series chart directly in a Perspective view.
   Bidirectional binding: `view.custom.chartData` drives re-renders; click events
   write back to `view.params`.
   See `docs/recipes/d3-integration.md`.

2. **Monaco Editor** — VS Code's editor engine inside a Perspective Markdown component.
   Language/theme selectors wired to `view.params`; custom SQL linter via
   `setModelMarkers`; JSON validation built-in.
   See `docs/recipes/monaco-integration.md`.

3. **Service Worker / PWA** — Register a Service Worker from a Perspective session to
   cache HTTP assets for offline resilience. Demonstrates the scope and limits of SW
   interception when the Perspective WebSocket is involved.
   See `docs/recipes/service-worker.md`.

4. **Pyodide (CPython in Browser)** — Run a full CPython interpreter (Pyodide 0.25.0)
   inside the browser, inside a Perspective view. Install numpy and pandas at runtime;
   render results as an inline SVG chart. Full MobX round-trip for code input and
   chart output.
   See `docs/recipes/pyodide.md`.

5. **Command Palette** — A VS Code-style `Ctrl+K` command palette available on every
   page of a Perspective session. Implemented as a 0-px Docked View that installs
   once at session level. Fuzzy search over built-in commands and dynamic "Go to view"
   entries pulled from the live view registry.
   See `docs/recipes/cmd-palette.md`.

6. **Gateway RPC via WebDev** — Read tags, write tags, and run named queries from
   inside a Markdown component, using fetch() against Designer-created WebDev endpoints
   that wrap `system.tag.*` and `system.db.runNamedQuery`. Session cookie provides
   automatic same-origin auth.
   See `docs/recipes/gateway-rpc.md`.

7. **Internals Recon** — Six probe scripts that characterize `window.__client`,
   MobX property tree APIs, the gateway WebSocket wire format, and cross-version name
   stability. Results were the foundation for every other recipe in this cookbook.
   See `docs/recipes/internals-recon.md`.

---

## Quick Start

### Step 1 — Import the project

1. Start a gateway (your own, or the Docker sandbox described below).
2. Open **Designer** and log in.
3. Go to **File > Import Project**.
4. Select `ignition-project/perspective_cookbook.zip` from this repository.
5. Accept the import; the project name is `cookbook`.

### Step 2 — Create prerequisites

Two gateway-side resources are required before the Gateway RPC and Pyodide recipes
work end-to-end. Create them in Designer after importing:

- **Memory tag** — `[default]cookbook/test_value` (type: Int4, initial value: 42).
  Used by the tag-read and tag-write demos.

- **Named query** — `cookbook/test_query` in the `cookbook` project. Any simple SELECT works;
  the recipe uses `SELECT 1 AS result`. Requires a configured DB connection on the
  gateway. The other recipes (D3, Monaco, Service Worker, Pyodide, Command Palette)
  work without this.

### Step 3 — Smoke-test

Open the `Internals_Recon` view in a Perspective session. The auto-runner fires all
six probes on load. If you see a populated output panel with `window.__client` keys
listed, the injection technique is working correctly in your environment.

For the Docker sandbox: see `ignition-project/README.md` for the compose command,
port assignment, and commissioning steps.

---

## What This Is Not

- **Not a CVE writeup.** There is no vulnerability being exploited here. `escapeHtml: false`
  is a documented, intentional Markdown component property that ships in the product.
  Inductive Automation has left it open across 8.1 and 8.3+; that is an implicit
  design decision, not an oversight.

- **Not an exploit toolkit.** The recipes are positive use cases: rich UI components,
  offline capabilities, Python scripting, and gateway integration patterns that would
  otherwise require Perspective module development or custom gateway scripting.

- **Not a supported IA pattern.** Inductive Automation does not endorse or support
  this technique. It could change or be restricted in a future release. All recipes
  include upgrade-stability notes and the probe infrastructure to re-verify.

- **Not production-ready as-is.** The WebDev RPC endpoints in the imported project use
  `require-auth: false` for sandbox convenience. A production deployment needs
  `require-auth: true` and `required-roles` scoped to your operator roles.

---

## Running the Docker Sandbox

If you want a clean, throwaway gateway for experimentation:

```bash
# From the ignition-project/ directory
docker compose up -d

# Gateway is available at http://localhost:18088
# Default admin password: password
```

See `ignition-project/README.md` for the full compose setup, port allocation, and
reset procedure.

---

## Architectural Reference

`docs/PERSPECTIVE_INTERNALS.md` is the gold reference for how Perspective's client
works from the inside: the React + MobX architecture, the MobX property tree API,
all reach routes to `window.__client`, the gateway WebSocket wire format, and the
full cross-version name-stability checklist.

Read this before modifying any recipe. The glossary at the top of each recipe doc
references the relevant sections.

Supporting documents:

- `docs/protocol/perspective-ws.md` — WebSocket frame format specification and
  message type catalog (observed + inferred).
- `docs/decisions/adr-001-sandbox-safety.md` — the sandbox safety contract that
  governed this project's own development.

---

## License

MIT. See `LICENSE`.

---

## Acknowledgements

- **Inductive Automation** — for shipping a Markdown component expressive enough to
  host entire UI frameworks, and for keeping it that way across 8.1 through 8.3+.

- **The IA community forum** — for the long public record of what `escapeHtml: false`
  opens up, and for keeping the discussion alive across multiple major versions.
