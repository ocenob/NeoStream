const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

/**
 * JITTER FIXER for EXISTING ROTATIONS
 * This script randomizes the "Minutes" of existing rotations to prevent 
 * simultaneous starts that cause server hangs and YouTube API errors.
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

async function runJitterFix() {
    console.log(`\n[JITTER] Database: ${dbPath}`);

    const rotations = await new Promise((resolve) => {
        db.all('SELECT id, name, start_time, end_time FROM stream_rotations WHERE status = "active"', [], (err, rows) => {
            resolve(rows || []);
        });
    });

    console.log(`Updating ${rotations.length} active rotations...`);

    for (const rotation of rotations) {
        if (!rotation.start_time) continue;

        // Current time: YYYY-MM-DDTHH:mm:ss
        const startTime = new Date(rotation.start_time.replace(' ', 'T'));
        const endTime = new Date(rotation.end_time.replace(' ', 'T'));

        if (isNaN(startTime.getTime())) continue;

        // Add random jitter 0-55 minutes
        const jitterMinutes = Math.floor(Math.random() * 55);

        // Stagger the minutes
        startTime.setMinutes(jitterMinutes);
        startTime.setSeconds(Math.floor(Math.random() * 60));

        // Keep duration the same by shifting end time too
        const durationMs = endTime.getTime() - new Date(rotation.start_time.replace(' ', 'T')).getTime();
        const newEndTime = new Date(startTime.getTime() + durationMs);

        const toLocalISO = (d) => {
            const pad = (n) => n.toString().padStart(2, '0');
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        };

        const finalStart = toLocalISO(startTime);
        const finalEnd = toLocalISO(newEndTime);

        console.log(`- Staggering: [${rotation.name}] -> Start at :${pad(jitterMinutes)}`);

        await new Promise((resolve) => {
            db.run('UPDATE stream_rotations SET start_time = ?, end_time = ? WHERE id = ?',
                [finalStart, finalEnd, rotation.id], resolve);
        });
    }

    function pad(n) { return n.toString().padStart(2, '0'); }

    console.log('\n[JITTER] BERHASIL! Jadwal rotasi sudah disebar (Staggered). 🚀');
    console.log('Sekarang silakan restart PM2 untuk melihat hasilnya.');
    db.close();
}

runJitterFix();
