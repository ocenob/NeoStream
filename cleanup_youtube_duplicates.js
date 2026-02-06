require('dotenv').config();
const { google } = require('googleapis');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { decrypt } = require('./utils/encryption');
const User = require('./models/User');

// Resolve DB Path from .env
const dbPath = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.join(__dirname, 'data', 'neostream.db');
const db = new sqlite3.Database(dbPath);

async function cleanupDuplicates() {
    console.log('[Cleanup] Starting YouTube duplicate broadcast cleanup...');

    try {
        const channels = await new Promise((resolve, reject) => {
            db.all('SELECT * FROM youtube_channels', (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        for (const channel of channels) {
            console.log(`[Cleanup] Processing channel: ${channel.channel_name} (${channel.channel_id})`);

            const user = await User.findById(channel.user_id);
            if (!user) {
                console.error(`[Cleanup] User not found for channel ${channel.id}`);
                continue;
            }

            const oauth2Client = new google.auth.OAuth2(
                user.youtube_client_id,
                decrypt(user.youtube_client_secret)
            );

            oauth2Client.setCredentials({
                access_token: decrypt(channel.access_token),
                refresh_token: decrypt(channel.refresh_token)
            });

            const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

            // Fetch ALL upcoming broadcasts with pagination
            let allBroadcasts = [];
            let nextPageToken = null;

            console.log(`[Cleanup] Fetching upcoming broadcasts for ${channel.channel_name}...`);
            do {
                const response = await youtube.liveBroadcasts.list({
                    part: ['snippet', 'status'],
                    broadcastStatus: 'upcoming',
                    maxResults: 50,
                    pageToken: nextPageToken
                });

                allBroadcasts = allBroadcasts.concat(response.data.items || []);
                nextPageToken = response.data.nextPageToken;
            } while (nextPageToken);

            console.log(`[Cleanup] Found total ${allBroadcasts.length} upcoming broadcasts`);

            // Group by title to identify duplicates
            const seenTitles = new Map();
            let deletedCount = 0;

            for (const broadcast of allBroadcasts) {
                const title = broadcast.snippet.title;
                const id = broadcast.id;
                const scheduledTime = broadcast.snippet.scheduledStartTime;

                if (!seenTitles.has(title)) {
                    seenTitles.set(title, []);
                }
                seenTitles.get(title).push({ id, scheduledTime });
            }

            for (const [title, matches] of seenTitles.entries()) {
                if (matches.length > 1) {
                    console.log(`[Cleanup] Found ${matches.length} matches for title: "${title}"`);
                    // Sort by scheduled time, keep the first one
                    matches.sort((a, b) => new Date(a.scheduledTime) - new Date(b.scheduledTime));

                    // Keep the first one (earliest), delete the rest
                    const toDelete = matches.slice(1);
                    for (const item of toDelete) {
                        try {
                            await youtube.liveBroadcasts.delete({ id: item.id });
                            deletedCount++;
                            console.log(`[Cleanup] Deleted duplicate: ${item.id} (${item.scheduledTime})`);
                            // Wait to avoid hitting rate limit
                            await new Promise(r => setTimeout(r, 800));
                        } catch (err) {
                            console.error(`[Cleanup] Failed to delete ${item.id}:`, err.message);
                            if (err.message.includes('quota') || err.code === 403) {
                                console.log('[Cleanup] Hit API limit. Skipping further deletions for this channel.');
                                break;
                            }
                        }
                    }
                }
            }
            console.log(`[Cleanup] Finished channel ${channel.channel_name}. Deleted ${deletedCount} duplicates.`);
        }

    } catch (err) {
        console.error('[Cleanup] Fatal Error:', err.message);
    } finally {
        console.log('[Cleanup] Done.');
        process.exit(0);
    }
}

cleanupDuplicates();
