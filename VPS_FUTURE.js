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

db.all("SELECT * FROM streams WHERE status = 'scheduled' ORDER BY schedule_time ASC", (err, streams) => {
    if (err) {
        console.error('❌ Query Error:', err.message);
        return;
    }

    // Filter for truly future streams (in case server time drift affects query)
    const futureStreams = streams.filter(s => {
        const schedTime = new Date(s.schedule_time);
        return schedTime > now;
    });

    console.log(`\nFound ${futureStreams.length} upcoming streams.`);

    if (futureStreams.length === 0) {
        console.log('⚠️ No future streams found. Check if rotations are active.');
    } else {
        console.log('\n--- UPCOMING SCHEDULE & OPTIMIZATION STATUS ---');
        console.log('---------------------------------------------------------------------------------');
        console.log('| Time (Local)        | Optimization (Copy) | Title');
        console.log('---------------------------------------------------------------------------------');

        futureStreams.forEach(s => {
            const schedTime = new Date(s.schedule_time);
            const timeStr = schedTime.toLocaleString();

            // CHECK LOGIC: 
            // If use_advanced_settings is 0 (false), our Code Fix (Opsi A) will use "-c copy".
            // If use_advanced_settings is 1 (true), it might re-encode (High CPU).
            const isOptimized = !s.use_advanced_settings;
            const optStatus = isOptimized ? '✅ YES (Low CPU)' : '❌ NO (Re-encode)';

            // Truncate title for display
            let title = s.title || 'No Title';
            if (title.length > 40) title = title.substring(0, 37) + '...';

            console.log(`| ${timeStr.padEnd(19)} | ${optStatus.padEnd(19)} | ${title}`);
        });
        console.log('---------------------------------------------------------------------------------');
    }

    db.close();
});
