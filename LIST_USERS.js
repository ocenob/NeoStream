const sqlite3 = require('sqlite3').verbose();
const dbPath = 'j:/neostream/db/database.db';
const db = new sqlite3.Database(dbPath);

db.all("SELECT * FROM users", (err, rows) => {
    if (err) {
        console.error(err);
    } else {
        console.log("Users in database.db:", JSON.stringify(rows, null, 2));
    }
    db.close();
});
