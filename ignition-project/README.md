# Ignition Project — perspective_cookbook.zip

This directory contains `perspective_cookbook.zip`, a Designer project export of
the `cookbook` project built during the cookbook's development against Ignition 8.3.6.
Importing it gives you all seven recipe views, the supporting WebDev endpoints,
and the Internals_Recon probe suite — ready to run against any compatible gateway.

---

## How to Import

1. Start your Ignition gateway (your own, or the Docker sandbox).
2. Open **Designer** and log in.
3. Go to **File > Import Project** (or **File > Open > Import** depending on your
   Designer version).
4. Select `perspective_cookbook.zip`.
5. Choose a project name (default is `cookbook`; keep it to match the WebDev endpoint
   paths used in the recipes).
6. Click **Import**. Designer will scaffold all views, WebDev resources, and project
   properties from the zip.
7. Save the project and close Designer before doing any `docker cp` operations.

---

## Prerequisites

The imported project assumes the following are configured on your gateway:

- **Memory tag** — `[default]cookbook/test_value` (type: Int4, initial value: 42).
  Required by the Gateway RPC recipe's tag-read and tag-write demos. Create in the
  Tag Browser under the `[default]` provider.

- **Named query** — `cookbook/test_query` in the `cookbook` project. Used by the Gateway RPC
  recipe. Requires a configured DB connection. The simplest version is `SELECT 1 AS result`.
  If no DB is available, the other six recipes work without it.

- **WebDev module** — must be enabled on the gateway. The project registers three
  WebDev endpoints (`tag_read`, `tag_write`, `named_query_run`) that the Gateway RPC
  recipe uses. Check **Config > Modules** in the gateway web UI.

---

## Docker Sandbox

A minimal `docker-compose.yml` for a throwaway gateway:

```yaml
services:
  ignition:
    image: inductiveautomation/ignition:8.3.6
    container_name: cookbook-ignition
    ports:
      - "18088:8088"
      - "18043:8043"
    volumes:
      - cookbook-gateway-data:/usr/local/bin/ignition/data
    environment:
      GATEWAY_ADMIN_PASSWORD: password
    networks:
      - cookbook-net

networks:
  cookbook-net:
    driver: bridge

volumes:
  cookbook-gateway-data:
```

```bash
docker compose up -d
# Gateway at http://localhost:18088 (admin / password)
# First launch: complete the commissioning wizard before importing the project.
```

See the root `README.md` quick start for the full import and smoke-test sequence.
