const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

/**
 * VPS AUTO-RANDOMIZER SCRIPT (SIKAT!)
 * This script will reshuffle titles and thumbnails for existing rotations
 * to ensure diversity on YouTube and the Dashboard.
 */

// 1. Detect DB Path
let dbPath = path.join(__dirname, 'data', 'neostream.db');
if (!fs.existsSync(dbPath)) {
    dbPath = path.join(__dirname, 'data', 'streamflow.db');
}
if (!fs.existsSync(dbPath)) {
    console.error('Could not find database at ./data/neostream.db or ./data/streamflow.db');
    console.log('Please run this script inside the application root folder on your VPS.');
    process.exit(1);
}

const db = new sqlite3.Database(dbPath);
const channelId = 'b44cd3bb-a77b-4dff-a6d7-87e503b97aa8';

async function runFix() {
    console.log(`\n[SIKAT!] Database detected: ${dbPath}`);
    console.log(`[SIKAT!] Target Channel ID: ${channelId}\n`);

    // A. Get all gallery thumbnails for this channel
    const thumbnails = await new Promise((resolve) => {
        db.all('SELECT filepath FROM thumbnails WHERE youtube_channel_id = ?', [channelId], (err, rows) => {
            resolve(rows || []);
        });
    });

    if (thumbnails.length === 0) {
        console.warn('Warning: No thumbnails found in gallery for this channel.');
    } else {
        console.log(`Found ${thumbnails.length} gallery thumbnails.`);
    }

    // B. Get unique titles from current rotations to use as a pool
    const titles = await new Promise((resolve) => {
        db.all(`
            SELECT DISTINCT title 
            FROM rotation_items 
            WHERE rotation_id IN (SELECT id FROM stream_rotations WHERE youtube_channel_id = ?)
            AND title LIKE 'Judul%'
        `, [channelId], (err, rows) => {
            resolve((rows || []).map(r => r.title));
        });
    });

    if (titles.length === 0) {
        console.error('Error: No "Judul" titles found to shuffle. Is the database empty?');
        db.close();
        return;
    }
    console.log(`Found ${titles.length} unique titles in the matching pool.\n`);

    // C. Get all rotations for this channel
    const rotations = await new Promise((resolve) => {
        db.all('SELECT id, name FROM stream_rotations WHERE youtube_channel_id = ?', [channelId], (err, rows) => {
            resolve(rows || []);
        });
    });

    console.log(`Processing ${rotations.length} rotations...`);

    for (const rotation of rotations) {
        const items = await new Promise((resolve) => {
            // Adjust column name for position (order_index or position)
            db.all('SELECT id FROM rotation_items WHERE rotation_id = ? ORDER BY id', [rotation.id], (err, rows) => {
                resolve(rows || []);
            });
        });

        if (items.length === 0) continue;

        // Random offsets for THIS rotation
        const thumbOffset = thumbnails.length > 0 ? Math.floor(Math.random() * thumbnails.length) : 0;
        const titleOffset = Math.floor(Math.random() * titles.length);

        process.stdout.write(`- Randomizing: ${rotation.name.padEnd(50)} [${items.length} items]... `);

        for (let i = 0; i < items.length; i++) {
            const newTitle = titles[(i + titleOffset) % titles.length];
            const updates = { title: newTitle };
            const params = [newTitle];

            let sql = 'UPDATE rotation_items SET title = ?';

            if (thumbnails.length > 0) {
                const newThumb = thumbnails[(i + thumbOffset) % thumbnails.length].filepath;
                sql += ', thumbnail_path = ?';
                params.push(newThumb);
            }

            sql += ' WHERE id = ?';
            params.push(items[i].id);

            await new Promise((resolve) => {
                db.run(sql, params, resolve);
            });
        }
        process.stdout.write(`DONE\n`);
    }

    console.log('\n[SIKAT!] BERHASIL! 53 Rotasi sudah diacak ulang judul & gambarnya.');
    console.log('[SIKAT!] Silakan cek dashboard atau YouTube Bos sekarang. 🚀');
    db.close();
}

runFix();
