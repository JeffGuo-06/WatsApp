export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const response = await fetch('https://classes.uwaterloo.ca/uwpcshtm.html');

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const html = await response.text();

    if (!html) {
      throw new Error('Empty response from UWaterloo');
    }

    console.log('HTML length:', html.length);

    const courses = [];

    // Parse HTML table structure
    // Match all table rows
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    const rows = [...html.matchAll(rowRegex)];

    console.log('Total rows found:', rows.length);

    let validCourses = 0;

    for (const row of rows) {
      const rowContent = row[1];

      // Extract all table cells from this row
      const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      const cells = [...rowContent.matchAll(cellRegex)];

      // We expect 6 columns: Subject, Cat Nbr, Title, Topic, Campus, Notes
      if (cells.length >= 5) {
        const subject = cells[0][1].trim().replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
        const catalog = cells[1][1].trim().replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
        const title = cells[2][1].trim().replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
        const topic = cells[3][1].trim().replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
        const campus = cells[4][1].trim().replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

        // Validate that this looks like a course (subject is 2-6 uppercase letters, catalog is digits)
        if (/^[A-Z]{2,6}$/.test(subject) && /^\d{2,4}[A-Z]?$/.test(catalog) && title.length > 0) {
          validCourses++;

          if (validCourses <= 10) {
            console.log(`Course ${validCourses}:`, { subject, catalog, title, campus });
          }

          courses.push({
            subject,
            catalog,
            title,
            campus,
            topic: topic || null
          });
        }
      }
    }

    console.log('Total courses found:', courses.length);

    res.status(200).json({ courses });
  } catch (error) {
    console.error('Error fetching courses:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch courses' });
  }
}
