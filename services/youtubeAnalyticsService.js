
const { google } = require('googleapis');
const { decrypt } = require('../utils/encryption');
const User = require('../models/User');
const YoutubeChannel = require('../models/YoutubeChannel');

async function getVideoCTR(stream, userId, channelId) {
    try {
        const user = await User.findById(userId);
        const channel = await YoutubeChannel.findById(channelId);

        if (!user || !channel) throw new Error('User or Channel not found');

        const oauth2Client = new google.auth.OAuth2(
            user.youtube_client_id,
            decrypt(user.youtube_client_secret),
            process.env.BASE_URL ? `${process.env.BASE_URL}/auth/youtube/callback` : 'http://localhost:7575/auth/youtube/callback'
        );

        oauth2Client.setCredentials({
            access_token: decrypt(channel.access_token),
            refresh_token: decrypt(channel.refresh_token)
        });

        const analytics = google.youtubeAnalytics({ version: 'v2', auth: oauth2Client });

        // Calculate date range (last 7 days for stable CTR)
        const today = new Date();
        const endDate = today.toISOString().split('T')[0];
        const startDateObj = new Date();
        startDateObj.setDate(today.getDate() - 7);
        const startDate = startDateObj.toISOString().split('T')[0];

        console.log(`[YouTubeAnalytics] Fetching CTR for video ${stream.youtube_broadcast_id} (${startDate} to ${endDate})`);

        const response = await analytics.reports.query({
            ids: `channel==${channel.channel_id}`,
            startDate: startDate,
            endDate: endDate,
            metrics: 'impressions,ctr', // Note: ctr might require specific permissions or might be named differently
            dimensions: 'video',
            filters: `video==${stream.youtube_broadcast_id}`
        });

        if (response.data.rows && response.data.rows.length > 0) {
            // response.data.rows[0] = [videoId, impressions, ctr]
            const ctrValue = response.data.rows[0][2]; // CTR is typically in percentage (e.g. 5.2)
            console.log(`[YouTubeAnalytics] CTR for ${stream.youtube_broadcast_id}: ${ctrValue}%`);
            return ctrValue;
        }

        console.log(`[YouTubeAnalytics] No data found for video ${stream.youtube_broadcast_id}`);
        return null; // No data yet
    } catch (error) {
        console.error('[YouTubeAnalytics] Error fetching CTR:', error.message);
        return null;
    }
}

module.exports = {
    getVideoCTR
};
