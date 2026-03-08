const puppeteer = require('puppeteer');
const config = require('./config');

/**
 * Get a shared browser instance for scanning operations.
 * Avoids launching a new browser for each scan step.
 */
let _browser = null;
async function getBrowser() {
    if (!_browser || !_browser.connected) {
        _browser = await puppeteer.launch({
            headless: config.headless ? 'new' : false,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        });
    }
    return _browser;
}

async function closeBrowser() {
    if (_browser && _browser.connected) {
        await _browser.close();
        _browser = null;
    }
}

/**
 * Scan a list page URL and discover the available card-level fields.
 * Returns sample listings with their fields so the UI can show what's available.
 */
async function scanListPage(url) {
    const browser = await getBrowser();
    const page = await browser.newPage();
    await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: config.scrapeTimeout });
        await page.waitForSelector('[class*="normal--"][class*="gtm-normal-ad"]', { timeout: 15000 }).catch(() => { });

        const result = await page.evaluate(() => {
            const cards = document.querySelectorAll('li[class*="normal--"][class*="gtm-normal-ad"]');
            const samples = [];

            for (let i = 0; i < Math.min(cards.length, 5); i++) {
                const card = cards[i];
                const link = card.querySelector('a[href*="/en/ad/"]');
                if (!link) continue;

                const href = link.getAttribute('href') || '';
                const slug = href.replace(/^\/en\/ad\//, '').replace(/\/$/, '');

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
                const priceType = priceTypeMatch ? (priceTypeMatch[1].toLowerCase().includes('per') ? 'per_perch' : 'total') : null;
                const sizeVal = sizeMatch ? parseFloat(sizeMatch[1].replace(',', '')) : null;

                // Compute normalized prices
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

                samples.push({
                    slug,
                    title: titleEl ? titleEl.textContent.trim() : '',
                    size_text: sizeText,
                    size_perches: sizeVal,
                    price: priceText,
                    price_value: priceVal,
                    price_type: priceType,
                    total_price: totalPrice,
                    price_per_perch: pricePerPerch,
                    location: locMatch ? locMatch[1].trim() : descText,
                    is_member: !!memberEl,
                    posted_text: timeEl ? timeEl.textContent.trim() : '',
                    url: `https://ikman.lk${href}`,
                });
            }

            // Derive the field set from the samples
            const fields = [];
            if (samples.length > 0) {
                const s = samples[0];
                if (s.title) fields.push({ key: 'title', label: 'Title', type: 'text', sample: s.title });
                if (s.size_perches !== null) fields.push({ key: 'size_perches', label: 'Size (perches)', type: 'number', sample: s.size_perches });
                if (s.price_value !== null) fields.push({ key: 'price_value', label: 'Price (raw value)', type: 'number', sample: s.price_value });
                if (s.total_price !== null) fields.push({ key: 'total_price', label: 'Total Price', type: 'number', sample: s.total_price });
                if (s.price_per_perch !== null) fields.push({ key: 'price_per_perch', label: 'Price per Perch', type: 'number', sample: s.price_per_perch });
                if (s.price_type) fields.push({ key: 'price_type', label: 'Price Type', type: 'enum', sample: s.price_type, options: ['per_perch', 'total'] });
                if (s.location) fields.push({ key: 'location', label: 'Location', type: 'text', sample: s.location });
                fields.push({ key: 'is_member', label: 'Member', type: 'boolean', sample: s.is_member });
            }

            return { fields, samples, totalCards: cards.length };
        });

        return result;
    } finally {
        await page.close();
    }
}

/**
 * Scan a detail page URL and discover all available fields.
 * Returns the key-value pairs, description, images, phone, seller info.
 */
async function scanDetailPage(url) {
    const browser = await getBrowser();
    const page = await browser.newPage();
    await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: config.scrapeTimeout });
        await page.waitForSelector('[class*="details-section--"]', { timeout: 10000 }).catch(() => { });

        const result = await page.evaluate(() => {
            const data = {};

            // Title
            const titleEl = document.querySelector('[class*="title--3yncE"], h1[class*="title--"]');
            data.title = titleEl ? titleEl.textContent.trim() : '';

            // Price
            const priceEl = document.querySelector('[class*="price--"] [class*="color--"]') ||
                document.querySelector('[class*="price--"]');
            data.price = priceEl ? priceEl.textContent.trim() : '';

            // Description
            const descEl = document.querySelector('[class*="description--1nRbz"]') ||
                document.querySelector('[class*="description-section--"] [class*="description--"]');
            data.description = descEl ? descEl.textContent.trim() : '';

            // Phone
            const phoneEl = document.querySelector('a[href^="tel:"]');
            data.phone = phoneEl ? phoneEl.getAttribute('href').replace('tel:', '').trim() : '';

            // Seller
            const sellerEl = document.querySelector('[class*="poster-details--"] a') ||
                document.querySelector('a[href*="/shops/"]');
            data.seller_name = sellerEl ? sellerEl.textContent.trim() : '';

            // Location breadcrumb
            const locEl = document.querySelector('[class*="description--2-ez3"]');
            data.location = locEl ? locEl.textContent.trim() : '';

            // Key-value detail fields (label → value pairs)
            const detailFields = {};
            const labels = document.querySelectorAll('[class*="label--"]');
            labels.forEach(labelEl => {
                const row = labelEl.closest('[class*="item--"]') || labelEl.parentElement;
                if (!row) return;
                const valueEl = row.querySelector('[class*="value--"]');
                if (!valueEl) return;

                const label = labelEl.textContent.trim().replace(/:$/, '');
                const value = valueEl.textContent.trim();
                if (label && value) {
                    detailFields[label] = value;
                }
            });
            data.detail_fields = detailFields;

            // Images
            const imageEls = document.querySelectorAll('[class*="gallery--"] img[src*="ikman-st"]');
            const imageUrls = [];
            const seen = new Set();
            imageEls.forEach(img => {
                let src = img.getAttribute('src') || '';
                // Get the full-size version by modifying the URL pattern
                const match = src.match(/(https:\/\/i\.ikman-st\.com\/[^/]+\/[a-f0-9-]+)/);
                if (match && !seen.has(match[1])) {
                    seen.add(match[1]);
                    imageUrls.push(match[1] + '/620/466/fitted.jpg');
                }
            });
            data.image_urls = imageUrls;

            return data;
        });

        // Build field descriptors for the UI
        const fields = [];
        fields.push({ key: 'title', label: 'Title', type: 'text', sample: result.title });
        fields.push({ key: 'price', label: 'Price', type: 'text', sample: result.price });
        fields.push({ key: 'location', label: 'Location', type: 'text', sample: result.location });
        fields.push({ key: 'description', label: 'Description', type: 'text', sample: result.description ? result.description.substring(0, 200) + '...' : '' });
        fields.push({ key: 'phone', label: 'Phone', type: 'text', sample: result.phone });
        fields.push({ key: 'seller_name', label: 'Seller', type: 'text', sample: result.seller_name });

        for (const [key, value] of Object.entries(result.detail_fields)) {
            const isNumeric = /^[\d,.]+/.test(value);
            fields.push({
                key: `detail.${key}`,
                label: key,
                type: isNumeric ? 'number' : 'text',
                sample: value,
            });
        }

        fields.push({ key: 'image_urls', label: 'Images', type: 'images', sample: `${result.image_urls.length} image(s)` });

        return { fields, data: result };
    } finally {
        await page.close();
    }
}

module.exports = { scanListPage, scanDetailPage, closeBrowser };
