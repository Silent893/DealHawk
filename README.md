# 🦅 DealHawk

Automated deal finder that watches listing sites for what you want to buy. Set up jobs to monitor any ikman.lk listing page, and DealHawk will check daily for new listings matching your criteria.

> Stop refreshing ikman.lk — let DealHawk watch for you.

## Features

- **Web Dashboard** — Create and manage watch jobs from a clean dark-themed UI
- **Smart Field Discovery** — Paste any ikman.lk URL and DealHawk auto-discovers the available fields (land size, price, car brand, engine capacity, etc.)
- **Conditional Deep-Dive** — Only visit detail pages for listings matching your rules (e.g., land >= 100 perches)
- **Customizable Logging Filters** — Mark listings that match your deal criteria (e.g., price < 500,000)
- **Image Capture** — Downloads the first image from each deep-dived listing
- **Scheduled Runs** — Per-job frequency control (6h, 12h, daily, weekly)
- **Dedup** — Never logs the same listing twice (uses URL slug as unique key)
- **PostgreSQL Storage** — All data queryable in your own database

## Quick Start

### Prerequisites

- **Node.js** 18+ 
- **PostgreSQL** 14+
- **Chromium** (installed automatically by Puppeteer on most systems)

### Setup

```bash
git clone https://github.com/YOUR_USERNAME/dealhawk.git
cd dealhawk
npm install

# Create your database
# (using psql, pgAdmin, or any method you prefer)
# CREATE DATABASE dealhawk;

# Configure environment
cp .env.example .env
# Edit .env with your database connection string

# Run migrations
npm run migrate

# Start the dashboard
npm start
```

Open **http://localhost:3000** and click **+ New Job** to get started.

### Docker (recommended for always-on servers)

```bash
cp .env.example .env
# Edit .env with your database connection string

docker compose up -d --build
```

## How It Works

1. **Create a Job** — Paste an ikman.lk listing page URL (land, cars, anything)
2. **Field Discovery** — DealHawk scans the page and shows you what data is available
3. **Set Conditions** — Define which listings deserve a deep-dive (e.g., `size >= 100 perches`)
4. **Detail Scan** — DealHawk peeks at one listing to show you all detail fields
5. **Set Filters** — Choose what makes a "good deal" for you (e.g., `price < 500,000`)
6. **Schedule & Save** — Set how often to check, and DealHawk does the rest

## Screenshots

*Coming soon — start the dashboard to see it in action!*

## Tech Stack

- **Runtime**: Node.js
- **Browser**: Puppeteer (headless Chromium)
- **Database**: PostgreSQL
- **Server**: Express.js
- **Frontend**: Vanilla HTML/CSS/JS (no framework bloat)

## CLI Usage

```bash
# Start dashboard + scheduler
npm start

# One-off run of all active jobs
npm run run

# Run database migrations
npm run migrate
```

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | *required* |
| `PORT` | Dashboard port | `3000` |
| `SCRAPE_TIMEOUT` | Page load timeout (ms) | `30000` |
| `HEADLESS` | Run browser headless | `true` |
| `IMAGES_DIR` | Directory for downloaded images | `./data/images` |

## License

MIT
