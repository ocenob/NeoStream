const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const targetId = '6060dbc8-6aad-4e24-8672-75a4425e831d';

async function checkFile(dbPath) {
    if (!dbPath.endsWith('.db')) return;
    process.stdout.write(`Checking ${dbPath}... `);
    return new Promise((resolve) => {
        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
            if (err) {
                process.stdout.write(`ERROR (open)\n`);
                return resolve();
            }
            db.get('SELECT name FROM stream_rotations WHERE id = ?', [targetId], (err, row) => {
                if (row) {
                    process.stdout.write(`\n!!! FOUND !!! in ${dbPath} (Name: ${row.name})\n`);
                    process.exit(0);
                } else if (err && !err.message.includes('no such table')) {
                    process.stdout.write(`ERROR: ${err.message}\n`);
                } else {
                    process.stdout.write(`not found\n`);
                }
                db.close();
                resolve();
            });
        });
    });
}

async function scan(dir) {
    if (dir.includes('$') || dir.includes('node_modules')) return;
    let files;
    try {
        files = fs.readdirSync(dir);
    } catch (e) { return; }

    for (const file of files) {
        const fullPath = path.join(dir, file);
        try {
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                await scan(fullPath);
            } else {
                await checkFile(fullPath);
            }
        } catch (e) { }
    }
}

console.log('Starting scan...');
scan('j:\\');
