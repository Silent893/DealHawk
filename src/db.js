const { Pool } = require('pg');
const config = require('./config');

// Timeouts so a dead connection fails instead of hanging: jobs run one at a time,
// so a query that never returns would stop them all.
const pool = new Pool({
    connectionString: config.databaseUrl,
    connectionTimeoutMillis: 30000,
    query_timeout: 120000,
});

pool.on('error', (err) => {
    console.error('[DB] Unexpected pool error:', err.message);
});

module.exports = {
    query: (text, params) => pool.query(text, params),
    pool,
};
