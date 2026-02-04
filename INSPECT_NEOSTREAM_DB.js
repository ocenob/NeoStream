const sqlite3 = require('sqlite3').verbose();
const dbPath = 'j:/neostream/data/neostream.db';
if (!require('fs').existsSync(dbPath)) { console.log("neostream.db NOT FOUND"); process.exit(0); }
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, tables) => {
        if (err) { console.error(err); return; }
        console.log("Tables in neostream.db:", tables.map(t => t.name).join(", "));

        db.all("SELECT * FROM youtube_channels", (err, channels) => {
            if (!err) console.log("Channels:", JSON.stringify(channels, null, 2));
        });

        db.all("SELECT COUNT(*) as count FROM thumbnails", (err, row) => {
            if (!err) console.log("Thumbnail count:", row[0].count);
        });
    });
});
