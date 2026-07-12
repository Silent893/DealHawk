const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer');
const config = require('./config');

// All Chromium scratch space lives under one known root so it can be mounted
// away from the container's writable layer and swept. With no userDataDir,
// Puppeteer mints a fresh /tmp/puppeteer_dev_chrome_profile-* per launch and
// only removes it on a clean close — a crash, a cancelled job or a container
// restart strands the profile, cache and all.
const PROFILE_ROOT = process.env.CHROME_PROFILE_ROOT || path.join(os.tmpdir(), 'dealhawk-chrome');

const BROWSER_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disk-cache-size=52428800',
    '--media-cache-size=0',
];

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

let seq = 0;

function rmrf(dir) {
    try {
        fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) {
        // Best effort — a stranded profile is not worth failing a scrape over.
    }
}

/**
 * Launch Chromium with its profile under PROFILE_ROOT, removed when the browser
 * disconnects — which covers a crash as well as a normal close.
 */
async function launchBrowser() {
    fs.mkdirSync(PROFILE_ROOT, { recursive: true });
    const userDataDir = path.join(PROFILE_ROOT, `p${process.pid}-${seq++}`);

    const browser = await puppeteer.launch({
        headless: config.headless ? 'new' : false,
        args: BROWSER_ARGS,
        userDataDir,
    });

    browser.once('disconnected', () => rmrf(userDataDir));
    return browser;
}

/**
 * Drop profiles stranded by an earlier process. Only safe at boot, before any
 * launch: nothing from this process is using PROFILE_ROOT yet, and no browser
 * from a dead process still holds one.
 */
function sweepStaleProfiles() {
    const tmp = os.tmpdir();
    const legacy = fs.existsSync(tmp)
        ? fs.readdirSync(tmp)
            .filter(n => n.startsWith('puppeteer_dev_chrome_profile-'))
            .map(n => path.join(tmp, n))
        : [];

    const stale = [...legacy, PROFILE_ROOT].filter(p => fs.existsSync(p));
    if (stale.length === 0) return;

    for (const dir of stale) rmrf(dir);
    console.log(`[Browser] Swept ${stale.length} stale Chromium profile dir(s) from ${tmp}`);
}

module.exports = { launchBrowser, sweepStaleProfiles, BROWSER_ARGS, USER_AGENT, PROFILE_ROOT };
