const { google } = require('googleapis');
const { decrypt } = require('./encryption');
const path = require('path');

class AnalyticsService {
    constructor(user, channel) {
        this.user = user;
        this.channel = channel;
        this.oauth2Client = null;
        this.analytics = null;
    }

    async init() {
        if (!this.user.youtube_client_id || !this.user.youtube_client_secret) {
            throw new Error('Kredensial YouTube API belum dikonfigurasi.');
        }

        if (!this.channel.access_token || !this.channel.refresh_token) {
            throw new Error('Channel belum terhubung dengan YouTube.');
        }

        const port = process.env.PORT || 7575;
        const redirectUri = this.user.youtube_redirect_uri || `http://localhost:${port}/auth/youtube/callback`;

        this.oauth2Client = new google.auth.OAuth2(
            this.user.youtube_client_id,
            decrypt(this.user.youtube_client_secret),
            redirectUri
        );

        this.oauth2Client.setCredentials({
            access_token: decrypt(this.channel.access_token),
            refresh_token: decrypt(this.channel.refresh_token)
        });

        this.analytics = google.youtubeAnalytics({ version: 'v2', auth: this.oauth2Client });
    }

    /**
     * Mengambil data heatmap penonton berdasarkan jam dalam seminggu.
     * YouTube Analytics API tidak memberikan data "When your viewers are on YouTube" secara langsung dalam satu metrik.
     * Kita akan menggunakan metrik 'views' berdasarkan 'hour' sebagai proksi aktivitas.
     */
    async getViewerActivityHeatmap() {
        try {
            await this.init();

            const endDate = new Date().toISOString().split('T')[0];
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - 30); // 30 hari terakhir
            const formattedStartDate = startDate.toISOString().split('T')[0];

            const response = await this.analytics.reports.query({
                ids: `channel==${this.channel.youtube_channel_id || 'mine'}`,
                startDate: formattedStartDate,
                endDate: endDate,
                metrics: 'views',
                dimensions: 'dayOfWeek,hour',
                sort: 'dayOfWeek,hour'
            });

            // Inisialisasi heatmap (0-6 untuk hari, 0-23 untuk jam)
            const heatmap = Array.from({ length: 7 }, () => Array(24).fill(0));

            if (response.data.rows && response.data.rows.length > 0) {
                response.data.rows.forEach(([dayOfWeek, hour, views]) => {
                    // API biasanya return dayOfWeek 1-7 (Sunday=1)
                    const dayIdx = (parseInt(dayOfWeek) - 1) % 7;
                    const hourIdx = parseInt(hour);
                    heatmap[dayIdx][hourIdx] = views;
                });
            } else {
                console.log('[AnalyticsService] No data found, using default peak hours.');
                return this.getDefaultHeatmap();
            }

            return heatmap;
        } catch (error) {
            console.error('[AnalyticsService] Error fetching analytics:', error.message);
            return this.getDefaultHeatmap();
        }
    }

    getDefaultHeatmap() {
        // Default: Ramai di sore - malam (17:00 - 23:00)
        const heatmap = Array.from({ length: 7 }, () => {
            const day = Array(24).fill(10); // Base value
            for (let h = 17; h <= 23; h++) day[h] = 100; // Peak
            return day;
        });
        return heatmap;
    }
}

module.exports = AnalyticsService;
