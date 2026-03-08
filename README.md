# 🦅 DealHawk

Automated deal finder that watches ikman.lk for what you want to buy. Set up jobs to monitor any listing page — land, cars, houses, electronics — and DealHawk checks for new listings, tracks prices, and detects when items are sold.

> Stop refreshing ikman.lk — let DealHawk watch for you.

## Features

- **6-Step Job Wizard** — Paste any ikman.lk URL, DealHawk auto-discovers fields and lets you set rules
- **Multi-Page Scraping** — Configurable max pages per job, auto-detects when to go deeper
- **Price Tracking** — Full price history with chart visualization and % change badges
- **Sold Detection** — Daily re-checks mark listings as sold when removed from ikman
- **Price Rating** — Shows how each listing compares to the job average (e.g., "-12% avg")
- **Dashboard Stats** — Overview cards, search/sort, status filters, run history
- **Job Editing** — Update rules, filters, and frequency for existing jobs
- **Rate Limiting** — Configurable delay between requests to avoid being blocked
- **Browser Reuse** — Single Chrome instance per job run for speed
- **Auto-Run** — Jobs start scraping immediately after creation
- **Docker-Ready** — One command to deploy on any server

## Example ikman.lk Links

DealHawk works with any ikman.lk listing page. Here are some examples:

| Category | URL |
|---|---|
| Land in Gampaha | `https://ikman.lk/en/ads/gampaha/land-for-sale` |
| Cars (all) | `https://ikman.lk/en/ads/sri-lanka/cars` |
| BMW cars | `https://ikman.lk/en/ads/sri-lanka/cars/bmw?sort=date&order=desc` |
| Search for 420i | `https://ikman.lk/en/ads/sri-lanka/cars?query=420i` |
| Houses in Colombo | `https://ikman.lk/en/ads/colombo/house-for-sale` |
| Phones | `https://ikman.lk/en/ads/sri-lanka/mobile-phones` |

**Tips:**
- Use filtered URLs from ikman.lk to narrow results before creating a job
- Set deep-dive rules to only visit listings matching your criteria (e.g., land ≥ 50 perches)
- Set log rules for your "deal" criteria (e.g., price < 500,000)

## How It Works

1. **Create a Job** — Paste an ikman.lk listing page URL
2. **Field Discovery** — DealHawk scans the page and shows available fields
3. **Set Deep-Dive Rules** — Which listings to visit in detail (e.g., `size >= 100 perches`)
4. **Detail Scan** — DealHawk checks one listing to discover all detail fields
5. **Set Log Filters** — What counts as a "match" (e.g., `price < 500,000`)
6. **Save & Auto-Run** — Sets frequency, max pages, and starts scanning immediately

Each subsequent run:
- Discovers new listings on page 1 (and page 2+ if new listings are found)
- Re-checks all active listings for price changes and sold status
- Records full price history for charting

---

## Deployment

### Prerequisites

- **PostgreSQL 14+** — DealHawk needs a database. You can run your own or use an existing one.
- Create a database: `CREATE DATABASE dealhawk;`

### 🐳 Docker (Recommended)

Works on **Unraid, Linux, Windows (WSL), macOS** — anywhere Docker runs.

```bash
git clone https://github.com/Silent893/DealHawk.git
cd DealHawk

# Configure
cp .env.example .env
nano .env  # Set your DATABASE_URL

# Start
docker compose up -d --build
```

Dashboard at **http://localhost:3082**

---

### 🖥️ Unraid

#### Option A: Docker Compose (via terminal)

```bash
# SSH into Unraid
cd /mnt/user/appdata
git clone https://github.com/Silent893/DealHawk.git dealhawk
cd dealhawk

cp .env.example .env
nano .env
# Set: DATABASE_URL=postgresql://user:pass@YOUR_DB_IP:5432/dealhawk

docker compose up -d --build
```

#### Option B: Unraid Docker UI

1. **Build the image** (SSH terminal):
   ```bash
   cd /mnt/user/appdata/dealhawk
   docker build -t dealhawk .
   ```

2. **Add Container** in Unraid Docker tab:

   | Setting | Value |
   |---|---|
   | Name | `dealhawk` |
   | Repository | `dealhawk` (local) |
   | Network | bridge |
   | Port | Host: `3082` → Container: `3000` |
   | Path | Host: `/mnt/user/appdata/dealhawk/images` → Container: `/app/data/images` |
   | Variable: `DATABASE_URL` | `postgresql://user:pass@YOUR_DB_IP:5432/dealhawk` |
   | Variable: `HEADLESS` | `true` |
   | Variable: `SCRAPE_TIMEOUT` | `30000` |
   | Variable: `REQUEST_DELAY` | `2000` |

Dashboard at **http://YOUR_UNRAID_IP:3082**

---

### 🪟 Windows

#### Option A: Docker Desktop

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/)
2. Open PowerShell:
   ```powershell
   git clone https://github.com/Silent893/DealHawk.git
   cd DealHawk
   copy .env.example .env
   # Edit .env with notepad
   docker compose up -d --build
   ```

#### Option B: Native Node.js

1. Install [Node.js 18+](https://nodejs.org/) and [PostgreSQL](https://www.postgresql.org/download/windows/)
2. Open PowerShell:
   ```powershell
   git clone https://github.com/Silent893/DealHawk.git
   cd DealHawk
   npm install
   copy .env.example .env
   # Edit .env — set DATABASE_URL
   npm start
   ```

Dashboard at **http://localhost:3000**

---

### 🐧 Linux

#### Option A: Docker

```bash
git clone https://github.com/Silent893/DealHawk.git
cd DealHawk
cp .env.example .env
nano .env  # Set DATABASE_URL
docker compose up -d --build
```

#### Option B: Native Node.js

```bash
# Install Node.js 18+ and PostgreSQL
sudo apt update && sudo apt install -y nodejs npm postgresql

# Clone and setup
git clone https://github.com/Silent893/DealHawk.git
cd DealHawk
npm install
cp .env.example .env
nano .env  # Set DATABASE_URL

# Create database
sudo -u postgres createdb dealhawk

# Start (use pm2 or systemd for always-on)
npm start

# Optional: run with pm2 for auto-restart
npm install -g pm2
pm2 start src/index.js -- serve
pm2 save
pm2 startup
```

---

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | *required* |
| `PORT` | Dashboard port (inside container) | `3000` |
| `SCRAPE_TIMEOUT` | Page load timeout (ms) | `30000` |
| `HEADLESS` | Run browser headless | `true` |
| `REQUEST_DELAY` | Delay between requests (ms) | `2000` |
| `IMAGES_DIR` | Image storage directory | `./data/images` |

## CLI Usage

```bash
npm start          # Dashboard + scheduler
npm run run        # One-off run of all active jobs
npm run migrate    # Run database migrations only
```

## Tech Stack

- **Runtime**: Node.js
- **Browser**: Puppeteer (headless Chromium)
- **Database**: PostgreSQL
- **Server**: Express.js
- **Frontend**: Vanilla HTML/CSS/JS (no framework bloat)

## License

MIT
