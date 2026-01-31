const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

const dbs = [
    'j:/neostream/data/neostream.db',
    'j:/neostream/data/streamflow.db',
    'j:/neostreampro/data/streamflow.db',
    'j:/neostreampro/db/database.db'
];

const targetId = '6060dbc8-6aad-4e24-8672-75a4425e831d';

async function search() {
    for (const dbPath of dbs) {
        if (!fs.existsSync(dbPath)) continue;
        const db = new sqlite3.Database(dbPath);
        await new Promise((resolve) => {
            db.get("SELECT name FROM stream_rotations WHERE id = ?", [targetId], (err, row) => {
                if (row) {
                    console.log(`FOUND ID ${targetId} in ${dbPath}! Rotation Name: ${row.name}`);
                }
                db.close();
                resolve();
            });
        });
    }
}

search();
