const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

function findFiles(dir, ext, fileList = []) {
    try {
        const files = fs.readdirSync(dir);
        files.forEach(file => {
            const filePath = path.join(dir, file);
            if (fs.statSync(filePath).isDirectory() && file !== 'node_modules' && file !== '.git') {
                findFiles(filePath, ext, fileList);
            } else {
                if (path.extname(file) === ext) fileList.push(filePath);
            }
        });
    } catch (e) { }
    return fileList;
}

const dbFiles = findFiles(__dirname, '.db');
console.log('Found DB files:', dbFiles);

dbFiles.forEach(dbPath => {
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
    db.all("SELECT * FROM youtube_channels", (err, channels) => {
        if (!channels) return;

        const match = channels.find(c => c.channel_name && c.channel_name.includes('Reggaeton'));
        if (match) {
            console.log(`\n!!! FOUND REGGAETON IN ${dbPath} !!!`);
            console.log('Channel:', match.channel_name, match.id);

            // Check Streams (One-off)
            db.all("SELECT * FROM streams WHERE youtube_channel_id = ?", [match.id], (err, streams) => {
                console.log(`\nStreams count: ${streams.length}`);
                const offline = streams.filter(s => s.status === 'offline');
                const scheduled = streams.filter(s => s.status === 'scheduled');
                console.log(`- Offline: ${offline.length}`);
                console.log(`- Scheduled: ${scheduled.length}`);

                // Show sample of offline
                if (offline.length > 0) {
                    console.log('Sample Offline Streams:');
                    offline.slice(0, 3).forEach(s => console.log(`  [${s.id}] ${s.title} (Start: ${s.start_time})`));
                }
            });

            // Check Rotations (Recurring)
            db.all("SELECT * FROM stream_rotations WHERE youtube_channel_id = ?", [match.id], (err, rots) => {
                console.log(`\nRotations count: ${rots.length}`);
                rots.forEach(r => {
                    console.log(`[${r.repeat_mode}] ${r.name} (Status: ${r.status})`);
                });
            });
        }
    });
});
