
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPaths = [
    'j:/neostream/data/neostream.db',
    'j:/neostream/data/streamflow.db',
    'j:/neostream/db/database.db'
];

async function checkActiveStreams() {
    console.log("Checking for active streams in all databases...");

    for (const dbPath of dbPaths) {
        if (!fs.existsSync(dbPath)) continue;

        console.log(`\n--- Checking Database: ${dbPath} ---`);
        const db = new sqlite3.Database(dbPath);

        await new Promise((resolve) => {
            db.all(`
                SELECT s.*, yc.channel_name 
                FROM streams s
                LEFT JOIN youtube_channels yc ON s.youtube_channel_id = yc.id
                WHERE s.status = 'live' OR s.status = 'starting'
            `, (err, rows) => {
                if (err) {
                    console.error(`Error reading ${dbPath}:`, err.message);
                } else if (rows && rows.length > 0) {
                    rows.forEach(row => {
                        console.log(`[LIVE FOUND] ID: ${row.id}`);
                        console.log(` Title: ${row.title}`);
                        console.log(` Channel: ${row.channel_name}`);
                        console.log(` Status: ${row.status}`);
                        console.log(` YouTube Broadcast ID: ${row.youtube_broadcast_id}`);
                        console.log(` Scheduled Time: ${row.schedule_time}`);
                        console.log(`-----------------------------------`);
                    });
                } else {
                    console.log("No active/starting streams found.");
                }
                db.close();
                resolve();
            });
        });
    }
}

checkActiveStreams();
