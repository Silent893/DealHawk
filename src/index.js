const db = require('./db');
const { migrate } = require('./migrate');
const { runJob } = require('./runner');
const { sweepStaleProfiles } = require('./browser');
const { start: startServer, runningJobs, trackJob, untrackJob } = require('./server');

// A failed job stays due, so without this wait it would relaunch every minute.
const RETRY_DELAY = 30 * 60 * 1000;

async function main() {
    const args = process.argv.slice(2);

    // Reclaim Chromium profiles stranded by a crash or a previous container.
    sweepStaleProfiles();

    // If started with "serve" — run the dashboard server + scheduler
    if (args[0] === 'serve' || args.length === 0) {
        await startServer();
        startScheduler();
        return;
    }

    // If started with "run" — one-off run of all active jobs
    if (args[0] === 'run') {
        await migrate();
        console.log(`\n${'='.repeat(60)}`);
        console.log(`DealHawk — ${new Date().toISOString()}`);
        console.log('='.repeat(60));

        const result = await db.query('SELECT * FROM jobs WHERE active = true ORDER BY id');
        if (result.rows.length === 0) {
            console.log('\nNo active jobs. Create one via the dashboard.');
            process.exit(0);
        }

        let totalNew = 0;
        for (const job of result.rows) {
            const stats = await runJob(job);
            totalNew += stats.newListings;
        }

        console.log(`\nAll done. ${totalNew} new listing(s).`);
        process.exit(0);
    }

    console.log('Usage: node src/index.js [serve|run]');
    process.exit(1);
}

/**
 * Simple scheduler that checks every minute if any job needs to run.
 */
function startScheduler() {
    console.log('[Scheduler] Started — checking jobs every minute');

    const retryAt = new Map(); // jobId → earliest next attempt, ms
    let checking = false;

    setInterval(async () => {
        // Each tick works through every due job, so a new one must not start beside it.
        if (checking) return;
        checking = true;

        try {
            const result = await db.query(`
        SELECT * FROM jobs
        WHERE active = true
          AND (last_run_at IS NULL OR last_run_at + (frequency_hours || ' hours')::interval < NOW())
        ORDER BY id
      `);

            for (const job of result.rows) {
                if (runningJobs.has(job.id)) {
                    console.log(`[Scheduler] Skipping ${job.name} — already running`);
                    continue;
                }
                if (Date.now() < (retryAt.get(job.id) || 0)) continue;

                console.log(`[Scheduler] Running job: ${job.name}`);
                const ac = new AbortController();
                trackJob(job.id, ac, null);
                let failed;
                try {
                    ({ failed } = await runJob(job, { signal: ac.signal }));
                } catch (err) {
                    failed = err.message;
                } finally {
                    untrackJob(job.id);
                }

                if (failed) {
                    console.error(`[Scheduler] ${job.name} failed, retrying in ${RETRY_DELAY / 60000} min: ${failed}`);
                    retryAt.set(job.id, Date.now() + RETRY_DELAY);
                } else {
                    retryAt.delete(job.id);
                }
            }
        } catch (err) {
            console.error('[Scheduler] Error:', err.message);
        } finally {
            checking = false;
        }
    }, 60 * 1000); // Check every minute
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
