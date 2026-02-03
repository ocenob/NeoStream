const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

console.log('--- CHECKING FUTURE SCHEDULE & OPTIMIZATION (VPS) ---');

// 1. Detect DB Path (Priority: streamflow.db -> neostream.db)
let dbPath = path.join(__dirname, 'data', 'streamflow.db');
if (!fs.existsSync(dbPath)) {
    dbPath = path.join(__dirname, 'data', 'neostream.db');
}
if (!fs.existsSync(dbPath)) {
    // Fallback for older structures
    dbPath = path.join(__dirname, 'db', 'database.db');
}

if (!fs.existsSync(dbPath)) {
    console.error('❌ ERROR: Could not find database file.');
    console.log('Checked paths:');
    console.log(`- ${path.join(__dirname, 'data', 'streamflow.db')}`);
    console.log(`- ${path.join(__dirname, 'data', 'neostream.db')}`);
    process.exit(1);
}

console.log(`✅ Using Database: ${dbPath}`);

const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
const now = new Date();
console.log(`🕒 Server Time: ${now.toLocaleString()}`);

// Check Future ROTATIONS (Recurring Schedule)
db.all("SELECT * FROM stream_rotations WHERE status = 'active' ORDER BY start_time ASC", (err, rotations) => {
    if (err) {
        console.error('❌ Query Error:', err.message);
        return;
    }

    const upcoming = rotations.filter(r => {
        // Show all active rotations
        return true;
    });

    console.log(`\nFound ${upcoming.length} active rotations.`);

    if (upcoming.length === 0) {
        console.log('⚠️ No active rotations found.');
    } else {
        console.log('\n--- ACTIVE ROTATION SCHEDULE (VPS) ---');
        console.log('---------------------------------------------------------------------------------------------------------');
        console.log('| Start Time (Local)      | End Time (Local)        | Repeat  | Name');
        console.log('---------------------------------------------------------------------------------------------------------');

        upcoming.sort((a, b) => new Date(a.start_time) - new Date(b.start_time));

        upcoming.forEach(r => {
            const start = new Date(r.start_time).toLocaleString();
            const end = new Date(r.end_time).toLocaleString();

            let name = r.name || 'No Name';
            if (name.length > 30) name = name.substring(0, 27) + '...';

            console.log(`| ${start.padEnd(23)} | ${end.padEnd(23)} | ${r.repeat_mode.padEnd(7)} | ${name}`);
        });
        console.log('---------------------------------------------------------------------------------------------------------');
        console.log('ℹ️ NOTE: Based on codebase, ALL Rotations are hardcoded to use "Low CPU" (Copy Mode).');
    }

    db.close();
});
