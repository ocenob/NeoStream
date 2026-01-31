const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

/**
 * VPS THUMBNAIL CLEANER (SIKAT GAMBAR!)
 * This script deletes all thumbnails for a specific channel
 * from both the filesystem and the database.
 */

// 1. Detect DB Path
let dbPath = path.join(__dirname, 'data', 'neostream.db');
if (!fs.existsSync(dbPath)) {
    dbPath = path.join(__dirname, 'data', 'streamflow.db');
}
if (!fs.existsSync(dbPath)) {
    console.error('Could not find database at ./data/neostream.db or ./data/streamflow.db');
    process.exit(1);
}

const db = new sqlite3.Database(dbPath);
const channelId = 'ce7b965e-34e7-469a-b9ba-210b9fe1a2ad';

async function runClean() {
    console.log(`\n[SIKAT!] Database detected: ${dbPath}`);
    console.log(`[SIKAT!] Target Channel ID: ${channelId}\n`);

    // A. Get files to delete
    const thumbnails = await new Promise((resolve) => {
        db.all('SELECT id, filepath FROM thumbnails WHERE youtube_channel_id = ?', [channelId], (err, rows) => {
            if (err) {
                console.error(err);
                resolve([]);
            } else {
                resolve(rows || []);
            }
        });
    });

    if (thumbnails.length === 0) {
        console.log('No thumbnails found for this channel.');
        db.close();
        return;
    }

    console.log(`Found ${thumbnails.length} thumbnails to delete...`);

    // B. Delete files
    let deletedCount = 0;
    for (const t of thumbnails) {
        if (t.filepath) {
            const fullPath = path.join(__dirname, 'public', t.filepath);
            try {
                if (fs.existsSync(fullPath)) {
                    fs.unlinkSync(fullPath);
                    // process.stdout.write('.');
                }
            } catch (e) {
                console.error(`Failed to delete file: ${fullPath}`, e.message);
            }
        }
        deletedCount++;
    }
    console.log(`\nFiles cleaned up.`);

    // C. Delete DB records
    await new Promise((resolve, reject) => {
        db.run('DELETE FROM thumbnails WHERE youtube_channel_id = ?', [channelId], function (err) {
            if (err) {
                console.error('DB Delete Error:', err);
                reject(err);
            } else {
                console.log(`Removed ${this.changes} records from database.`);
                resolve();
            }
        });
    });

    console.log('\n[SIKAT!] BERHASIL! Semua thumbnail channel ini sudah dibersihkan.');
    db.close();
}

runClean();
