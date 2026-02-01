const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

/**
 * ROTATION MIGRATION SCRIPT
 * Use this to move rotations from one channel record to another.
 * Usage: node MIGRATE_ROTATIONS.js "Old Channel Name" "New Channel Name"
 */

const sourceName = process.argv[2];
const targetName = process.argv[3];

if (!sourceName || !targetName) {
    console.log('Usage: node MIGRATE_ROTATIONS.js "Old Name" "New Name"');
    console.log('Example: node MIGRATE_ROTATIONS.js "Epic Moments" "Reggaeton Vibes"');
    process.exit(1);
}

// 1. Detect DB Path
let dbPath = path.join(__dirname, 'data', 'streamflow.db');
if (!fs.existsSync(dbPath)) {
    dbPath = path.join(__dirname, 'data', 'neostream.db');
}
const db = new sqlite3.Database(dbPath);

async function migrate() {
    console.log(`\n[MIGRATE] Database: ${dbPath}`);

    // Find Source ID
    const source = await new Promise((resolve) => {
        db.get('SELECT id FROM youtube_channels WHERE channel_name LIKE ?', [`%${sourceName}%`], (err, row) => resolve(row));
    });

    // Find Target ID
    const target = await new Promise((resolve) => {
        db.get('SELECT id FROM youtube_channels WHERE channel_name LIKE ?', [`%${targetName}%`], (err, row) => resolve(row));
    });

    if (!source) {
        console.error(`Error: Could not find source channel matching "${sourceName}"`);
        process.exit(1);
    }
    if (!target) {
        console.error(`Error: Could not find target channel matching "${targetName}"`);
        console.log('Please ensure you have added the target channel in the Settings first!');
        process.exit(1);
    }

    console.log(`Source ID: ${source.id} (${sourceName})`);
    console.log(`Target ID: ${target.id} (${targetName})`);

    // Update Rotations
    const result = await new Promise((resolve) => {
        db.run('UPDATE stream_rotations SET youtube_channel_id = ? WHERE youtube_channel_id = ?',
            [target.id, source.id], function (err) {
                resolve({ changes: this.changes, err });
            });
    });

    if (result.err) {
        console.error('Migration failed:', result.err);
    } else {
        console.log(`\n[SUCCESS] Berhasil memindahkan ${result.changes} rotasi ke "${targetName}"! 🚀`);
        console.log('Sekarang silakan cek dashboard channel target.');
    }

    db.close();
}

migrate();
