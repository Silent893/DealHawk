require('dotenv').config();
const path = require('path');

module.exports = {
  databaseUrl: process.env.DATABASE_URL,
  scrapeTimeout: parseInt(process.env.SCRAPE_TIMEOUT || '30000', 10),
  headless: process.env.HEADLESS !== 'false',
  imagesDir: process.env.IMAGES_DIR || path.join(__dirname, '..', 'data', 'images'),
  port: parseInt(process.env.PORT || '3000', 10),
  requestDelay: parseInt(process.env.REQUEST_DELAY || '2000', 10), // ms between requests
};
