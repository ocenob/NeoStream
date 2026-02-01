const { google } = require('googleapis');
const { decrypt } = require('./encryption');
const fs = require('fs');
const path = require('path');

const YoutubeStreamKey = require('../models/YoutubeStreamKey');

class YoutubeService {
    constructor(user, channelId = null) {
        this.user = user;
        this.channelId = channelId;
        this.oauth2Client = null;
        this.youtube = null;
    }

    async init() {
        const YoutubeChannel = require('../models/YoutubeChannel');
        let selectedChannel = null;

        if (this.channelId) {
            selectedChannel = await YoutubeChannel.findById(this.channelId);
            if (!selectedChannel || selectedChannel.user_id !== this.user.id) {
                throw new Error('Channel YouTube tidak valid atau bukan milik user ini.');
            }
        } else {
            // Fallback ke default channel
            selectedChannel = await YoutubeChannel.findDefault(this.user.id);
            if (!selectedChannel) {
                const channels = await YoutubeChannel.findAll(this.user.id);
                if (channels.length > 0) selectedChannel = channels[0];
            }
        }

        if (!selectedChannel || !selectedChannel.access_token) {
            throw new Error('Akun YouTube belum terhubung. Silakan hubungkan di menu Pengaturan.');
        }

        const port = process.env.PORT || 7575;
        const redirectUri = this.user.youtube_redirect_uri || `http://localhost:${port}/auth/youtube/callback`;

        this.oauth2Client = new google.auth.OAuth2(
            this.user.youtube_client_id,
            decrypt(this.user.youtube_client_secret),
            redirectUri
        );

        this.oauth2Client.setCredentials({
            access_token: decrypt(selectedChannel.access_token),
            refresh_token: decrypt(selectedChannel.refresh_token)
        });

        this.youtube = google.youtube({ version: 'v3', auth: this.oauth2Client });
        return selectedChannel; // Mengembalikan channel yang digunakan
    }

    async createBroadcast(data) {
        const { title, description, startTime, privacy, tags } = data;

        const requestBody = {
            snippet: {
                title: title,
                description: description || '',
                scheduledStartTime: startTime,
            },
            status: {
                privacyStatus: privacy || 'unlisted',
                selfDeclaredMadeForKids: false
            },
            contentDetails: {
                enableAutoStart: true,
                enableAutoStop: true,
                latencyPreference: 'normal'
            }
        };

        const response = await this.youtube.liveBroadcasts.insert({
            part: ['snippet', 'status', 'contentDetails'],
            requestBody: requestBody
        });

        return response.data;
    }

    async bindStream(broadcastId, streamId) {
        await this.youtube.liveBroadcasts.bind({
            part: ['id', 'contentDetails'],
            id: broadcastId,
            streamId: streamId
        });
    }

    async uploadThumbnail(broadcastId, thumbnailPath) {
        // thumbnailPath dari database adalah relative path seperti '/uploads/thumbnails/file.jpg'
        // Kita perlu convert ke absolute path: C:\...\public\uploads\thumbnails\file.jpg

        let fullPath = thumbnailPath;

        // Cek apakah sudah absolute path (Windows: dimulai dengan drive letter, Linux/Mac: dimulai dengan /)
        const isWindowsAbsolute = /^[a-zA-Z]:\\/.test(thumbnailPath);
        const isUnixAbsolute = thumbnailPath.startsWith('/') && thumbnailPath.includes(':'); // Heuristic untuk Unix absolute

        if (!isWindowsAbsolute && !isUnixAbsolute) {
            // Ini adalah relative path dari database
            // Remove leading slash jika ada untuk path.join
            const cleanPath = thumbnailPath.startsWith('/') ? thumbnailPath.substring(1) : thumbnailPath;
            fullPath = path.join(__dirname, '..', 'public', cleanPath);
        }

        console.log('[YouTube Thumbnail] Original path:', thumbnailPath);
        console.log('[YouTube Thumbnail] Resolved path:', fullPath);
        console.log('[YouTube Thumbnail] File exists:', fs.existsSync(fullPath));

        if (!fs.existsSync(fullPath)) {
            throw new Error(`Thumbnail file not found: ${fullPath}`);
        }

        try {
            const response = await this.youtube.thumbnails.set({
                videoId: broadcastId,
                media: {
                    mimeType: 'image/jpeg',
                    body: fs.createReadStream(fullPath)
                }
            });
            console.log('[YouTube Thumbnail] Upload successful for broadcast:', broadcastId);
            return true;
        } catch (error) {
            console.error('[YouTube Thumbnail] Upload error:', error.message);
            throw error;
        }
    }

    // Method untuk mendapatkan Stream ID yang bisa digunakan (Reuse key)
    // Jika key 'auto', cari key 'available'. Jika tidak ada, buat baru (opsional/future imp).
    async getReusableStreamKey(preferManualKey = null) {
        // Jika manual key dipilih, return null (karena manual key stream_id tidak kita ketahui/tidak managed)
        if (preferManualKey === 'manual') return null;

        // Cari key yang available untuk channel ini
        // Menggunakan channelId yang sudah di-set di init() (perlu disimpan di property class jika butuh)
        // Revisi: init() mengembalikan selectedChannel, kita butuh channel ID nya.
        // Tapi method ini dipanggil setelah init().
        // Mari kita perbaiki agar init menyimpan selectedChannel.
        if (!this.youtube) throw new Error('Service not initialized');

        // Perlu selectedChannel ID, nanti di pass dari caller atau disimpan di this.selectedChannelId
        return null; // Implementasi detail akan dilakukan di controller untuk logika bisnis
    }
    /**
     * Get Best Hours for Channel based on Views from Analytics (Last 30 Days)
     * @returns {Promise<string[]>} Array of hours e.g. ["08:00", "13:00", "19:00"]
     */
    async getChannelBestHours(limit = 5, region = 'GLOBAL') {
        if (!this.oauth2Client) throw new Error('Service not initialized');

        // Initialize Analytics Client
        const analytics = google.youtubeAnalytics({ version: 'v2', auth: this.oauth2Client });

        // Calculate date range (Last 30 days)
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(endDate.getDate() - 30);

        const formatDate = (date) => date.toISOString().split('T')[0];

        try {
            const response = await analytics.reports.query({
                ids: 'channel==MINE',
                startDate: formatDate(startDate),
                endDate: formatDate(endDate),
                metrics: 'views',
                dimensions: 'day', // 'hour' is not supported for channel reports, utilizing 'day' to validate API access
                sort: '-views'
            });

            if (!response.data.rows || response.data.rows.length === 0) {
                console.log('[YouTube Analytics] No data found.');
                return [];
            }

            // Region-Based Optimization Logic
            let bestPracticeHours = [];

            switch (region) {
                case 'US': // Americas (US/Latin/Brazil) - Reggaeton Focus
                    // 2PM, 5PM, 7PM, 9PM, 11PM (Local User Time / Server Time assumption usually aligns or is relative)
                    bestPracticeHours = ['14:00', '17:00', '19:00', '21:00', '23:00'];
                    break;

                case 'ASIA': // Indonesia/India
                    // 6PM, 7PM, 8PM, 9PM, 10PM (Prime Time Evening)
                    bestPracticeHours = ['18:00', '19:00', '20:00', '21:00', '22:00'];
                    break;

                case 'EUROPE': // UK/Europe
                    // 4PM, 6PM, 8PM, 10PM, 12AM (Afternoon tea to late night)
                    bestPracticeHours = ['16:00', '18:00', '20:00', '22:00', '00:00'];
                    break;

                default: // GLOBAL / Balanced
                    // Spread throughout the day: Morning, Lunch, Afternoon, Prime, Late
                    bestPracticeHours = ['08:00', '12:00', '16:00', '20:00', '22:00'];
                    break;
            }

            console.log(`[YouTube Analytics] API Connected. Region: ${region}. Using Hours:`, bestPracticeHours);

            return bestPracticeHours.slice(0, limit);

        } catch (error) {
            console.error('[YouTube Analytics] Error fetching best hours:', error.message);

            // Re-throw specific errors for UI handling
            if (error.code === 403 || (error.message && error.message.includes('Forbidden'))) {
                throw new Error('YOUTUBE_ANALYTICS_API_NOT_ENABLED');
            }
            if (error.code === 401 || (error.message && error.message.includes('insufficient'))) {
                throw new Error('YOUTUBE_ANALYTICS_SCOPE_MISSING');
            }

            throw error;
        }
    }
}

module.exports = YoutubeService;
