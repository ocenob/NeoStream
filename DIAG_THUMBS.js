const sqlite3 = require('sqlite3').verbose();
const { db } = require('./db/database');
const Thumbnail = require('./models/Thumbnail');
const YoutubeChannel = require('./models/YoutubeChannel');
const fs = require('fs');
const path = require('path');

async function diag() {
    try {
        console.log("Database connection object check:", !!db);

        // Check for any channel
        const channels = await YoutubeChannel.findAll('8c347073-34d5-4475-a018-0ef2d81fc996'); // Using ID found earlier
        console.log("Channels found for user:", channels.length);
        channels.forEach(c => console.log(`- ${c.channel_name} (${c.id})`));

        const thumbnails = await Thumbnail.findAll('8c347073-34d5-4475-a018-0ef2d81fc996');
        console.log("Thumbnails found for user:", thumbnails.length);

        if (thumbnails.length > 0) {
            const first = thumbnails[0];
            console.log("First thumbnail data:", JSON.stringify(first));
            const fullPath = path.join(__dirname, 'public', first.filepath);
            console.log(`Checking file at: ${fullPath}`);
            console.log(`File exists: ${fs.existsSync(fullPath)}`);
        }
    } catch (e) {
        console.error("DIAG ERROR:", e);
    }
}

diag();
