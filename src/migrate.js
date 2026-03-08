const db = require('./db');

const MIGRATIONS = [
  {
    name: 'create_jobs',
    sql: `
      CREATE TABLE IF NOT EXISTS jobs (
        id              SERIAL PRIMARY KEY,
        name            VARCHAR(255) NOT NULL,
        url             TEXT NOT NULL,
        category        VARCHAR(50),
        card_fields     JSONB,
        detail_fields   JSONB,
        deep_dive_rules JSONB,
        log_rules       JSONB,
        frequency_hours INT DEFAULT 24,
        last_run_at     TIMESTAMPTZ,
        active          BOOLEAN DEFAULT true,
        created_at      TIMESTAMPTZ DEFAULT NOW()
      );
    `,
  },
  {
    name: 'create_listings',
    sql: `
      CREATE TABLE IF NOT EXISTS listings (
        id              SERIAL PRIMARY KEY,
        job_id          INT REFERENCES jobs(id) ON DELETE CASCADE,
        slug            VARCHAR(500) UNIQUE NOT NULL,
        title           TEXT,
        price           TEXT,
        price_value     NUMERIC,
        price_type      VARCHAR(20),
        size_text       TEXT,
        size_perches    NUMERIC,
        location        TEXT,
        url             TEXT,
        is_member       BOOLEAN DEFAULT false,
        posted_text     TEXT,
        first_seen_at   TIMESTAMPTZ DEFAULT NOW(),
        detail_scraped  BOOLEAN DEFAULT false,
        description     TEXT,
        phone           VARCHAR(50),
        seller_name     TEXT,
        detail_fields   JSONB,
        image_urls      JSONB,
        image_path      TEXT,
        matched_log     BOOLEAN DEFAULT false
      );
    `,
  },
  {
    name: 'create_scrape_runs',
    sql: `
      CREATE TABLE IF NOT EXISTS scrape_runs (
        id             SERIAL PRIMARY KEY,
        job_id         INT REFERENCES jobs(id) ON DELETE CASCADE,
        started_at     TIMESTAMPTZ DEFAULT NOW(),
        finished_at    TIMESTAMPTZ,
        listings_found INT DEFAULT 0,
        new_listings   INT DEFAULT 0,
        deep_dived     INT DEFAULT 0,
        rechecked      INT DEFAULT 0,
        price_changes  INT DEFAULT 0,
        sold_detected  INT DEFAULT 0,
        error          TEXT
      );
    `,
  },
  {
    name: 'create_price_history',
    sql: `
      CREATE TABLE IF NOT EXISTS price_history (
        id          SERIAL PRIMARY KEY,
        listing_id  INT REFERENCES listings(id) ON DELETE CASCADE,
        price_value NUMERIC,
        price_type  VARCHAR(20),
        price_text  TEXT,
        recorded_at TIMESTAMPTZ DEFAULT NOW()
      );
    `,
  },
  {
    name: 'add_listing_status_columns',
    sql: `
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='listings' AND column_name='status') THEN
          ALTER TABLE listings ADD COLUMN status VARCHAR(20) DEFAULT 'active';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='listings' AND column_name='last_seen_at') THEN
          ALTER TABLE listings ADD COLUMN last_seen_at TIMESTAMPTZ DEFAULT NOW();
        END IF;
      END $$;
    `,
  },
  {
    name: 'add_max_pages',
    sql: `
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='jobs' AND column_name='max_pages') THEN
          ALTER TABLE jobs ADD COLUMN max_pages INT DEFAULT 2;
        END IF;
      END $$;
    `,
  },
  {
    name: 'add_analytics_columns',
    sql: `
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='listings' AND column_name='posted_at') THEN
          ALTER TABLE listings ADD COLUMN posted_at TIMESTAMPTZ;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='listings' AND column_name='sold_at') THEN
          ALTER TABLE listings ADD COLUMN sold_at TIMESTAMPTZ;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='listings' AND column_name='sub_location') THEN
          ALTER TABLE listings ADD COLUMN sub_location TEXT;
        END IF;
      END $$;
    `,
  },
  {
    name: 'add_land_mode',
    sql: `
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='jobs' AND column_name='is_land_mode') THEN
          ALTER TABLE jobs ADD COLUMN is_land_mode BOOLEAN DEFAULT false;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='listings' AND column_name='price_per_perch') THEN
          ALTER TABLE listings ADD COLUMN price_per_perch NUMERIC;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='listings' AND column_name='total_price') THEN
          ALTER TABLE listings ADD COLUMN total_price NUMERIC;
        END IF;
      END $$;

      -- Backfill existing listings
      UPDATE listings SET
        price_per_perch = CASE
          WHEN price_type = 'per_perch' THEN price_value
          WHEN price_type = 'total' AND size_perches > 0 THEN ROUND(price_value / size_perches)
          ELSE NULL END,
        total_price = CASE
          WHEN price_type = 'total' THEN price_value
          WHEN price_type = 'per_perch' AND size_perches > 0 THEN ROUND(price_value * size_perches)
          ELSE price_value END
      WHERE price_value IS NOT NULL AND price_per_perch IS NULL;
    `,
  },
];

async function migrate() {
  console.log('[Migrate] Running migrations...');
  for (const m of MIGRATIONS) {
    try {
      await db.query(m.sql);
      console.log(`  ✓ ${m.name}`);
    } catch (err) {
      console.error(`  ✗ ${m.name}: ${err.message}`);
      throw err;
    }
  }
  console.log('[Migrate] Done.');
}

if (require.main === module) {
  migrate()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { migrate };
