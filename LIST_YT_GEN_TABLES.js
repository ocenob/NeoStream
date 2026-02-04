const sqlite3 = require('sqlite3').verbose();
const dbPath = 'j:/YT Generator video/database/data.db';
const db = new sqlite3.Database(dbPath);

db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, rows) => {
    if (err) {
        console.error(err.message);
        return;
    }
    console.log("Tables in YT Generator video/database/data.db:");
    console.log(rows.map(r => r.name).join(', '));
    db.close();
});
