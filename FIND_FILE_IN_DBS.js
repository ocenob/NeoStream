const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const root = 'j:/';
const targetFile = '1--1--1769370974260-521894.jpeg';

function scan(curr) {
    let items;
    try { items = fs.readdirSync(curr); } catch (e) { return; }
    items.forEach(item => {
        const fullPath = path.join(curr, item);
        let stat;
        try { stat = fs.statSync(fullPath); } catch (e) { return; }
        if (stat.isDirectory()) {
            if (item !== 'node_modules' && item !== '.git' && !item.startsWith('$')) scan(fullPath);
        } else if (item.endsWith('.db')) {
            checkDb(fullPath);
        }
    });
}

function checkDb(dbPath) {
    const db = new sqlite3.Database(dbPath);
    db.serialize(() => {
        db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, tables) => {
            if (err || !tables) { db.close(); return; }
            tables.forEach(table => {
                const tableName = table.name;
                db.all(`PRAGMA table_info(${tableName})`, (err, columns) => {
                    if (err) return;
                    columns.forEach(column => {
                        const colName = column.name;
                        db.all(`SELECT * FROM ${tableName} WHERE "${colName}" LIKE '%${targetFile}%'`, (err, rows) => {
                            if (!err && rows && rows.length > 0) {
                                console.log(`[MATCH FOUND] DB: ${dbPath}, Table: ${tableName}, Column: ${colName}`);
                                db.close();
                            }
                        });
                    });
                });
            });
        });
    });
}

scan(root);
