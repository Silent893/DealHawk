const http = require('http');
const https = require('https');

const HA_WEBHOOK_URL = process.env.HA_WEBHOOK_URL || '';

/**
 * Send a notification event to Home Assistant via webhook.
 * @param {string} event - Event type: new_listing, price_drop, sold, run_summary
 * @param {object} data - Event payload
 */
function notify(event, data) {
    if (!HA_WEBHOOK_URL) return;

    const payload = JSON.stringify({ event, ...data, timestamp: new Date().toISOString() });
    const url = new URL(HA_WEBHOOK_URL);
    const client = url.protocol === 'https:' ? https : http;

    const req = client.request({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        timeout: 5000,
    }, (res) => {
        if (res.statusCode >= 400) {
            console.error(`[Notify] HA webhook returned ${res.statusCode}`);
        }
    });

    req.on('error', (err) => {
        console.error(`[Notify] Failed: ${err.message}`);
    });

    req.write(payload);
    req.end();
}

module.exports = { notify };
