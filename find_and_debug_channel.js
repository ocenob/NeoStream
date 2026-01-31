const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// Function to recursively find files with specific extension
function findFiles(dir, ext, fileList = []) {
    const files = fs.readdirSync(dir);

    files.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);

        if (stat.isDirectory() && file !== 'node_modules' && file !== '.git') {
            findFiles(filePath, ext, fileList);
        } else {
            if (path.extname(file) === ext) {
                fileList.push(filePath);
            }
        }
    });

    return fileList;
}

const dbFiles = findFiles(__dirname, '.db');
console.log('Found DB files:', dbFiles);

const channelId = 'b44cd3bb-a77b-4dff-a6d7-87e503b97aa8';

dbFiles.forEach(dbPath => {
    console.log(`Checking DB: ${dbPath}`);
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
        if (err) {
            console.log(`Failed to open ${dbPath}: ${err.message}`);
            return;
        }
    });

    db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='youtube_channels'", (err, table) => {
        if (!table) {
            console.log(`[${path.basename(dbPath)}] No youtube_channels table.`);
            return;
        }

        db.get('SELECT * FROM youtube_channels WHERE id = ?', [channelId], (err, channel) => {
            if (channel) {
                console.log(`\n!!! FOUND CHANNEL IN ${dbPath} !!!`);
                console.log('Channel:', channel);

                db.get('SELECT * FROM users WHERE id = ?', [channel.user_id], (err, user) => {
                    if (user) {
                        console.log('User FOUND:', user.username, user.id);
                        if (user.id !== channel.user_id) {
                            console.log('TYPE MISMATCH? User ID:', user.id, 'Channel User ID:', channel.user_id);
                        } else {
                            console.log('User ID match confirmed.');
                        }
                    } else {
                        console.log('User NOT FOUND for ID:', channel.user_id);
                        db.all('SELECT id, username FROM users', (err, rows) => {
                            console.log('Available users:', rows);
                        });
                    }
                });
            } else {
                // Check by slug
                db.get('SELECT * FROM youtube_channels WHERE slug = ?', [channelId], (err, slugChannel) => {
                    if (slugChannel) {
                        console.log(`\n!!! FOUND CHANNEL BY SLUG IN ${dbPath} !!!`);
                        console.log('Channel:', slugChannel);
                    }
                });
            }
        });
    });
});
