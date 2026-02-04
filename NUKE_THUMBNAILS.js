const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Path to database - updating to match .env
const dbPath = path.join(__dirname, 'data', 'neostream.db');
const publicDir = path.join(__dirname, 'public');

console.log('--- THUMBNAIL NUCLEAR CLEANUP ---');
console.log('Database Path:', dbPath);
console.log('Public Dir:', publicDir);

if (!fs.existsSync(dbPath)) {
    console.error('ERROR: Database file not found!');
    process.exit(1);
}

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        process.exit(1);
    }
    console.log('Connected to database.');
    nukeThumbnails();
});

function nukeThumbnails() {
    // 1. Get all thumbnails to delete files
    db.all('SELECT id, filepath FROM thumbnails', [], (err, rows) => {
        if (err) {
            console.error('Error fetching thumbnails:', err.message);
            db.close();
            return;
        }

        console.log(`Found ${rows.length} thumbnails to delete.`);

        let deletedFiles = 0;
        let errors = 0;

        rows.forEach((row) => {
            if (row.filepath) {
                // Ensure filepath is relative and doesn't try to climb out
                const relativePath = row.filepath.startsWith('/') ? row.filepath.substring(1) : row.filepath;
                const fullPath = path.join(publicDir, relativePath);

                try {
                    if (fs.existsSync(fullPath)) {
                        fs.unlinkSync(fullPath);
                        deletedFiles++;
                    } else {
                        console.log(`File not found, skipping: ${fullPath}`);
                    }
                } catch (e) {
                    console.error(`Error deleting file ${fullPath}:`, e.message);
                    errors++;
                }
            }
        });

        console.log(`File deletion complete: ${deletedFiles} deleted, ${errors} errors.`);

        // 2. Clear the table
        db.run('DELETE FROM thumbnails', [], function (err) {
            if (err) {
                console.error('Error clearing thumbnails table:', err.message);
            } else {
                console.log(`Database cleared: ${this.changes} rows deleted.`);
            }

            console.log('--- CLEANUP FINISHED ---');
            db.close();
        });
    });
}
