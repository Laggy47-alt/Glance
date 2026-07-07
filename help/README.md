# Glance — Help & Documentation

All operator docs for the self-hosted Glance app, its backend, and the
on-site bridges live here.

| File | What it covers |
| --- | --- |
| [SELF_HOSTING.md](./SELF_HOSTING.md) | High-level overview of self-hosting Glance (frontend + Supabase). |
| [SELF_HOSTED_DOCKER_GUIDE.md](./SELF_HOSTED_DOCKER_GUIDE.md) | Step-by-step Docker workflow: applying migrations, deploying edge functions, copying files into the `db` / `edge-runtime` containers. |
| [DB_DUMP.md](./DB_DUMP.md) | Reference dump of the database schema (tables, columns, policies). |
| [HIKVISION_SETUP.md](./HIKVISION_SETUP.md) | Adding a Hikvision NVR via ISAPI, registering the HTTP alarm listener, troubleshooting "Pending first contact". |
| [UNIFI_BRIDGE.md](./UNIFI_BRIDGE.md) | Installing the UniFi Protect bridge on an on-site machine: creating the ENVR in Glance, copying the slug + secret, running the systemd service. |
| [UNIFI_BRIDGE_MACHINE.md](./UNIFI_BRIDGE_MACHINE.md) | Deep reference for the on-site bridge box: what is installed where, the full data flow, every config file, and a numbered debug playbook. |
| [MUDSLIDE_LISTENER.md](./MUDSLIDE_LISTENER.md) | Self-hosted WhatsApp (Mudslide) listener: install, pair, send test message, daily report delivery. |
| [MAINTENANCE.md](./MAINTENANCE.md) | Routine frontend + backend maintenance runbook: builds, migrations, edge deploy, VACUUM, backups, WhatsApp health, rollback. |

## Quick map of moving parts

```
                 ┌─────────────────────────────────────────────┐
                 │  Glance frontend (React)                    │
                 │  served by nginx on the app server          │
                 └───────────────┬─────────────────────────────┘
                                 │ HTTPS
                 ┌───────────────▼─────────────────────────────┐
                 │  Self-hosted Supabase (Docker)              │
                 │   - Postgres (db container)                 │
                 │   - Edge functions (edge-runtime container) │
                 │   - Storage (camera-snapshots, backups, …)  │
                 └─▲────────────▲────────────▲─────────────────┘
                   │            │            │
        ingest POST│            │ingest POST │ingest POST
                   │            │            │
       ┌───────────┴──┐  ┌──────┴──────┐  ┌──┴─────────────┐
       │ Hikvision    │  │ UniFi       │  │ Mudslide       │
       │ NVR (ISAPI + │  │ Protect     │  │ WhatsApp       │
       │ HTTP alarm)  │  │ bridge box  │  │ listener box   │
       └──────────────┘  └─────────────┘  └────────────────┘
```

Start with `SELF_HOSTING.md` for the big picture, then jump to the file
that matches whatever you are installing or debugging.
