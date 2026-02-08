const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('J:/neostream/data/neostream.db');

const columns = [
    { name: 'post_live_delay_days', type: 'INTEGER DEFAULT 0' },
    { name: 'post_live_ctr_threshold', type: 'FLOAT DEFAULT 0.0' },
    { name: 'post_live_sync_status', type: "TEXT DEFAULT 'pending'" },
    { name: 'target_sync_date', type: 'TEXT' }
];

db.serialize(() => {
    columns.forEach(col => {
        db.run(`ALTER TABLE streams ADD COLUMN ${col.name} ${col.type}`, (err) => {
            if (err) {
                if (err.message.includes('duplicate column name')) {
                    console.log(`✓ Column ${col.name} already exists`);
                } else {
                    console.error(`✗ Error adding ${col.name}:`, err.message);
                }
            } else {
                console.log(`✓ Added ${col.name}`);
            }
        });
    });
});

setTimeout(() => {
    db.all('PRAGMA table_info(streams)', (err, rows) => {
        console.log('\n=== FINAL RESULT ===');
        console.log('Total columns:', rows.length);
        db.close();
        process.exit(0);
    });
}, 2000);
