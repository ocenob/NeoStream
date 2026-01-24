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
}

module.exports = YoutubeService;
