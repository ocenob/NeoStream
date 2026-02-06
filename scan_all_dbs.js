const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
const dbFiles = fs.readdirSync(dataDir).filter(f => f.endsWith('.db'));

console.log(`Scanning databases in: ${dataDir}`);

async function scanDb(file) {
    return new Promise((resolve) => {
        const dbPath = path.join(dataDir, file);
        const db = new sqlite3.Database(dbPath);

        console.log(`\nScanning ${file}...`);

        db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, tables) => {
            if (err) {
                console.log(`  Could not read tables for ${file}: ${err.message}`);
                db.close();
                resolve();
                return;
            }

            const tableNames = tables.map(t => t.name);
            console.log(`  Tables: ${tableNames.join(', ')}`);

            if (tableNames.includes('stream_rotations')) {
                db.all("SELECT name, status, start_time FROM stream_rotations", (err2, rows) => {
                    if (!err2 && rows.length > 0) {
                        console.log(`  [FOUND] ${rows.length} rotations in ${file}`);
                        console.log(JSON.stringify(rows, null, 2));
                    }
                    db.close();
                    resolve();
                });
            } else {
                db.close();
                resolve();
            }
        });
    });
}

async function run() {
    for (const file of dbFiles) {
        await scanDb(file);
    }
    console.log('\nScan complete.');
}

run();
