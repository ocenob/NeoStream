const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

/**
 * NUCLEAR FRESH START SCRIPT (SIKAT SEMUA!)
 * This script will DELETE ALL ENTRIES from:
 * - youtube_channels (Semua channel terhubung)
 * - stream_rotations & rotation_items (Semua jadwal)
 * - streams & stream_history (Semua riwayat live)
 * - videos, thumbnails & playlists (Semua media metadata)
 * 
 * NOTE: Ini hanya menghapus di database. File fisik (.mp4) tidak dihapus.
 */

// 1. Detect DB Path
let dbPath = path.join(__dirname, 'data', 'streamflow.db');
if (!fs.existsSync(dbPath)) {
    dbPath = path.join(__dirname, 'data', 'neostream.db');
}
if (!fs.existsSync(dbPath)) {
    console.error('Could not find database at ./data/streamflow.db or ./data/neostream.db');
    process.exit(1);
}

const db = new sqlite3.Database(dbPath);

const tablesToClear = [
    'youtube_channels',
    'stream_rotations',
    'rotation_items',
    'streams',
    'videos',
    'thumbnails',
    'playlists',
    'playlist_items',
    'stream_history'
];

async function nuke() {
    console.log(`\n[NUCLEAR] Database: ${dbPath}`);
    console.log('--- STARTING WIPE ---');

    for (const table of tablesToClear) {
        await new Promise((resolve) => {
            db.run(`DELETE FROM ${table}`, [], (err) => {
                if (err) {
                    console.error(`- Error clearing ${table}:`, err.message);
                } else {
                    console.log(`- Cleared table: ${table} ✅`);
                }
                resolve();
            });
        });
    }

    // Optional: Reset sequences if using AUTOINCREMENT (SQLite)
    await new Promise((resolve) => {
        db.run("DELETE FROM sqlite_sequence", [], resolve);
    });

    console.log('\n[NUCLEAR] BERHASIL! Database sudah bersih total. 🧹✨');
    console.log('Silakan restart app (pm2 restart) lalu Login & Koneksikan Channel baru.');
    db.close();
}

// Confirmation Check (Safety)
console.log('CAUTION: This will delete ALL data in your database.');
console.log('Press Ctrl+C to abort or wait 5 seconds to proceed...');

setTimeout(nuke, 5000);
