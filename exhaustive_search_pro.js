const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join('j:', 'neostreampro', 'data', 'streamflow.db');
const db = new sqlite3.Database(dbPath);

console.log('Searching in:', dbPath);

db.all("SELECT name FROM sqlite_master WHERE type='table'", [], async (err, tables) => {
    if (err) {
        console.error(err);
        process.exit(1);
    }

    if (!tables) return;

    for (const table of tables) {
        const tableName = table.name;
        db.all(`PRAGMA table_info(${tableName})`, [], (err, columns) => {
            if (err) return;

            db.all(`SELECT * FROM ${tableName}`, [], (err, rows) => {
                if (err || !rows) return;

                rows.forEach(row => {
                    const rowStr = JSON.stringify(row);
                    if (rowStr.toLowerCase().includes('test rotation')) {
                        console.log(`FOUND in table ${tableName}:`, row);
                    }
                });
            });
        });
    }
});
