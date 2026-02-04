const sqlite3 = require('sqlite3').verbose();
const dbPath = 'j:/YT Generator video/database/data.db';
const db = new sqlite3.Database(dbPath);

console.log(`Inspecting DB: ${dbPath}`);

db.serialize(() => {
    db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, tables) => {
        if (err) {
            console.error(err);
            return;
        }
        console.log("Tables:", tables.map(t => t.name).join(", "));

        tables.forEach(table => {
            const tableName = table.name;
            db.all(`PRAGMA table_info(${tableName})`, (err, info) => {
                if (err) return;
                const columns = info.map(c => c.name);
                const hasChannel = columns.some(c => c.toLowerCase().includes('channel'));
                const hasName = columns.some(c => c.toLowerCase().includes('name'));

                if (hasChannel || hasName) {
                    db.all(`SELECT * FROM ${tableName} WHERE ` + columns.map(c => `${c} LIKE '%LATIN%'`).join(' OR ') + " LIMIT 5", (err, rows) => {
                        if (!err && rows && rows.length > 0) {
                            console.log(`Matches in ${tableName}:`, JSON.stringify(rows, null, 2));
                        }
                    });
                }
            });
        });
    });
});
