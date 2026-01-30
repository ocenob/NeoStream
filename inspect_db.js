const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./data/neostream.db');

db.all("SELECT id, title, start_time, end_time, status, youtube_channel_id FROM streams WHERE start_time LIKE '2026-01-30%' OR created_at LIKE '2026-01-30%'", [], (err, rows) => {
    if (err) {
        console.error(err.message);
        return;
    }
    console.table(rows);
    db.close();
});
