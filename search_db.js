const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const dbs = [
    'j:/neostream/db/database.db',
    'j:/neostream/data/neostream.db',
    'j:/neostream/data/streamflow.db'
];

async function search() {
    for (const dbPath of dbs) {
        if (!fs.existsSync(dbPath)) {
            console.log(`DB not found: ${dbPath}`);
            continue;
        }
        console.log(`Searching in ${dbPath}...`);
        const db = new sqlite3.Database(dbPath);

        await new Promise((resolve) => {
            db.all("SELECT id, name FROM stream_rotations WHERE name LIKE '%Monday - 08:00%'", [], (err, rows) => {
                if (err) {
                    console.error(`  Error: ${err.message}`);
                } else if (rows && rows.length > 0) {
                    console.log(`  FOUND! ${rows.length} rotations in ${dbPath}`);
                    rows.forEach(r => console.log(`    - ${r.id}: ${r.name}`));
                } else {
                    console.log(`  No matching rotations found.`);
                }
                db.close();
                resolve();
            });
        });
    }
}

search();
