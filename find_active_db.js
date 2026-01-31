const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const targetId = '6060dbc8-6aad-4e24-8672-75a4425e831d';

function searchInDir(dir) {
    if (dir.includes('$RECYCLE.BIN') || dir.includes('System Volume Information')) return;

    let files;
    try {
        files = fs.readdirSync(dir);
    } catch (e) {
        return;
    }

    for (const file of files) {
        const fullPath = path.join(dir, file);
        let stat;
        try {
            stat = fs.statSync(fullPath);
        } catch (e) {
            continue;
        }

        if (stat.isDirectory()) {
            searchInDir(fullPath);
        } else if (file.endsWith('.db')) {
            checkDb(fullPath);
        }
    }
}

function checkDb(dbPath) {
    const db = new sqlite3.Database(dbPath);
    db.get('SELECT name FROM stream_rotations WHERE id = ?', [targetId], (err, row) => {
        if (row) {
            console.log(`\n!!! FOUND !!!\nDatabase: ${dbPath}\nRotation Name: ${row.name}\n`);
            process.exit(0);
        }
        db.close();
    });
}

console.log('Searching for the active database...');
// Search in J: first as it's more likely
searchInDir('j:\\');
// Then C: if not found (though C: is huge)
searchInDir('c:\\');
