const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const dbPaths = [
    'j:/neostream/data/streamflow.db',
    'j:/neostream/data/neostream.db',
    'j:/neostream/db/database.db',
    'j:/neostreampro/data/streamflow.db'
];

const uploadDirs = [
    'j:/neostream/public/uploads/thumbnails',
    'j:/neostreampro/public/uploads/thumbnails'
];

async function bulkClear() {
    console.log("Starting bulk cleanup...");

    // 1. Clear Databases
    for (const dbPath of dbPaths) {
        if (!fs.existsSync(dbPath)) continue;
        console.log(`Clearing records in: ${dbPath}`);
        const db = new sqlite3.Database(dbPath);
        await new Promise((resolve) => {
            db.run("DELETE FROM thumbnails", (err) => {
                if (err) console.error(`Error clearing ${dbPath}:`, err.message);
                else console.log(`Cleared thumbnails table in ${dbPath}`);
                db.close();
                resolve();
            });
        });
    }

    // 2. Clear Filesystem
    for (const uploadDir of uploadDirs) {
        if (!fs.existsSync(uploadDir)) continue;
        console.log(`Clearing files in: ${uploadDir}`);
        const files = fs.readdirSync(uploadDir);
        for (const file of files) {
            if (file === '.gitkeep' || file === 'placeholder.txt') continue;
            const fullPath = path.join(uploadDir, file);
            try {
                if (fs.statSync(fullPath).isFile()) {
                    fs.unlinkSync(fullPath);
                    console.log(`Deleted: ${file}`);
                }
            } catch (e) {
                console.error(`Error deleting ${file}:`, e.message);
            }
        }
    }

    console.log("Bulk cleanup completed.");
}

bulkClear();
