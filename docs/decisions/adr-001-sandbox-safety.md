# ADR-001 — Sandbox Safety and Manual-Step Protocol

**Date:** 2026-05-06
**Status:** Accepted

## Background

`cookbook/` runs on a shared dev server. The host runs other projects and services that must not be disturbed. Implementer (`odin-i`) sessions have no memory of prior conversations — they will only read the task file, this ADR, and `CLAUDE.md`. So the rules for what an implementer is and is not allowed to do on the host must be **explicit, short, and binding**.

This ADR codifies two contracts every implementer must honor:

1. Containment — what may run, where, and under what name
2. Manual-step handoff — what to do when a step requires the human

## Decisions

### 1. Containment — all experiments live inside Docker

- **Container names** must be prefixed `cookbook-` (e.g. `cookbook-ignition`, `cookbook-signaling`). Never remove or restart any container without that prefix.
- **Networks** — use a project-local Docker bridge network defined in the project's compose file. Do not attach to host networks or external/shared networks.
- **Volume mounts** — bind paths must live under `<repo-root>/`. Never bind-mount `/`, `/etc`, `/var`, `$HOME`, or any path outside the project tree.
- **Host ports** — IA's defaults (8088 / 8043 / 8060) are likely already in use elsewhere on this host. Pick unused ports and document them. Before `docker compose up`, run `ss -tlnp` (or `docker ps --format '{{.Ports}}'`) to confirm the chosen ports are free. Default convention: allocate from `18000–18999`.

### 2. Forbidden host actions

An implementer must NOT, under any circumstance:

- Run anything with `sudo`
- Install host packages (`apt`, `dpkg`, `snap`, `pip --user` system-wide, `npm -g`)
- Modify systemd units, `/etc/hosts`, `/etc/resolv.conf`, firewall rules, iptables, `~/.ssh/`, `~/.docker/config.json`, or any host dotfiles outside the project
- Run `docker system prune`, `docker volume prune`, `docker network prune`, or any command that could affect containers / volumes / networks not owned by this project
- Touch files outside `<repo-root>/` except read-only references explicitly listed in the task

### 3. Docker invocation policy

The user has stated they prefer to run `docker` commands themselves. So:

- Implementers may **write** `docker-compose.yml`, `Dockerfile`, scripts, and documentation
- Implementers must **not invoke** `docker compose up`, `docker run`, `docker build`, `docker exec`, or any command that starts containers or runs commands inside them
- Each task summary must end with the exact commands the user should run, in copy-pasteable form, with a short rationale per command

### 4. Manual-step handoff protocol

Many steps require the human (gateway commissioning UI, Chrome flag toggling, BLE / Serial / Camera permission prompts, HTTPS cert exceptions, hardware pairing). When an implementer encounters one:

- **Stop, do not retry, do not work around.**
- In the task summary, add a top-level section `## MANUAL STEPS REQUIRED` with each step as a numbered item containing:
  - exact command to run, or exact UI path / click sequence
  - what success looks like (URL response, container log line, screenshot description)
  - what to report back so the next implementer can continue
- Mark the task status as **`blocked-on-user`**, not `failed`

### 5. Reset must be cheap

Every sandbox component must support a clean wipe:
- One script (`docker/scripts/reset.sh`) that stops containers, removes the project volume(s), and rebuilds — touching only `cookbook-`-prefixed resources
- Documented in `docker/README.md`

## Constraints — what this ADR is NOT saying

- This is not a security review of the JS-injection technique itself. The injection is the research subject; the rules here protect the host running the research.
- This is not a production-deployment policy. Production hardening is out of scope; the goal is "safely break and rebuild a lab gateway."
- This does not forbid CDN-loaded JS inside the Perspective session — the Markdown injection by definition pulls third-party scripts. Containment applies to the **host**, not to what runs in the browser.

## Consequences

- Every task file must include a `## Sandbox Constraints` block referencing this ADR.
- `CLAUDE.md` gets a short top-level pointer so implementers see it before diving into a task.
- Slightly more friction at handoff (user runs `docker` commands manually) in exchange for predictable host state.
