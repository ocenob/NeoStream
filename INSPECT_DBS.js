const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbFiles = ['neostream.db', 'streamflow.db', 'database.db', 'sqlite.db'];

dbFiles.forEach(file => {
    const dbPath = path.join(__dirname, 'data', file);
    if (!fs.existsSync(dbPath)) return;

    const db = new sqlite3.Database(dbPath);
    db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, tables) => {
        if (err) {
            console.error(`Error reading ${file}:`, err.message);
            return;
        }
        console.log(`--- Tables in ${file} ---`);
        console.log(tables.map(t => t.name).join(', '));

        if (tables.some(t => t.name === 'thumbnails')) {
            db.get("SELECT COUNT(*) as count FROM thumbnails", (err, row) => {
                if (!err) console.log(`   Thumbnails count: ${row.count}`);
                db.close();
            });
        } else {
            db.close();
        }
    });
});
