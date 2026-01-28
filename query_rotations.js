const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, 'data', 'streamflow.db');
const db = new sqlite3.Database(dbPath);

console.log('Using database:', dbPath);

db.all("SELECT name FROM sqlite_master WHERE type='table'", [], (err, tables) => {
    if (err) {
        console.error(err);
        process.exit(1);
    }
    console.log('Tables:', tables.map(t => t.name).join(', '));

    if (tables.find(t => t.name === 'stream_rotations')) {
        db.all("SELECT * FROM stream_rotations", [], (err, rows) => {
            if (err) console.error(err);
            console.log('Rotations:', JSON.stringify(rows, null, 2));

            // Check playlist audios
            db.all("SELECT * FROM playlist_audios", [], (err, audios) => {
                if (err) console.error(err);
                console.log('Playlist Audios:', JSON.stringify(audios, null, 2));
                db.close();
            });

        });
    } else {
        console.log('Table stream_rotations NOT FOUND');
        db.close();
    }
});
