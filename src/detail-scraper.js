const puppeteer = require('puppeteer');
const config = require('./config');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const IMAGES_DIR = config.imagesDir || path.join(__dirname, '..', 'data', 'images');
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const BROWSER_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];

if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

/**
 * Deep-dive into a listing detail page to extract all available fields.
 * @param {string} url
 * @param {string} slug
 * @param {object} browser - Optional Puppeteer browser to reuse
 */
async function scrapeDetail(url, slug, browser) {
    const ownBrowser = !browser;
    if (!browser) {
        browser = await puppeteer.launch({ headless: config.headless ? 'new' : false, args: BROWSER_ARGS });
    }

    try {
        const page = await browser.newPage();
        await page.setUserAgent(USER_AGENT);

        console.log(`  [Detail] Loading: ${url}`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: config.scrapeTimeout });
        await page.waitForSelector('[class*="details-section--"]', { timeout: 10000 }).catch(() => { });

        const detail = await page.evaluate(() => {
            const data = {};

            const descEl = document.querySelector('[class*="description--1nRbz"]') ||
                document.querySelector('[class*="description-section--"] [class*="description--"]');
            data.description = descEl ? descEl.textContent.trim() : '';

            const phoneEl = document.querySelector('a[href^="tel:"]');
            data.phone = phoneEl ? phoneEl.getAttribute('href').replace('tel:', '').trim() : '';

            const sellerEl = document.querySelector('[class*="poster-details--"] a') ||
                document.querySelector('a[href*="/shops/"]');
            data.sellerName = sellerEl ? sellerEl.textContent.trim() : '';

            const detailFields = {};
            const labels = document.querySelectorAll('[class*="label--"]');
            labels.forEach(labelEl => {
                const row = labelEl.closest('[class*="item--"]') || labelEl.parentElement;
                if (!row) return;
                const valueEl = row.querySelector('[class*="value--"]');
                if (!valueEl) return;
                const label = labelEl.textContent.trim().replace(/:$/, '');
                const value = valueEl.textContent.trim();
                if (label && value) detailFields[label] = value;
            });
            data.detailFields = detailFields;

            const imageEls = document.querySelectorAll('[class*="gallery--"] img[src*="ikman-st"]');
            const imageUrls = [];
            const seen = new Set();
            imageEls.forEach(img => {
                const src = img.getAttribute('src') || '';
                const match = src.match(/(https:\/\/i\.ikman-st\.com\/[^/]+\/[a-f0-9-]+)/);
                if (match && !seen.has(match[1])) {
                    seen.add(match[1]);
                    imageUrls.push(match[1] + '/620/466/fitted.jpg');
                }
            });
            data.imageUrls = imageUrls;

            return data;
        });

        let imagePath = null;
        if (detail.imageUrls.length > 0) {
            try {
                imagePath = await downloadImage(detail.imageUrls[0], slug);
                console.log(`    📷 Image saved: ${imagePath}`);
            } catch (err) {
                console.error(`    ✗ Image download failed: ${err.message}`);
            }
        }

        await page.close();
        return { ...detail, imagePath };
    } finally {
        if (ownBrowser) await browser.close();
    }
}

/**
 * Download an image from a URL and save it to the images directory.
 */
function downloadImage(imageUrl, slug) {
    return new Promise((resolve, reject) => {
        const safeName = slug.replace(/[^a-zA-Z0-9-]/g, '_').substring(0, 100);
        const filename = `${safeName}.jpg`;
        const filepath = path.join(IMAGES_DIR, filename);

        if (fs.existsSync(filepath)) return resolve(filename);

        const client = imageUrl.startsWith('https') ? https : http;
        client.get(imageUrl, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                return downloadImage(res.headers.location, slug).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
            const stream = fs.createWriteStream(filepath);
            res.pipe(stream);
            stream.on('finish', () => { stream.close(); resolve(filename); });
            stream.on('error', reject);
        }).on('error', reject);
    });
}

/**
 * Quick check if a listing is still alive and get its current price.
 * @param {string} url
 * @param {object} browser - Optional Puppeteer browser to reuse
 */
async function checkListing(url, browser) {
    const ownBrowser = !browser;
    if (!browser) {
        browser = await puppeteer.launch({ headless: config.headless ? 'new' : false, args: BROWSER_ARGS });
    }

    try {
        const page = await browser.newPage();
        await page.setUserAgent(USER_AGENT);

        const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: config.scrapeTimeout });
        const status = response ? response.status() : 0;

        if (status === 404 || status >= 500) {
            await page.close();
            return { alive: false, priceValue: null, priceType: null, priceText: '' };
        }

        const currentUrl = page.url();
        const pageContent = await page.evaluate(() => document.body ? document.body.textContent : '');
        if (currentUrl.includes('/ads/') && !currentUrl.includes('/ad/')) {
            await page.close();
            return { alive: false, priceValue: null, priceType: null, priceText: '' };
        }
        if (pageContent.includes('This ad is no longer available') || pageContent.includes('Ad not found')) {
            await page.close();
            return { alive: false, priceValue: null, priceType: null, priceText: '' };
        }

        const priceData = await page.evaluate(() => {
            const priceEl = document.querySelector('[class*="price--"]');
            const priceText = priceEl ? priceEl.textContent.trim() : '';
            const match = priceText.match(/Rs\s*([\d,]+)\s*(per\s*perch|total\s*price)?/i);
            return {
                priceText,
                priceValue: match ? parseFloat(match[1].replace(/,/g, '')) : null,
                priceType: match && match[2]
                    ? (match[2].toLowerCase().includes('per') ? 'per_perch' : 'total')
                    : null,
            };
        });

        await page.close();
        return { alive: true, ...priceData };
    } finally {
        if (ownBrowser) await browser.close();
    }
}

/**
 * Evaluate a single rule against a listing. Returns true if the rule matches.
 */
function evaluateRule(listing, rule) {
    if (!rule.field || !rule.op || rule.value === undefined) return true;

    let listingValue;
    if (rule.field.startsWith('detail.')) {
        const detailKey = rule.field.replace('detail.', '');
        const rawVal = listing.detailFields ? listing.detailFields[detailKey] : undefined;
        if (rawVal !== undefined) {
            const numMatch = String(rawVal).match(/([\d,]+)/);
            listingValue = numMatch ? parseFloat(numMatch[1].replace(/,/g, '')) : rawVal;
        }
    } else {
        const fieldMap = {
            size_perches: 'sizePerches', price_value: 'priceValue',
            total_price: 'totalPrice', price_per_perch: 'pricePerPerch',
            title: 'title', location: 'location',
            is_member: 'isMember', price_type: 'priceType',
        };
        listingValue = listing[fieldMap[rule.field] || rule.field];
    }

    if (listingValue === null || listingValue === undefined) return false;
    const ruleValue = typeof listingValue === 'number' ? Number(rule.value) : rule.value;

    switch (rule.op) {
        case '>=': return listingValue >= ruleValue;
        case '<=': return listingValue <= ruleValue;
        case '>': return listingValue > ruleValue;
        case '<': return listingValue < ruleValue;
        case '==': return String(listingValue).toLowerCase() === String(ruleValue).toLowerCase();
        case '!=': return String(listingValue).toLowerCase() !== String(ruleValue).toLowerCase();
        case 'contains': return String(listingValue).toLowerCase().includes(String(ruleValue).toLowerCase());
        default: return false;
    }
}

/**
 * Evaluate whether a listing matches a set of rule groups.
 * Supports: flat arrays (backward compat), or groups with mode: AND/OR/EXCLUDE.
 * Groups combine with AND logic (all groups must pass).
 */
function matchesRules(listing, rules) {
    if (!rules || !Array.isArray(rules) || rules.length === 0) return true;

    // Backward compatibility: flat array of rules → treat as single AND group
    if (rules[0] && rules[0].field) {
        rules = [{ mode: 'AND', rules: rules }];
    }

    for (const group of rules) {
        if (!group.rules || group.rules.length === 0) continue;
        const mode = (group.mode || 'AND').toUpperCase();

        if (mode === 'AND') {
            const allMatch = group.rules.every(r => evaluateRule(listing, r));
            if (!allMatch) return false;
        } else if (mode === 'OR') {
            const anyMatch = group.rules.some(r => evaluateRule(listing, r));
            if (!anyMatch) return false;
        } else if (mode === 'EXCLUDE') {
            const anyMatch = group.rules.some(r => evaluateRule(listing, r));
            if (anyMatch) return false;
        }
    }
    return true;
}

module.exports = { scrapeDetail, matchesRules, checkListing };
