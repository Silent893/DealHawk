const db = require('./db');
const { migrate } = require('./migrate');
const { runJob } = require('./runner');
const { start: startServer } = require('./server');

async function main() {
    const args = process.argv.slice(2);

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

    setInterval(async () => {
        try {
            const result = await db.query(`
        SELECT * FROM jobs
        WHERE active = true
          AND (last_run_at IS NULL OR last_run_at + (frequency_hours || ' hours')::interval < NOW())
        ORDER BY id
      `);

            for (const job of result.rows) {
                console.log(`[Scheduler] Running job: ${job.name}`);
                await runJob(job);
            }
        } catch (err) {
            console.error('[Scheduler] Error:', err.message);
        }
    }, 60 * 1000); // Check every minute
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
