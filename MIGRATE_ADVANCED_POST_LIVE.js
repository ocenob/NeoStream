
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'db', 'database.db');
const db = new sqlite3.Database(dbPath);

const tables = ['rotation_items', 'streams'];
const newColumns = [
    { name: 'post_live_delay_days', type: 'INTEGER DEFAULT 0' },
    { name: 'post_live_ctr_threshold', type: 'FLOAT DEFAULT 0.0' },
    { name: 'post_live_sync_status', type: "TEXT DEFAULT 'pending'" },
    { name: 'target_sync_date', type: 'TEXT' }
];

db.serialize(() => {
    tables.forEach(table => {
        newColumns.forEach(col => {
            db.run(`ALTER TABLE ${table} ADD COLUMN ${col.name} ${col.type}`, (err) => {
                if (err) {
                    if (err.message.includes('duplicate column name')) {
                        console.log(`Column ${col.name} already exists in ${table}`);
                    } else {
                        console.error(`Error adding ${col.name} to ${table}:`, err.message);
                    }
                } else {
                    console.log(`Successfully added ${col.name} to ${table}`);
                }
            });
        });
    });
});

setTimeout(() => {
    db.close();
    console.log("Migration Advanced Post-Live finished.");
}, 3000);
