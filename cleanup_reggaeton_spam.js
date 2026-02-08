const { google } = require('googleapis');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { decrypt } = require('./utils/encryption');

require('dotenv').config();

const dbPath = path.join(__dirname, process.env.DB_PATH || 'data/neostream.db');
const db = new sqlite3.Database(dbPath);

async function cleanupReggaetonSpam() {
    console.log('[Cleanup] Starting cleanup for Reggaeton Vibes channel...');

    const channel = await new Promise((resolve, reject) => {
        db.get("SELECT * FROM youtube_channels WHERE channel_name LIKE '%Reggaeton Vibes%'", (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });

    if (!channel) {
        console.error('[Cleanup] Reggaeton Vibes channel not found in database!');
        process.exit(1);
    }

    const user = await new Promise((resolve, reject) => {
        db.get("SELECT * FROM users WHERE id = ?", [channel.user_id], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });

    const oauth2Client = new google.auth.OAuth2(
        user.youtube_client_id,
        decrypt(user.youtube_client_secret)
    );

    oauth2Client.setCredentials({
        access_token: decrypt(channel.access_token),
        refresh_token: decrypt(channel.refresh_token)
    });

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    // Fetch all upcoming broadcasts with pagination
    let allBroadcasts = [];
    let nextPageToken = null;

    console.log(`[Cleanup] Fetching upcoming broadcasts...`);
    do {
        const response = await youtube.liveBroadcasts.list({
            part: ['snippet', 'status'],
            broadcastStatus: 'upcoming',
            maxResults: 50,
            pageToken: nextPageToken
        });

        allBroadcasts = allBroadcasts.concat(response.data.items || []);
        nextPageToken = response.data.nextPageToken;
        console.log(`[Cleanup] Fetched ${allBroadcasts.length} broadcasts so far...`);
    } while (nextPageToken);

    console.log(`[Cleanup] Found total ${allBroadcasts.length} upcoming broadcasts`);
    console.log(`[Cleanup] Starting cleanup...`);

    let deletedCount = 0;
    for (const broadcast of allBroadcasts) {
        const title = broadcast.snippet.title;
        const id = broadcast.id;
        const scheduledTime = broadcast.snippet.scheduledStartTime;

        try {
            console.log(`[Cleanup] Deleting: "${title}" (${id}) @ ${scheduledTime}`);
            await youtube.liveBroadcasts.delete({ id: id });
            deletedCount++;

            // Delay to avoid rate limits
            await new Promise(r => setTimeout(r, 600));
        } catch (err) {
            console.error(`[Cleanup] Failed to delete ${id}:`, err.message);
            if (err.message.includes('quota') || err.code === 403) {
                console.log('[Cleanup] Hit API quota limit. Stopping cleanup.');
                break;
            }
        }
    }

    console.log(`\n[Cleanup] Finished! Total deleted: ${deletedCount} of ${allBroadcasts.length}`);
    db.close();
}

cleanupReggaetonSpam();
