const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

console.log('--- DIAGNOSE ROTATIONS VPS ---');

// 1. Detect DB Path
let dbPath = path.join(__dirname, 'data', 'neostream.db');
if (!fs.existsSync(dbPath)) {
    dbPath = path.join(__dirname, 'data', 'streamflow.db');
}
if (!fs.existsSync(dbPath)) {
    console.error('Could not find database.');
    process.exit(1);
}
console.log(`DB: ${dbPath}`);

const db = new sqlite3.Database(dbPath);
const channelNameQuery = 'Reggaeton'; // Flexible match

db.serialize(() => {
    // A. Find Channel
    db.all("SELECT * FROM youtube_channels", (err, channels) => {
        const match = channels.find(c => c.channel_name && c.channel_name.includes(channelNameQuery));
        if (!match) {
            console.log(`No channel found containing '${channelNameQuery}'`);
            return;
        }
        console.log(`Channel Found: ${match.channel_name} (${match.id})`);

        // B. Check Active Rotations
        db.all("SELECT * FROM stream_rotations WHERE youtube_channel_id = ?", [match.id], (err, rots) => {
            console.log(`\nTotal Rotations: ${rots.length}`);
            if (rots.length === 0) console.log('Warning: No rotations found. Did you use "Auto Schedule" (Streams) instead of "Batch Rotation"?');

            rots.forEach(r => {
                console.log(`\nID: ${r.id}`);
                console.log(`Name: ${r.name}`);
                console.log(`Status: ${r.status}`);
                console.log(`Mode: ${r.repeat_mode}`);
                console.log(`Start: ${r.start_time}`);
                console.log(`End: ${r.end_time}`);

                // Check items
                db.get("SELECT COUNT(*) as cnt FROM rotation_items WHERE rotation_id = ?", [r.id], (e, row) => {
                    console.log(`Items: ${row ? row.cnt : 0}`);
                });
            });
        });

        // C. Check Streams (One-off) history
        db.all("SELECT * FROM streams WHERE youtube_channel_id = ? ORDER BY start_time DESC LIMIT 5", [match.id], (err, streams) => {
            console.log('\nLast 5 Streams (One-off/Generated):');
            streams.forEach(s => {
                console.log(`- ${s.title} [${s.status}] (${s.start_time})`);
            });
        });
    });
});
