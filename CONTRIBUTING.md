# Contributing to perspective-cookbook

## Scope — What PRs Are Welcome

Contributions are accepted for:

- **New recipes** that follow the established pattern: a working view JSON (committed
  inside the `ignition-project/perspective_cookbook.zip` project export), clean source
  in `scripts/<name>_source_clean.txt`, a debug variant in `scripts/<name>_source_debug.txt`,
  and a recipe doc in `docs/recipes/<name>.md`. All four pieces must land together.

- **Bug fixes** — corrected view JSON, updated base64 payloads, fixed script source.

- **IA upgrade compatibility notes** — if a new Ignition release breaks or changes
  behavior for an existing recipe, a PR with updated scripts, corrected recipe docs,
  and re-verified probe output is very welcome.

- **Probe extensions** — additions to the `Internals_Recon` view that characterize
  new APIs or verify behavior in a new IA build.

## Out of Scope

The following will not be merged:

- Anything that requires non-sandbox infrastructure (external servers, cloud APIs,
  proprietary modules) that a reader cannot reproduce with a stock `inductiveautomation/ignition`
  Docker container.

- Anything that touches or references a real customer deployment, production gateway,
  or identifiable private network.

- Content framed as an attack, exploit, or security advisory. The technique is
  documented Perspective behavior; the recipes demonstrate constructive use cases.

- Scripts or views that require gateway configuration outside of: the standard
  WebDev module, memory tags, named queries against a SQLite or H2 test database.

## Conventions

Follow these in every recipe PR:

- **Single quotes throughout JavaScript** embedded in Perspective expression strings.
  Use `\'` for single quotes nested inside those strings.
  Example: `concat('<button onclick="eval(atob(\'...\'))")'>Run</button>')`

- **Tabs for indentation** in any Jython that runs server-side inside a WebDev endpoint.
  Spaces are fine for browser-side JavaScript.

- **ASCII-only base64 payloads.** If your script contains non-ASCII characters
  (em dashes, curly quotes, arrows, etc.), replace them with `\uXXXX` escape sequences
  before base64-encoding. Non-ASCII characters survive `base64 -w 0` but are decoded
  by `atob()` as Latin-1 bytes, producing garbled DOM text.

- **`escapeHtml: false` is non-negotiable.** Every recipe depends on the Markdown
  component having `props.markdown.escapeHtml` set to `false`. Document this as a
  prerequisite in the recipe doc and verify it is set in the view JSON you submit.

- **Use `window.__client` as the reach mechanism** for 8.3.x. The fiber walk pattern
  (documented in `docs/PERSPECTIVE_INTERNALS.md` §12) is retained as a fallback for
  pre-8.3 builds and future hardening, but all new recipes should use
  `window.__client.page.views` as the primary path.

- **Use `resourcePath` for view matching**, not `mountPath`. In 8.3.6+, `mountPath`
  is an opaque short ID; `resourcePath` carries the human-readable path string.

## Testing

Every recipe must be reproducible from scratch using only the Docker sandbox:

1. `docker compose up -d` from `ignition-project/` (or your own gateway).
2. Import `perspective_cookbook.zip` via Designer (File > Import Project).
3. Create any documented prerequisites (tags, named queries, WebDev resources).
4. Open the recipe's view in a Perspective session and verify the stated behavior.

Include in your PR: the Docker Ignition version tested against, and the Chrome version
used. Recipes that require HTTPS must document the development workaround
(`chrome://flags/#unsafely-treat-insecure-origin-as-secure`) and note the flag's path.

Reference the Quick Start and import flow in the root `README.md` for the canonical
setup sequence.
