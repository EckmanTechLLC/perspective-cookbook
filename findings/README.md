# Findings

Raw console captures from the six internals-recon probes run against Ignition 8.3.6
on 2026-05-07. These are the ground-truth baseline that every recipe in this cookbook
was validated against.

Use them to verify your own gateway after an IA upgrade: run the six probes from the
`Internals_Recon` view, compare your output to these captures, and look for any
`MISSING` results in Probe 6 or unexpected errors in Probes 1–5.

---

## Files

| File | Probe | What it captured |
|------|-------|-----------------|
| `recon-8.3.6-2026-05-07-probe1.txt` | Probe 1 — window.__client global scan | `window.__client` confirmed; own keys enumerated; no other `window.__*` globals |
| `recon-8.3.6-2026-05-07-probe2.txt` | Probe 2 — property tree update/operate | `params.update()` error reveals `$`-discriminator format; `operate()` is path-navigator |
| `recon-8.3.6-2026-05-07-probe3.txt` | Probe 3 — WebSocket intercept | WS URL format; `connection.send` = native; `client-activity` / `client-value-update` / `keepalive` frame types |
| `recon-8.3.6-2026-05-07-probe4.txt` | Probe 4 — _newViewStore | `page._newViewStore` works client-only; ViewStore has full property tree API |
| `recon-8.3.6-2026-05-07-probe5.txt` | Probe 5 — applyPropertyUpdates | `view.applyPropertyUpdates` source deminified; `page.applyPropertyUpdates` expects full WS envelope |
| `recon-8.3.6-2026-05-07-probe6.txt` | Probe 6 — cross-version stability | 19/19 session keys, 28/28 page keys, 21/21 view-store keys, 26/26 params methods — all present; fiber walk broken in 8.3.6 |

---

## Context

- **Ignition version:** 8.3.6
- **Capture date:** 2026-05-07
- **Environment:** Docker sandbox (`inductiveautomation/ignition:8.3.6` container)
- **Browser:** Chrome (Windows) via HTTP (not HTTPS) — Service Worker-sensitive probes need HTTPS
- **View used:** `Internals_Recon` (included in `ignition-project/perspective_cookbook.zip`)

These captures served as the foundation for building the architectural reference at
`docs/PERSPECTIVE_INTERNALS.md`. The Q1–Q7 answers in §11 of that document correspond
one-to-one with the six probe captures here.

---

## How to Compare Your Gateway

1. Import `ignition-project/perspective_cookbook.zip` in Designer.
2. Open the `Internals_Recon` view in a Perspective session.
3. Open Chrome DevTools → Console → **Preserve Log** ON.
4. Click each probe button (or let the auto-runner fire on load).
5. Compare your console output to the corresponding `probe*.txt` file here.

Key comparisons:
- Probe 1: is `window.__client EXISTS`? Are the own keys a superset of what's here?
- Probe 6: are all 94 names still `OK`? Any `MISSING` means a recipe using that name is broken.

See `docs/recipes/internals-recon.md` for the full "What you should see" and "What regressing looks like" guide.
