const fs = require('fs');
const csv = require('csv-parse');

// Read the exported CSV
fs.readFile('form_data.csv', 'utf8', (err, data) => {
  if (err) {
    console.error('Error reading CSV:', err);
    return;
  }

  const records = [];
  const parser = csv.parse({ columns: true, skip_empty_lines: true })
    .on('data', (row) => {
      records.push(row);
    })
    .on('end', () => {
      records.forEach((row, index) => {
        if (row.file && row.fileName) {
          try {
            // Convert base64 to binary and save as a file
            const fileBuffer = Buffer.from(row.file, 'base64');
            fs.writeFileSync(`exported_${index}_${row.fileName}`, fileBuffer);
            console.log(`Saved file: exported_${index}_${row.fileName}`);
          } catch (err) {
            console.error(`Error saving file for row ${index}:`, err);
          }
        }
      });
      console.log('File reconstruction complete!');
    })
    .on('error', (err) => {
      console.error('Error parsing CSV:', err);
    });

  parser.write(data);
  parser.end();
});