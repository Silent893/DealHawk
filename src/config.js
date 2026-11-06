require('dotenv').config();
const path = require('path');

const requestDelay = parseInt(process.env.REQUEST_DELAY, 10);

module.exports = {
  databaseUrl: process.env.DATABASE_URL,
  scrapeTimeout: parseInt(process.env.SCRAPE_TIMEOUT || '30000', 10),
  headless: process.env.HEADLESS !== 'false',
  imagesDir: process.env.IMAGES_DIR || path.join(__dirname, '..', 'data', 'images'),
  port: parseInt(process.env.PORT || '3000', 10),
  requestDelay: Number.isNaN(requestDelay) ? 2000 : requestDelay, // ms between requests
};
