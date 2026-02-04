const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbs = [
    'j:/neostream/data/neostream.db',
    'j:/neostream/data/streamflow.db',
    'j:/neostream/data/database.db',
    'j:/neostream/db/database.db',
    'j:/neostreampro/data/neostream.db',
    'j:/neostreampro/data/streamflow.db',
    'j:/stramingo/stramingo.db',
    'j:/Streamingo-/streamingo.db'
];

dbs.forEach(dbPath => {
    if (!fs.existsSync(dbPath)) return;
    const db = new sqlite3.Database(dbPath);

    db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, tables) => {
        if (err || !tables) { db.close(); return; }

        tables.forEach(table => {
            const tableName = table.name;
            db.all(`SELECT * FROM ${tableName} LIMIT 100`, (err, rows) => {
                if (err || !rows) return;
                rows.forEach(row => {
                    const str = JSON.stringify(row);
                    if (str.includes('ROMANTIC') || str.includes('BACHATA')) {
                        console.log(`MATCH in DB: ${dbPath}, Table: ${tableName}`);
                        console.log(`  Row: ${str.substring(0, 100)}...`);
                    }
                });
            });
        });
        // We'll close later or just let it finish
    });
});
