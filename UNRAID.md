# 🖥️ DealHawk — Unraid Deployment Guide

Step-by-step guide to deploy DealHawk on Unraid using the Docker UI.

---

## Prerequisites

- Unraid with Docker enabled
- PostgreSQL database accessible from Unraid (can be another Docker container or external)
- SSH access to Unraid terminal

---

## Step 1: Clone the Repo (Terminal)

SSH into Unraid:

```bash
cd /mnt/user/appdata
git clone https://github.com/Silent893/DealHawk.git dealhawk
```

## Step 2: Build the Docker Image (Terminal)

```bash
cd /mnt/user/appdata/dealhawk
docker build -t dealhawk .
```

This takes 2-3 minutes on first build (downloads Chromium).

## Step 3: Create Database

If you don't already have a PostgreSQL instance, skip this and use an existing one.

Using psql or pgAdmin:

```sql
CREATE DATABASE dealhawk;
```

## Step 4: Add Container (Unraid Docker UI)

Go to Unraid web UI → **Docker** tab → **Add Container**

Fill in these settings:

| Setting | Value |
|---|---|
| **Name** | `dealhawk` |
| **Repository** | `dealhawk` |
| **Network Type** | `bridge` |
| **Console shell command** | `Shell` |

### Port Mapping

Click **Add another Path, Port, Variable, Label or Device** → select **Port**

| Config Type | Value |
|---|---|
| **Name** | `WebUI` |
| **Container Port** | `3000` |
| **Host Port** | `3082` |
| **Connection Type** | `TCP` |

### Volume Mapping

Click **Add another Path, Port, Variable, Label or Device** → select **Path**

| Config Type | Value |
|---|---|
| **Name** | `Images` |
| **Container Path** | `/app/data/images` |
| **Host Path** | `/mnt/user/appdata/dealhawk/images` |
| **Access Mode** | `Read/Write` |

### Environment Variables

Add each variable by clicking **Add another Path, Port, Variable, Label or Device** → select **Variable**

| Name | Key | Value |
|---|---|---|
| Database URL | `DATABASE_URL` | `postgresql://USER:PASS@DB_IP:5432/dealhawk` |
| Headless | `HEADLESS` | `true` |
| Scrape Timeout | `SCRAPE_TIMEOUT` | `30000` |
| Request Delay | `REQUEST_DELAY` | `2000` |

> ⚠️ Replace `USER`, `PASS`, and `DB_IP` with your actual PostgreSQL credentials and IP.
> If your password has special characters, URL-encode them (e.g., `@` → `%40`).

### Apply

Click **Apply** — the container will start.

## Step 5: Verify

Open your browser: **http://YOUR_UNRAID_IP:3082**

You should see the DealHawk dashboard. Click **+ New Job** to get started!

---

## Updating DealHawk

When there's a new version:

1. **Stop** the container from Unraid Docker UI (click icon → Stop)
2. **SSH into Unraid** and run:
   ```bash
   cd /mnt/user/appdata/dealhawk
   git pull
   docker build -t dealhawk .
   ```
3. **Start** the container from Unraid Docker UI (click icon → Start)

Your data is safe — it lives in PostgreSQL, not the container.

---

## Troubleshooting

### Container won't start
- Check Docker logs: click the container icon → **Logs**
- Verify `DATABASE_URL` is correct and PostgreSQL is reachable from Unraid

### Can't connect to dashboard
- Verify port 3082 isn't used by another container
- Check Unraid firewall allows port 3082

### Scraping is slow
- Increase `SCRAPE_TIMEOUT` to `60000` (60s)
- Decrease `REQUEST_DELAY` to `1000` (1s) — but don't go too low or ikman may block you

### Images not saving
- Verify the host path `/mnt/user/appdata/dealhawk/images` exists
- Check container has write permissions
