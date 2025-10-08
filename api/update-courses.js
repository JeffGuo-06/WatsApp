// Run this script to update courses.json for a new term
// Usage: node api/update-courses.js

const https = require('https');
const fs = require('fs');
const path = require('path');

// Update this URL when a new term starts
// Find the latest snapshot at: https://web.archive.org/web/*/https://classes.uwaterloo.ca/uwpcshtm.html
const ARCHIVE_URL = 'https://web.archive.org/web/20250821132601/https://classes.uwaterloo.ca/uwpcshtm.html';

https.get(ARCHIVE_URL, (res) => {
  let html = '';
  res.on('data', (chunk) => html += chunk);
  res.on('end', () => {
    console.log('Parsing courses from HTML...');

    const courses = [];
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    const rows = [...html.matchAll(rowRegex)];

    for (const row of rows) {
      const rowContent = row[1];
      const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      const cells = [...rowContent.matchAll(cellRegex)];

      if (cells.length >= 5) {
        const subject = cells[0][1].trim().replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/<[^>]*>/g, '');
        const catalog = cells[1][1].trim().replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/<[^>]*>/g, '');
        const title = cells[2][1].trim().replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/<[^>]*>/g, '');
        const topic = cells[3][1].trim().replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/<[^>]*>/g, '');
        const campus = cells[4][1].trim().replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/<[^>]*>/g, '');

        if (/^[A-Z]{2,6}$/.test(subject) && /^\d{1,4}[A-Z]?$/.test(catalog) && title.length > 0) {
          courses.push({ subject, catalog, title, campus, topic: topic || null });
        }
      }
    }

    const data = {
      courses,
      lastUpdated: new Date().toISOString().split('T')[0],
      term: 'Fall 2025 (1259)', // Update this for each term
      sourceUrl: ARCHIVE_URL
    };

    const outputPath = path.join(__dirname, 'courses.json');
    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));

    console.log(`✓ Successfully parsed ${courses.length} courses`);
    console.log(`✓ Saved to ${outputPath}`);
  });
}).on('error', (e) => {
  console.error('Error fetching courses:', e);
  process.exit(1);
});
