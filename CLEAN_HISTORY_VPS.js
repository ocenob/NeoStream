const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

console.log('--- 🧹 CLEANING UP OLD HISTORY (VPS) ---');

// 1. Detect DB Path
let dbPath = path.join(__dirname, 'data', 'streamflow.db');
if (!fs.existsSync(dbPath)) {
    dbPath = path.join(__dirname, 'data', 'neostream.db');
}
if (!fs.existsSync(dbPath)) {
    dbPath = path.join(__dirname, 'db', 'database.db');
}

if (!fs.existsSync(dbPath)) {
    console.error('❌ ERROR: Could not find database file.');
    process.exit(1);
}

console.log(`✅ Using Database: ${dbPath}`);

const db = new sqlite3.Database(dbPath);
const DAYS_TO_KEEP = 2; // Hapus yang lebih tua dari 2 hari

// Hitung tanggal batas (cutoff)
const cutoffDate = new Date();
cutoffDate.setDate(cutoffDate.getDate() - DAYS_TO_KEEP);
const cutoffStr = cutoffDate.toISOString();

console.log(`📅 Cutoff Date: ${cutoffStr} (Older than this will be deleted)`);

db.serialize(() => {
    // Cek dulu berapa yang bakal dihapus
    const queryCheck = `SELECT COUNT(*) as count FROM streams WHERE (status='ended' OR status='stopped' OR status='offline') AND end_time < ?`;

    db.get(queryCheck, [cutoffStr], (err, row) => {
        if (err) {
            console.error('❌ Error Check:', err.message);
            return;
        }

        const count = row.count;
        if (count === 0) {
            console.log('✨ Database is clean! No old history found.');
            return;
        }

        console.log(`🗑️  Found ${count} old streams. Deleting...`);

        // Eksekusi Hapus
        const queryDelete = `DELETE FROM streams WHERE (status='ended' OR status='stopped' OR status='offline') AND end_time < ?`;
        db.run(queryDelete, [cutoffStr], function (err) {
            if (err) {
                console.error('❌ Error Delete:', err.message);
            } else {
                console.log(`✅ SUCCESS! Deleted ${this.changes} rows.`);
                console.log('   Dashboard should look cleaner now.');
            }
        });
    });
});
