
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = 'j:/neostream/db/database.db';
const db = new sqlite3.Database(dbPath);

const tables = ['rotation_items', 'streams'];
const columns = [
    { name: 'post_live_title', type: 'TEXT' },
    { name: 'post_live_thumbnail_path', type: 'TEXT' }
];

db.serialize(() => {
    tables.forEach(table => {
        columns.forEach(col => {
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
    console.log("Migration finished.");
}, 2000);
