const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const searchRoots = [
    'j:\\neostream',
    'j:\\neostreampro',
    'j:\\bwstream-bluk-jadwal',
    'j:\\Streamingo-'
];

function findFiles(dir, ext, fileList = []) {
    if (!fs.existsSync(dir)) return fileList;
    try {
        const files = fs.readdirSync(dir);
        files.forEach(file => {
            const filePath = path.join(dir, file);
            // Skip node_modules and .git to save time
            if (file === 'node_modules' || file === '.git') return;

            try {
                if (fs.statSync(filePath).isDirectory()) {
                    findFiles(filePath, ext, fileList);
                } else {
                    if (path.extname(file) === ext) fileList.push(filePath);
                }
            } catch (e) { }
        });
    } catch (e) { }
    return fileList;
}

let dbFiles = [];
searchRoots.forEach(root => {
    console.log(`Scanning ${root}...`);
    findFiles(root, '.db', dbFiles);
});

// Remove duplicates
dbFiles = [...new Set(dbFiles)];
console.log(`Found ${dbFiles.length} DB files.`);

let pending = dbFiles.length;

dbFiles.forEach(dbPath => {
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);

    // Check for youtube_channels table
    db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='youtube_channels'", (err, tables) => {
        if (tables && tables.length > 0) {
            db.all("SELECT * FROM youtube_channels", (err, channels) => {
                if (!channels) {
                    checkDone();
                    return;
                }

                const match = channels.find(c => c.channel_name && c.channel_name.includes('Reggaeton'));
                if (match) {
                    console.log(`\n!!! FOUND REGGAETON IN ${dbPath} !!!`);
                    console.log('Channel:', match.channel_name, match.id);

                    // Check Rotations
                    db.all("SELECT * FROM stream_rotations WHERE youtube_channel_id = ?", [match.id], (err, rots) => {
                        console.log(`\nRotations count: ${rots ? rots.length : 0}`);
                        if (rots && rots.length > 0) {
                            console.log("Sample Rotations:");
                            rots.slice(0, 5).forEach(r => {
                                console.log(`[${r.repeat_mode}] ${r.name} (Status: ${r.status}) Start: ${r.start_time}`);
                            });
                        }
                    });
                }
                checkDone();
            });
        } else {
            checkDone();
        }
    });

    function checkDone() {
        // Simple counter, not perfect async handling but enough for script
    }
});
