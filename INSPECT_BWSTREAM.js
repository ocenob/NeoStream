const sqlite3 = require('sqlite3').verbose();
const dbPath = 'j:/bwstream-bluk-jadwal/db/streamflow.db';
if (!require('fs').existsSync(dbPath)) { console.log("DB NOT FOUND"); process.exit(0); }
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, tables) => {
        if (err) { console.error(err.message); return; }
        console.log("Tables:", tables.map(t => t.name).join(', '));
        tables.forEach(table => {
            const tableName = table.name;
            db.all(`SELECT * FROM ${tableName} LIMIT 10`, (err, rows) => {
                if (!err && rows && rows.length > 0) {
                    console.log(`--- Row in ${tableName} ---`);
                    console.log(rows[0]);
                }
            });
        });
    });
});
