const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const targetId = '7a2146ed-090f-4150-9e8e-d8f7df5c918b';
const drives = ['C:\\', 'D:\\', 'I:\\', 'K:\\', 'J:\\'];

async function checkFile(dbPath) {
    if (!dbPath.endsWith('.db')) return;
    return new Promise((resolve) => {
        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
            if (err) return resolve();
            db.get('SELECT name FROM stream_rotations WHERE id = ?', [targetId], (err, row) => {
                if (row) {
                    console.log(`\n!!! FOUND !!! in ${dbPath} (Name: ${row.name})\n`);
                    process.exit(0);
                }
                db.close();
                resolve();
            });
        });
    });
}

async function scan(dir) {
    if (dir.includes('$') || dir.includes('node_modules') || dir.includes('AppData')) return;
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
            } else if (file.endsWith('.db')) {
                await checkFile(fullPath);
            }
        } catch (e) { }
    }
}

async function run() {
    for (const drive of drives) {
        console.log(`Scanning drive ${drive}...`);
        await scan(drive);
    }
}

run();
