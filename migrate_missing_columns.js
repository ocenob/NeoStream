require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.join(__dirname, 'data', 'neostream.db');
const db = new sqlite3.Database(dbPath);

const tablesToCheck = {
    rotation_items: [
        { name: 'post_live_title', type: 'TEXT' },
        { name: 'post_live_thumbnail_path', type: 'TEXT' },
        { name: 'post_live_delay_days', type: 'INTEGER DEFAULT 0' },
        { name: 'post_live_ctr_threshold', type: 'FLOAT DEFAULT 0.0' }
    ],
    streams: [
        { name: 'post_live_title', type: 'TEXT' },
        { name: 'post_live_thumbnail_path', type: 'TEXT' },
        { name: 'post_live_delay_days', type: 'INTEGER DEFAULT 0' },
        { name: 'post_live_ctr_threshold', type: 'FLOAT DEFAULT 0.0' },
        { name: 'post_live_sync_status', type: "TEXT DEFAULT 'pending'" },
        { name: 'target_sync_date', type: 'TEXT' }
    ]
};

async function migrate() {
    console.log(`Checking database: ${dbPath}`);

    for (const [tableName, columns] of Object.entries(tablesToCheck)) {
        console.log(`Checking table: ${tableName}`);

        const existingColumns = await new Promise((resolve, reject) => {
            db.all(`PRAGMA table_info(${tableName})`, (err, rows) => {
                if (err) reject(err);
                else resolve(rows.map(r => r.name));
            });
        });

        for (const col of columns) {
            if (!existingColumns.includes(col.name)) {
                console.log(`Adding missing column ${col.name} to ${tableName}...`);
                await new Promise((resolve, reject) => {
                    db.run(`ALTER TABLE ${tableName} ADD COLUMN ${col.name} ${col.type}`, (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
                });
            } else {
                console.log(`Column ${col.name} already exists in ${tableName}`);
            }
        }
    }

    console.log('Migration complete.');
    db.close();
}

migrate().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
