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

async function checkDB(dbPath) {
    return new Promise((resolve) => {
        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
            if (err) {
                // console.log(`[${dbPath}] Error opening: ${err.message}`);
                resolve();
                return;
            }
        });

        db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='youtube_channels'", [], (err, tables) => {
            if (err || !tables || tables.length === 0) {
                // console.log(`[${dbPath}] No youtube_channels table.`);
                db.close();
                resolve();
                return;
            }

            db.all("SELECT * FROM youtube_channels", [], (err, channels) => {
                if (err) {
                    db.close();
                    resolve();
                    return;
                }

                const match = channels.find(c => c.channel_name && c.channel_name.includes('Reggaeton'));
                if (match) {
                    console.log(`\n!!! FOUND REGGAETON IN ${dbPath} !!!`);
                    console.log(`Channel: ${match.channel_name} (ID: ${match.id})`);

                    db.all("SELECT * FROM stream_rotations WHERE youtube_channel_id = ?", [match.id], (err, rots) => {
                        console.log(`Rotations count: ${rots ? rots.length : 0}`);
                        if (rots && rots.length > 0) {
                            const active = rots.filter(r => r.status === 'active');
                            console.log(`Active Rotations: ${active.length}`);

                            if (active.length > 0) {
                                console.log("Next 5 Active:");
                                active.slice(0, 5).forEach(r => {
                                    console.log(` - ${r.name} | Start: ${r.start_time} | Repeat: ${r.repeat_mode}`);
                                });
                            }
                        }
                        db.close();
                        resolve();
                    });
                } else {
                    // console.log(`[${dbPath}] No Reggaeton channel found.`);
                    db.close();
                    resolve();
                }
            });
        });
    });
}

async function run() {
    let dbFiles = [];
    searchRoots.forEach(root => {
        findFiles(root, '.db', dbFiles);
    });
    dbFiles = [...new Set(dbFiles)];
    console.log(`Found ${dbFiles.length} DB files to check.`);

    for (const dbPath of dbFiles) {
        await checkDB(dbPath);
    }
    console.log('Done.');
}

run();
