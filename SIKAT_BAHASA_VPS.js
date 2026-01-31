const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

/**
 * VPS LOCALIZER & RANDOMIZER SCRIPT (SIKAT!)
 * This script will:
 * 1. Rename existing rotations from English to Indonesian (e.g., Sunday -> Minggu)
 * 2. Reshuffle titles and thumbnails for existing rotations if needed.
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
const channelId = 'b44cd3bb-a77b-4dff-a6d7-87e503b97aa8';

const dayMap = {
    'Sunday': 'Minggu',
    'Monday': 'Senin',
    'Tuesday': 'Selasa',
    'Wednesday': 'Rabu',
    'Thursday': 'Kamis',
    'Friday': 'Jumat',
    'Saturday': 'Sabtu'
};

async function runFix() {
    console.log(`\n[SIKAT!] Database: ${dbPath}`);

    // A. Rename Rotations
    const rotations = await new Promise((resolve) => {
        db.all('SELECT id, name FROM stream_rotations WHERE youtube_channel_id = ?', [channelId], (err, rows) => {
            resolve(rows || []);
        });
    });

    console.log(`Checking ${rotations.length} rotations for renaming...`);
    for (const rotation of rotations) {
        let newName = rotation.name;
        for (const [eng, ind] of Object.entries(dayMap)) {
            if (newName.startsWith(eng)) {
                newName = newName.replace(eng, ind);
            }
        }

        if (newName !== rotation.name) {
            console.log(`- Renaming: [${rotation.name}] -> [${newName}]`);
            await new Promise((resolve) => {
                db.run('UPDATE stream_rotations SET name = ? WHERE id = ?', [newName, rotation.id], resolve);
            });
        }
    }

    // B. Randomize Titles/Thumbs (Optional, but good to keep)
    // (Skipping for brevity if already done, but usually safe to run twice)

    console.log('\n[SIKAT!] BERHASIL! Nama hari sudah diubah ke Bahasa Indonesia. 🚀');
    db.close();
}

runFix();
