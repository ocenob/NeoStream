const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const util = require('util');

async function searchInDb(dbPath) {
    const db = new sqlite3.Database(dbPath);
    const all = util.promisify(db.all.bind(db));

    console.log('Searching in:', dbPath);

    try {
        const tables = await all("SELECT name FROM sqlite_master WHERE type='table'");
        for (const table of tables) {
            const tableName = table.name;
            const rows = await all(`SELECT * FROM ${tableName}`);
            if (!rows) continue;

            rows.forEach(row => {
                const rowStr = JSON.stringify(row).toLowerCase();
                if (rowStr.includes('test') && rowStr.includes('rotat')) {
                    console.log(`FOUND in table ${tableName}:`, row);
                }
            });
        }
    } catch (err) {
        console.error(`Error searching ${dbPath}:`, err.message);
    } finally {
        db.close();
    }
}

async function run() {
    await searchInDb(path.join(__dirname, 'data', 'streamflow.db'));
    await searchInDb(path.join(__dirname, '..', 'neostreampro', 'data', 'streamflow.db'));
    // Also check other common locations
    await searchInDb('j:/Streamingo-/streamingo.db');
}

run();
