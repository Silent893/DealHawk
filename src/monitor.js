const { program } = require('commander');
const db = require('./db');
const { migrate } = require('./migrate');

program
    .name('monitor')
    .description('Manage ikman.lk scrape monitors');

program
    .command('add')
    .description('Add a new monitor URL')
    .requiredOption('--name <name>', 'Human-readable name, e.g. "Gampaha Land"')
    .requiredOption('--url <url>', 'Full ikman.lk listing page URL')
    .option('--category <category>', 'Category label, e.g. "land", "cars"', 'general')
    .option('--deep-dive <rule>', 'JSON deep-dive rule, e.g. \'{"field":"size_perches","op":">=","value":100}\'')
    .action(async (opts) => {
        await migrate();

        let deepDiveRule = null;
        if (opts.deepDive) {
            try {
                deepDiveRule = JSON.parse(opts.deepDive);
            } catch (e) {
                console.error('[Monitor] Invalid JSON for --deep-dive:', e.message);
                process.exit(1);
            }
        }

        try {
            const result = await db.query(
                `INSERT INTO monitors (name, url, category, deep_dive_rule)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (url) DO UPDATE SET
           name = EXCLUDED.name,
           category = EXCLUDED.category,
           deep_dive_rule = EXCLUDED.deep_dive_rule,
           active = true
         RETURNING id, name, url`,
                [opts.name, opts.url, opts.category, deepDiveRule ? JSON.stringify(deepDiveRule) : null]
            );
            const row = result.rows[0];
            console.log(`✓ Monitor added/updated: [${row.id}] ${row.name}`);
            console.log(`  URL: ${row.url}`);
            if (deepDiveRule) {
                console.log(`  Deep-dive rule: ${JSON.stringify(deepDiveRule)}`);
            }
        } catch (err) {
            console.error('[Monitor] Error:', err.message);
        }
        process.exit(0);
    });

program
    .command('list')
    .description('List all monitors')
    .action(async () => {
        await migrate();
        const result = await db.query('SELECT * FROM monitors ORDER BY id');
        if (result.rows.length === 0) {
            console.log('No monitors configured. Use "add" to create one.');
        } else {
            console.log(`\n${'ID'.padEnd(5)} ${'Name'.padEnd(25)} ${'Category'.padEnd(12)} ${'Active'.padEnd(8)} URL`);
            console.log('-'.repeat(100));
            for (const m of result.rows) {
                console.log(
                    `${String(m.id).padEnd(5)} ${m.name.padEnd(25)} ${(m.category || '').padEnd(12)} ${(m.active ? '✓' : '✗').padEnd(8)} ${m.url}`
                );
                if (m.deep_dive_rule) {
                    console.log(`      Deep-dive: ${JSON.stringify(m.deep_dive_rule)}`);
                }
            }
        }
        console.log('');
        process.exit(0);
    });

program
    .command('disable')
    .description('Disable a monitor')
    .requiredOption('--id <id>', 'Monitor ID')
    .action(async (opts) => {
        const result = await db.query(
            'UPDATE monitors SET active = false WHERE id = $1 RETURNING name',
            [parseInt(opts.id, 10)]
        );
        if (result.rows.length > 0) {
            console.log(`✓ Disabled: ${result.rows[0].name}`);
        } else {
            console.log(`✗ No monitor found with ID ${opts.id}`);
        }
        process.exit(0);
    });

program
    .command('enable')
    .description('Enable a monitor')
    .requiredOption('--id <id>', 'Monitor ID')
    .action(async (opts) => {
        const result = await db.query(
            'UPDATE monitors SET active = true WHERE id = $1 RETURNING name',
            [parseInt(opts.id, 10)]
        );
        if (result.rows.length > 0) {
            console.log(`✓ Enabled: ${result.rows[0].name}`);
        } else {
            console.log(`✗ No monitor found with ID ${opts.id}`);
        }
        process.exit(0);
    });

program
    .command('remove')
    .description('Remove a monitor (keeps its listings)')
    .requiredOption('--id <id>', 'Monitor ID')
    .action(async (opts) => {
        const result = await db.query(
            'DELETE FROM monitors WHERE id = $1 RETURNING name',
            [parseInt(opts.id, 10)]
        );
        if (result.rows.length > 0) {
            console.log(`✓ Removed: ${result.rows[0].name}`);
        } else {
            console.log(`✗ No monitor found with ID ${opts.id}`);
        }
        process.exit(0);
    });

program.parse();
