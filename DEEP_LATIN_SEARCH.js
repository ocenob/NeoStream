const sqlite3 = require('sqlite3').verbose();
const dbPath = 'j:/neostream/data/streamflow.db';
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, tables) => {
        if (err) { console.error(err.message); return; }
        tables.forEach(table => {
            const tableName = table.name;
            db.all(`PRAGMA table_info(${tableName})`, (err, columns) => {
                if (err) return;
                columns.forEach(column => {
                    const colName = column.name;
                    db.all(`SELECT * FROM ${tableName} WHERE ${colName} LIKE '%LATIN%'`, (err, rows) => {
                        if (!err && rows && rows.length > 0) {
                            console.log(`MATCH In Table: ${tableName}, Column: ${colName}`);
                            console.log(rows);
                        }
                    });
                });
            });
        });
    });
});
