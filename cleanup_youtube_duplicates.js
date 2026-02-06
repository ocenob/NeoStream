const { google } = require('googleapis');
const { db } = require('./db/database');
const { decrypt } = require('./utils/encryption');
const YoutubeChannel = require('./models/YoutubeChannel');
const User = require('./models/User');

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

            // List upcoming broadcasts
            const response = await youtube.liveBroadcasts.list({
                part: ['snippet', 'status'],
                broadcastStatus: 'upcoming',
                maxResults: 50
            });

            const broadcasts = response.data.items || [];
            console.log(`[Cleanup] Found ${broadcasts.length} upcoming broadcasts (first page)`);

            // Group by title to identify duplicates
            const seenTitles = new Map();
            let deletedCount = 0;

            for (const broadcast of broadcasts) {
                const title = broadcast.snippet.title;
                const id = broadcast.id;
                const scheduledTime = broadcast.snippet.scheduledStartTime;

                // If it's for Feb 6 or Feb 7 and we've seen this title already for roughly the same time window
                // Or just delete if we have more than 5 with same title
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
                            // Wait a bit to avoid hitting rate limit again
                            await new Promise(r => setTimeout(r, 500));
                        } catch (err) {
                            console.error(`[Cleanup] Failed to delete ${item.id}:`, err.message);
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
