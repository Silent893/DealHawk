const express = require('express');
const path = require('path');
const db = require('./db');
const config = require('./config');
const { migrate } = require('./migrate');
const { scanListPage, scanDetailPage, closeBrowser } = require('./scanner');
const { runJob } = require('./runner');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Serve downloaded images
const IMAGES_DIR = config.imagesDir || path.join(__dirname, '..', 'data', 'images');
app.use('/api/images', express.static(IMAGES_DIR));

// ─── Dashboard stats ────────────────────────────────────────────

app.get('/api/stats', async (req, res) => {
    try {
        const result = await db.query(`
          SELECT
            (SELECT COUNT(*) FROM listings) AS total_listings,
            (SELECT COUNT(*) FROM listings WHERE status = 'active') AS active_listings,
            (SELECT COUNT(*) FROM listings WHERE status = 'sold') AS sold_listings,
            (SELECT COUNT(*) FROM listings WHERE matched_log = true) AS matched_listings,
            (SELECT COUNT(*) FROM jobs WHERE active = true) AS active_jobs,
            (SELECT COUNT(DISTINCT ph.listing_id) FROM price_history ph
              JOIN price_history ph2 ON ph.listing_id = ph2.listing_id AND ph2.id != ph.id
              WHERE ph.recorded_at > NOW() - INTERVAL '24 hours'
              AND ph.price_value < ph2.price_value
              AND ph2.recorded_at < ph.recorded_at
            ) AS price_drops_24h
        `);
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Scan endpoints (for wizard) ────────────────────────────────

app.post('/api/scan/list', async (req, res) => {
    const { url } = req.body;
    if (!url || !url.includes('ikman.lk')) {
        return res.status(400).json({ error: 'Please provide a valid ikman.lk URL' });
    }
    try {
        const result = await scanListPage(url);
        await closeBrowser();
        res.json(result);
    } catch (err) {
        await closeBrowser();
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/scan/detail', async (req, res) => {
    const { url } = req.body;
    if (!url || !url.includes('ikman.lk')) {
        return res.status(400).json({ error: 'Please provide a valid ikman.lk ad URL' });
    }
    try {
        const result = await scanDetailPage(url);
        await closeBrowser();
        res.json(result);
    } catch (err) {
        await closeBrowser();
        res.status(500).json({ error: err.message });
    }
});

// ─── Job CRUD ───────────────────────────────────────────────────

app.get('/api/jobs', async (req, res) => {
    try {
        const result = await db.query(`
      SELECT j.*,
        (SELECT COUNT(*) FROM listings WHERE job_id = j.id) AS listing_count,
        (SELECT COUNT(*) FROM listings WHERE job_id = j.id AND matched_log = true) AS matched_count,
        (SELECT COUNT(*) FROM listings WHERE job_id = j.id AND status = 'active') AS active_count,
        (SELECT COUNT(*) FROM listings WHERE job_id = j.id AND status = 'sold') AS sold_count
      FROM jobs j ORDER BY j.id DESC
    `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/jobs', async (req, res) => {
    const { name, url, category, card_fields, detail_fields, deep_dive_rules, log_rules, frequency_hours, max_pages } = req.body;
    if (!name || !url) {
        return res.status(400).json({ error: 'Name and URL are required' });
    }
    try {
        const result = await db.query(
            `INSERT INTO jobs (name, url, category, card_fields, detail_fields, deep_dive_rules, log_rules, frequency_hours, max_pages)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
            [name, url, category || null,
                JSON.stringify(card_fields || []),
                JSON.stringify(detail_fields || []),
                JSON.stringify(deep_dive_rules || []),
                JSON.stringify(log_rules || []),
                frequency_hours || 24,
                max_pages || 2]
        );
        const job = result.rows[0];
        res.json(job);

        // Auto-trigger first run in background
        console.log(`[Auto-Run] Triggering first run for "${job.name}"...`);
        runJob(job).catch(err => console.error(`[Auto-Run] Error: ${err.message}`));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/jobs/:id', async (req, res) => {
    const { id } = req.params;
    const { name, url, category, deep_dive_rules, log_rules, frequency_hours, active } = req.body;
    try {
        const result = await db.query(
            `UPDATE jobs SET
         name = COALESCE($1, name),
         url = COALESCE($2, url),
         category = COALESCE($3, category),
         deep_dive_rules = COALESCE($4, deep_dive_rules),
         log_rules = COALESCE($5, log_rules),
         frequency_hours = COALESCE($6, frequency_hours),
         active = COALESCE($7, active)
       WHERE id = $8 RETURNING *`,
            [name, url, category,
                deep_dive_rules ? JSON.stringify(deep_dive_rules) : null,
                log_rules ? JSON.stringify(log_rules) : null,
                frequency_hours, active, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Job not found' });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/jobs/:id', async (req, res) => {
    try {
        const result = await db.query('DELETE FROM jobs WHERE id = $1 RETURNING name', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Job not found' });
        res.json({ message: `Deleted: ${result.rows[0].name}` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Job run ────────────────────────────────────────────────────

app.post('/api/jobs/:id/run', async (req, res) => {
    try {
        const jobResult = await db.query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
        if (jobResult.rows.length === 0) return res.status(404).json({ error: 'Job not found' });
        // Run in background, respond immediately
        res.json({ message: 'Job started', job_id: req.params.id });
        runJob(jobResult.rows[0]).catch(err => console.error(`Job ${req.params.id} error:`, err.message));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Listings ───────────────────────────────────────────────────

app.get('/api/listings', async (req, res) => {
    const { job_id, matched_only, status, search, sort, limit = 50, offset = 0 } = req.query;
    try {
        let where = [];
        let params = [];
        let idx = 1;

        if (job_id) { where.push(`job_id = $${idx++}`); params.push(job_id); }
        if (matched_only === 'true') { where.push(`matched_log = true`); }
        if (status) { where.push(`l.status = $${idx++}`); params.push(status); }
        if (search) { where.push(`l.title ILIKE $${idx++}`); params.push(`%${search}%`); }

        const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

        const sortMap = {
            newest: 'l.first_seen_at DESC',
            oldest: 'l.first_seen_at ASC',
            price_low: 'l.price_value ASC NULLS LAST',
            price_high: 'l.price_value DESC NULLS LAST',
        };
        const orderBy = sortMap[sort] || sortMap.newest;

        const result = await db.query(
            `SELECT l.*, j.name as job_name,
              (SELECT ph.price_value FROM price_history ph
               WHERE ph.listing_id = l.id ORDER BY ph.recorded_at DESC LIMIT 1 OFFSET 1) AS prev_price,
              (SELECT AVG(l2.price_value) FROM listings l2
               WHERE l2.job_id = l.job_id AND l2.price_value IS NOT NULL AND l2.status = 'active') AS job_avg_price
             FROM listings l
             LEFT JOIN jobs j ON l.job_id = j.id
             ${whereClause}
             ORDER BY ${orderBy}
             LIMIT $${idx++} OFFSET $${idx}`,
            [...params, limit, offset]
        );

        const countResult = await db.query(
            `SELECT COUNT(*) FROM listings l ${whereClause}`, params
        );

        res.json({ listings: result.rows, total: parseInt(countResult.rows[0].count) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Job Analytics ─────────────────────────────────────────────

app.get('/api/jobs/:id/analytics', async (req, res) => {
    try {
        const result = await db.query(`
          SELECT
            COUNT(*) FILTER (WHERE status = 'active') AS active_count,
            COUNT(*) FILTER (WHERE status = 'sold') AS sold_count,
            COUNT(*) FILTER (WHERE matched_log = true) AS matched_count,
            ROUND(AVG(price_value) FILTER (WHERE price_value IS NOT NULL AND status = 'active')) AS avg_price,
            MIN(price_value) FILTER (WHERE price_value IS NOT NULL AND status = 'active') AS min_price,
            MAX(price_value) FILTER (WHERE price_value IS NOT NULL AND status = 'active') AS max_price,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price_value)
              FILTER (WHERE price_value IS NOT NULL AND status = 'active') AS median_price
          FROM listings WHERE job_id = $1
        `, [req.params.id]);
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Scrape runs ────────────────────────────────────────────────

app.get('/api/runs', async (req, res) => {
    const { job_id, limit = 20 } = req.query;
    try {
        let where = job_id ? 'WHERE r.job_id = $1' : '';
        let params = job_id ? [job_id, limit] : [limit];
        const result = await db.query(
            `SELECT r.*, j.name as job_name FROM scrape_runs r
       LEFT JOIN jobs j ON r.job_id = j.id
       ${where}
       ORDER BY r.started_at DESC LIMIT $${job_id ? 2 : 1}`,
            params
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Price history ──────────────────────────────────────────────

app.get('/api/listings/:id/prices', async (req, res) => {
    try {
        const result = await db.query(
            `SELECT price_value, price_type, price_text, recorded_at
             FROM price_history
             WHERE listing_id = $1
             ORDER BY recorded_at ASC`,
            [req.params.id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Start server ───────────────────────────────────────────────

async function start() {
    await migrate();
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`\n🚀 Dashboard running at http://localhost:${PORT}`);
    });
}

module.exports = { app, start };

if (require.main === module) {
    start().catch(err => {
        console.error('Failed to start:', err);
        process.exit(1);
    });
}
