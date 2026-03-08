const db = require('./db');
const config = require('./config');
const { scrapeListings, getBrowser } = require('./scraper');
const { scrapeDetail, matchesRules, checkListing } = require('./detail-scraper');

const delay = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Parse ikman posted date text like "08 Mar 7:42 am" into a Date.
 */
function parsePostedDate(text) {
    if (!text) return null;
    try {
        const months = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
        // Format: "08 Mar 7:42 am" or "08 Mar 2025 7:42 am"
        const match = text.match(/(\d{1,2})\s+(\w{3})(?:\s+(\d{4}))?\s+(\d{1,2}):(\d{2})\s*(am|pm)/i);
        if (!match) return null;
        const [, day, mon, year, hour, min, ampm] = match;
        const d = new Date();
        d.setFullYear(year ? parseInt(year) : d.getFullYear());
        d.setMonth(months[mon] ?? 0);
        d.setDate(parseInt(day));
        let h = parseInt(hour);
        if (ampm.toLowerCase() === 'pm' && h !== 12) h += 12;
        if (ampm.toLowerCase() === 'am' && h === 12) h = 0;
        d.setHours(h, parseInt(min), 0, 0);
        return d;
    } catch { return null; }
}

/**
 * Run a single job:
 *   Phase 1 — Scrape list page(s) for NEW listings
 *   Phase 2 — Re-check all active listings (price tracking + sold detection)
 *
 * Uses a single shared browser for the entire job run.
 */
async function runJob(job) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[${job.name}] Starting scrape...`);
    console.log(`  URL: ${job.url}`);

    const runResult = await db.query(
        'INSERT INTO scrape_runs (job_id) VALUES ($1) RETURNING id',
        [job.id]
    );
    const runId = runResult.rows[0].id;

    let listingsFound = 0;
    let newListings = 0;
    let deepDived = 0;
    let rechecked = 0;
    let priceChanges = 0;
    let soldDetected = 0;

    // Launch ONE browser for the entire job
    const browser = await getBrowser();

    try {
        // Get known slugs for multi-page detection
        const knownResult = await db.query(
            'SELECT slug, status FROM listings WHERE job_id = $1',
            [job.id]
        );
        const knownSlugs = new Set(knownResult.rows.map(r => r.slug));
        const excludedSlugs = new Set(knownResult.rows.filter(r => r.status === 'excluded').map(r => r.slug));

        // ── Phase 1: Discover new listings (with multi-page) ────
        // Support multiple URLs (newline-separated)
        const urls = job.url.split('\n').map(u => u.trim()).filter(u => u.startsWith('http'));
        let listings = [];
        for (const url of urls) {
            if (urls.length > 1) console.log(`  [URL ${urls.indexOf(url) + 1}/${urls.length}] ${url}`);
            const results = await scrapeListings(url, knownSlugs, browser, job.max_pages || 2);
            listings = listings.concat(results);
        }
        // Deduplicate by slug (in case same listing appears in multiple URLs)
        const seen = new Set();
        listings = listings.filter(l => { if (seen.has(l.slug)) return false; seen.add(l.slug); return true; });
        listingsFound = listings.length;

        for (const listing of listings) {
            // Skip excluded listings entirely
            if (excludedSlugs.has(listing.slug)) continue;

            const insertResult = await db.query(
                `INSERT INTO listings (job_id, slug, title, price, price_value, price_type,
           size_text, size_perches, location, url, is_member, posted_text, status, last_seen_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'active', NOW())
         ON CONFLICT (slug) DO UPDATE SET
           last_seen_at = NOW(),
           status = CASE WHEN listings.status = 'excluded' THEN 'excluded' ELSE listings.status END
         RETURNING id, (xmax = 0) AS is_new`,
                [
                    job.id, listing.slug, listing.title, listing.price,
                    listing.priceValue, listing.priceType, listing.sizeText,
                    listing.sizePerches, listing.location, listing.url,
                    listing.isMember, listing.postedText,
                ]
            );

            const row = insertResult.rows[0];
            const isNew = row.is_new;

            if (isNew) {
                newListings++;
                console.log(`  ✓ NEW: ${listing.title || listing.slug}`);
                console.log(`    ${listing.sizeText} | ${listing.price} | ${listing.location}`);

                // Record initial price
                if (listing.priceValue) {
                    await db.query(
                        'INSERT INTO price_history (listing_id, price_value, price_type, price_text) VALUES ($1, $2, $3, $4)',
                        [row.id, listing.priceValue, listing.priceType, listing.price]
                    );
                }

                // Check deep-dive rules
                if (matchesRules(listing, job.deep_dive_rules)) {
                    try {
                        console.log(`    → Deep-diving...`);
                        await delay(config.requestDelay);
                        const detail = await scrapeDetail(listing.url, listing.slug, browser);
                        const fullListing = { ...listing, detailFields: detail.detailFields };
                        const matchedLog = matchesRules(fullListing, job.log_rules);

                        const postedAt = parsePostedDate(detail.postedText);

                        await db.query(
                            `UPDATE listings SET
                 detail_scraped = true, description = $1, phone = $2,
                 seller_name = $3, detail_fields = $4, image_urls = $5,
                 image_path = $6, matched_log = $7,
                 posted_at = COALESCE($9, posted_at),
                 sub_location = COALESCE($10, sub_location)
               WHERE id = $8`,
                            [
                                detail.description, detail.phone, detail.sellerName,
                                JSON.stringify(detail.detailFields), JSON.stringify(detail.imageUrls),
                                detail.imagePath, matchedLog, row.id,
                                postedAt, detail.subLocation || null,
                            ]
                        );
                        deepDived++;
                        if (matchedLog) console.log(`    ✅ Matched log rules`);
                        else console.log(`    ⏭ Didn't match log rules`);
                        if (detail.phone) console.log(`    📞 ${detail.phone}`);
                    } catch (detailErr) {
                        console.error(`    ✗ Deep-dive failed: ${detailErr.message}`);
                    }
                } else {
                    console.log(`    → Skipped deep-dive (doesn't match conditions)`);
                }
            }
        }

        // ── Phase 2: Re-check matched active listings ──────────────
        const activeListings = await db.query(
            `SELECT id, slug, title, url, price_value, price_type, price
       FROM listings
       WHERE job_id = $1 AND status = 'active' AND matched_log = true
       ORDER BY id`,
            [job.id]
        );

        if (activeListings.rows.length > 0) {
            console.log(`\n  [Re-check] Checking ${activeListings.rows.length} active listings...`);

            for (const listing of activeListings.rows) {
                try {
                    await delay(config.requestDelay);
                    const check = await checkListing(listing.url, browser);
                    rechecked++;

                    if (!check.alive) {
                        await db.query("UPDATE listings SET status = 'sold', sold_at = COALESCE(sold_at, NOW()) WHERE id = $1", [listing.id]);
                        soldDetected++;
                        console.log(`    🔴 SOLD: ${listing.title || listing.slug}`);
                        continue;
                    }

                    await db.query('UPDATE listings SET last_seen_at = NOW() WHERE id = $1', [listing.id]);

                    if (check.priceValue) {
                        await db.query(
                            'INSERT INTO price_history (listing_id, price_value, price_type, price_text) VALUES ($1, $2, $3, $4)',
                            [listing.id, check.priceValue, check.priceType, check.priceText]
                        );

                        const oldPrice = parseFloat(listing.price_value);
                        if (oldPrice && check.priceValue !== oldPrice) {
                            priceChanges++;
                            const diff = check.priceValue - oldPrice;
                            const pct = ((diff / oldPrice) * 100).toFixed(1);
                            const arrow = diff < 0 ? '🔻' : '🔺';
                            console.log(`    ${arrow} PRICE CHANGE: ${listing.title || listing.slug}`);
                            console.log(`      Rs ${oldPrice.toLocaleString()} → Rs ${check.priceValue.toLocaleString()} (${pct}%)`);

                            await db.query(
                                'UPDATE listings SET price_value = $1, price_type = $2, price = $3 WHERE id = $4',
                                [check.priceValue, check.priceType, check.priceText, listing.id]
                            );
                        }
                    }
                } catch (err) {
                    console.error(`    ✗ Check failed for ${listing.slug}: ${err.message}`);
                }
            }
        }

        console.log(`\n[${job.name}] Summary: ${listingsFound} found, ${newListings} new, ${deepDived} deep-dived, ${rechecked} re-checked, ${priceChanges} price changes, ${soldDetected} sold`);

        await db.query(
            `UPDATE scrape_runs SET finished_at = NOW(),
         listings_found = $1, new_listings = $2, deep_dived = $3,
         rechecked = $4, price_changes = $5, sold_detected = $6
       WHERE id = $7`,
            [listingsFound, newListings, deepDived, rechecked, priceChanges, soldDetected, runId]
        );

        await db.query('UPDATE jobs SET last_run_at = NOW() WHERE id = $1', [job.id]);

    } catch (err) {
        console.error(`[${job.name}] Error: ${err.message}`);
        await db.query('UPDATE scrape_runs SET finished_at = NOW(), error = $1 WHERE id = $2', [err.message, runId]);
    } finally {
        await browser.close();
    }

    return { listingsFound, newListings, deepDived, rechecked, priceChanges, soldDetected };
}

module.exports = { runJob };
