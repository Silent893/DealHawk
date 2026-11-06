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

// How long a browser gets to close itself before it is killed.
const CLOSE_TIMEOUT = 15000;

let seq = 0;

// Profiles held by a running browser. Anything else under PROFILE_ROOT is stranded.
const liveProfiles = new Set();

function rmrf(dir) {
    try {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    } catch (_) {
        // Best effort — a stranded profile is not worth failing a scrape over.
    }
}

/**
 * Remove profiles no running browser holds. PROFILE_ROOT is RAM-backed and counts
 * against the container's memory limit, so nothing may pile up there.
 */
function sweepOrphanProfiles() {
    for (const name of fs.readdirSync(PROFILE_ROOT)) {
        const dir = path.join(PROFILE_ROOT, name);
        if (!liveProfiles.has(dir)) rmrf(dir);
    }
}

/**
 * Launch Chromium with its profile under PROFILE_ROOT, removed when the process
 * exits — which covers a crash as well as a normal close. 'disconnected' is too
 * early: Chromium can still be writing to the profile after the socket closes.
 */
async function launchBrowser() {
    fs.mkdirSync(PROFILE_ROOT, { recursive: true });
    sweepOrphanProfiles();

    const userDataDir = path.join(PROFILE_ROOT, `p${process.pid}-${seq++}`);
    const release = () => {
        liveProfiles.delete(userDataDir);
        rmrf(userDataDir);
    };
    liveProfiles.add(userDataDir);

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: config.headless ? 'new' : false,
            args: BROWSER_ARGS,
            userDataDir,
        });
    } catch (err) {
        release();
        throw err;
    }

    browser.process().once('exit', release);
    return browser;
}

/**
 * Close a browser, killing it if it won't go. A frozen Chromium can hold close()
 * open indefinitely, and the job queue would wait on it.
 */
async function closeBrowser(browser) {
    const proc = browser.process();
    let timer;
    await Promise.race([
        browser.close().catch(() => { }),
        new Promise(resolve => { timer = setTimeout(resolve, CLOSE_TIMEOUT); }),
    ]);
    clearTimeout(timer);
    if (proc && proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL');
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

module.exports = { launchBrowser, closeBrowser, sweepStaleProfiles, BROWSER_ARGS, USER_AGENT, PROFILE_ROOT };
