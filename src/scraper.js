const puppeteer = require('puppeteer');
const config = require('./config');

const BROWSER_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Navigate with retry logic — increasing timeouts on each attempt.
 * @param {object} page - Puppeteer page
 * @param {string} url - URL to navigate to
 * @param {object} opts - Options
 * @param {number} [opts.maxRetries=3] - Max attempts
 * @param {number} [opts.baseTimeout] - Base timeout in ms (default: config.scrapeTimeout)
 * @returns {object} Puppeteer response
 */
async function gotoWithRetry(page, url, opts = {}) {
    const maxRetries = opts.maxRetries || 3;
    const baseTimeout = opts.baseTimeout || config.scrapeTimeout;
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const timeout = baseTimeout + (attempt - 1) * 15000; // 30s, 45s, 60s
            return await page.goto(url, { waitUntil: 'networkidle2', timeout });
        } catch (err) {
            lastError = err;
            if (attempt < maxRetries) {
                console.log(`[Scraper] Retry ${attempt}/${maxRetries} for ${url} (${err.message})`);
                await new Promise(r => setTimeout(r, 2000 * attempt)); // back off
            }
        }
    }
    throw lastError;
}

/**
 * Build a page URL by setting/replacing the page= query param.
 */
function buildPageUrl(baseUrl, pageNum) {
    const url = new URL(baseUrl);
    url.searchParams.set('page', pageNum);
    return url.toString();
}

/**
 * Launch or reuse a Puppeteer browser.
 */
async function getBrowser(existingBrowser) {
    if (existingBrowser && existingBrowser.isConnected()) return existingBrowser;
    return puppeteer.launch({
        headless: config.headless ? 'new' : false,
        args: BROWSER_ARGS,
    });
}

/**
 * Scrape a single listing page for normal (non-promoted) ad cards.
 */
async function scrapePage(page, url) {
    console.log(`[Scraper] Loading: ${url}`);
    await gotoWithRetry(page, url);
    await page.waitForSelector('[class*="normal--"][class*="gtm-normal-ad"]', { timeout: 15000 }).catch(() => {
        console.log('[Scraper] Warning: No normal cards found within timeout');
    });

    return page.evaluate(() => {
        const cards = document.querySelectorAll('li[class*="normal--"][class*="gtm-normal-ad"]');
        const results = [];

        for (const card of cards) {
            const link = card.querySelector('a[href*="/en/ad/"]');
            if (!link) continue;

            const href = link.getAttribute('href') || '';
            const slug = href.replace(/^\/en\/ad\//, '').replace(/\/$/, '');
            if (!slug) continue;

            const titleEl = card.querySelector('[class*="title--"]');
            const detailsEl = card.querySelector('[class*="details--"]');
            const descEl = card.querySelector('[class*="description--"]');
            const priceEl = card.querySelector('[class*="price--"] span');
            const timeEl = card.querySelector('[class*="updated-time--"]');
            const memberEl = card.querySelector('[class*="premium-member--"]');

            const sizeText = detailsEl ? detailsEl.textContent.trim() : '';
            const sizeMatch = sizeText.match(/([\d,.]+)\s*perch/i);
            const priceText = priceEl ? priceEl.textContent.trim() : '';
            const priceMatch = priceText.match(/Rs\s*([\d,]+)/i);
            const priceTypeMatch = priceText.match(/(per\s*perch|total\s*price)/i);
            const descText = descEl ? descEl.textContent.trim() : '';
            const locMatch = descText.match(/^(.+?),/);

            const priceVal = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : null;
            const priceType = priceTypeMatch
                ? (priceTypeMatch[1].toLowerCase().includes('per') ? 'per_perch' : 'total')
                : null;
            const sizeVal = sizeMatch ? parseFloat(sizeMatch[1].replace(',', '')) : null;

            let totalPrice = null;
            let pricePerPerch = null;
            if (priceVal) {
                if (priceType === 'per_perch') {
                    pricePerPerch = priceVal;
                    totalPrice = sizeVal ? priceVal * sizeVal : null;
                } else if (priceType === 'total') {
                    totalPrice = priceVal;
                    pricePerPerch = sizeVal ? priceVal / sizeVal : null;
                } else {
                    totalPrice = priceVal;
                }
            }

            results.push({
                slug,
                title: titleEl ? titleEl.textContent.trim() : '',
                price: priceText,
                priceValue: priceVal,
                priceType: priceType,
                totalPrice,
                pricePerPerch,
                sizeText,
                sizePerches: sizeVal,
                location: locMatch ? locMatch[1].trim() : descText,
                url: `https://ikman.lk${href}`,
                isMember: !!memberEl,
                postedText: timeEl ? timeEl.textContent.trim() : '',
            });
        }

        return results;
    });
}

/**
 * Scrape listings with multi-page support.
 * If all page 1 listings are known slugs, auto-fetch page 2.
 * @param {string} baseUrl - The listing page URL
 * @param {Set} knownSlugs - Set of slugs already in DB for this job
 * @param {object} browser - Optional Puppeteer browser to reuse
 * @param {number} maxPages - Maximum pages to scan, default 2
 * @returns {Array} All scraped listings across pages
 */
async function scrapeListings(baseUrl, knownSlugs, browser, maxPages = 2) {
    const ownBrowser = !browser;
    browser = await getBrowser(browser);

    try {
        const page = await browser.newPage();
        await page.setUserAgent(USER_AGENT);

        let allListings = [];

        for (let p = 1; p <= maxPages; p++) {
            const pageUrl = p === 1 ? baseUrl : buildPageUrl(baseUrl, p);
            await (p > 1 ? new Promise(r => setTimeout(r, config.requestDelay)) : Promise.resolve());

            const pageListings = await scrapePage(page, pageUrl);
            console.log(`[Scraper] Page ${p}: ${pageListings.length} listings`);

            if (pageListings.length === 0) break;
            allListings = [...allListings, ...pageListings];

            // If we have known slugs, check if we should continue
            if (knownSlugs && knownSlugs.size > 0) {
                const allKnown = pageListings.every(l => knownSlugs.has(l.slug));
                if (allKnown) {
                    console.log(`[Scraper] All page ${p} listings are known — stopping`);
                    break;
                }
                const newCount = pageListings.filter(l => !knownSlugs.has(l.slug)).length;
                console.log(`[Scraper] ${newCount} new on page ${p} — continuing...`);
            }
            // No known slugs (first run) → keep going up to maxPages
        }

        await page.close();
        return allListings;
    } finally {
        if (ownBrowser) await browser.close();
    }
}

module.exports = { scrapeListings, getBrowser };
