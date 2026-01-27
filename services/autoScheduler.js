const Stream = require('../models/Stream');
const Playlist = require('../models/Playlist');
const Video = require('../models/Video');
const User = require('../models/User');
const Thumbnail = require('../models/Thumbnail');
const { v4: uuidv4 } = require('uuid');

class AutoSchedulerService {
    /**
     * Generates a random schedule for the given channel for N days.
     * @param {string} channelId - The YouTube Channel ID.
     * @param {string} userId - The owner's User ID.
     * @param {object} config - Configuration object.
     * @param {number} config.daysCount - Number of days to generate.
     * @param {number} config.minStreamsPerDay - Min streams per day.
     * @param {number} config.maxStreamsPerDay - Max streams per day.
     * @param {number} config.minDurationHours - Min duration per stream.
     * @param {number} config.maxDurationHours - Max duration per stream.
     * @param {string} config.contentType - 'video' or 'playlist'.
     * @param {string[]} config.customTitles - Array of custom titles to randomize.
     */
    static async generateRotationSchedule(channelId, userId, config) {
        console.log('[AutoScheduler] Starting generation with config:', config);
        const {
            daysCount = 14,
            minStreamsPerDay = 6,
            maxStreamsPerDay = 12,
            minDurationHours = 3,
            maxDurationHours = 7,
            contentType = 'video',
            customTitles = []
        } = config;

        // 1. Fetch Content Pool
        let contentPool = [];
        if (contentType === 'playlist') {
            contentPool = await Playlist.findAll(userId, channelId);
            contentPool = contentPool.filter(p => p.video_count > 0);
            if (contentPool.length === 0) {
                throw new Error('No valid playlists found for this channel.');
            }
        } else {
            contentPool = await Video.findAll(userId, channelId);
            if (contentPool.length === 0) {
                throw new Error('No videos found for this channel.');
            }
        }

        // 2. Fetch Thumbnail Pool
        const thumbnailPool = await Thumbnail.findAll(userId, channelId);
        // Also fetch general thumbnails (where channelId IS NULL) if needed, 
        // but findAll(userId, channelId) logic in Thumbnail.js handles filtering.
        // If specific channel has no thumbnails, maybe fallback to all user thumbnails?
        // Thumbnail.findAll in model: IF channelId provided, it filters by it. 
        // Let's stick strictly to channel's thumbnails + global ones if model supports it, 
        // but current model code implies strict filter if channelId is passed.
        // Let's try to get all user thumbnails to be safe and maximize variety.
        let allThumbnails = await Thumbnail.findAll(userId, null); // Get global ones
        const channelThumbnails = await Thumbnail.findAll(userId, channelId);
        allThumbnails = [...allThumbnails, ...channelThumbnails];

        // Remove duplicates/nulls
        allThumbnails = allThumbnails.filter((t, index, self) =>
            index === self.findIndex((t2) => (t2.id === t.id))
        );

        // 3. Generation Loop
        const generatedStreams = [];
        const now = new Date();
        let startDate = new Date(now);
        startDate.setDate(startDate.getDate() + 1);
        startDate.setHours(6, 0, 0, 0);

        for (let day = 0; day < daysCount; day++) {
            const currentDayStart = new Date(startDate);
            currentDayStart.setDate(startDate.getDate() + day);

            const streamsToday = Math.floor(Math.random() * (maxStreamsPerDay - minStreamsPerDay + 1)) + minStreamsPerDay;
            let nextStartTime = new Date(currentDayStart);

            for (let i = 0; i < streamsToday; i++) {
                // Random Duration
                const durationHours = (Math.random() * (maxDurationHours - minDurationHours) + minDurationHours);
                const durationSeconds = Math.floor(durationHours * 3600);

                // Calculate End Time
                const streamStartTime = new Date(nextStartTime);
                const streamEndTime = new Date(streamStartTime.getTime() + durationSeconds * 1000);

                // Prep Content
                let targetId = null;
                let streamTitle = '';
                let streamDescription = '';

                // Content Selection
                if (contentType === 'playlist') {
                    const playlist = contentPool[Math.floor(Math.random() * contentPool.length)];
                    targetId = playlist.id;
                    // Title Fallback
                    streamTitle = playlist.name;
                } else {
                    // Create Dynamic Playlist
                    const videosToAdd = [];
                    let currentPlaylistDuration = 0;
                    let safety = 0;
                    while (currentPlaylistDuration < durationSeconds && safety < 1000) {
                        const vid = contentPool[Math.floor(Math.random() * contentPool.length)];
                        videosToAdd.push(vid);
                        currentPlaylistDuration += vid.duration;
                        safety++;
                    }

                    if (videosToAdd.length === 0) continue;

                    const playlistName = `SmartGen ${currentDayStart.toISOString().split('T')[0]} #${i + 1}`;
                    const newPlaylist = await Playlist.create({
                        name: playlistName,
                        description: 'Auto-generated by Smart Scheduler',
                        is_shuffle: 0,
                        user_id: userId,
                        youtube_channel_id: channelId
                    });

                    for (let pos = 0; pos < videosToAdd.length; pos++) {
                        await Playlist.addVideo(newPlaylist.id, videosToAdd[pos].id, pos + 1);
                    }

                    targetId = newPlaylist.id;
                    // Title Fallback (Random video from list)
                    const randomVid = videosToAdd[Math.floor(Math.random() * videosToAdd.length)];
                    streamTitle = randomVid.title;
                    streamDescription = `Auto-generated stream featuring ${videosToAdd[0].title} and more.`;
                }

                // Override Title with Custom Title if available
                if (customTitles && customTitles.length > 0) {
                    streamTitle = customTitles[Math.floor(Math.random() * customTitles.length)];
                }

                // Random Thumbnail
                let selectedThumbnailPath = null;
                let selectedThumbnailId = null;
                if (allThumbnails.length > 0) {
                    const randThumb = allThumbnails[Math.floor(Math.random() * allThumbnails.length)];
                    selectedThumbnailId = randThumb.id;
                    // Ensure path logic matches Dashboard/Stream logic
                    // Stream.create expects 'youtube_thumbnail' to be the path?
                    // Looking at Stream.js: youtube_thumbnail, thumbnail_id.
                    // Usually we set youtube_thumbnail to the absolute/relative path for the uploader service.
                    selectedThumbnailPath = randThumb.filepath;
                }

                // Create Stream
                const streamData = {
                    title: streamTitle.substring(0, 100),
                    video_id: targetId,
                    schedule_time: streamStartTime.toISOString(),
                    end_time: streamEndTime.toISOString(),
                    duration: durationSeconds,
                    status: 'scheduled',
                    platform: 'YouTube',
                    platform_icon: 'brand-youtube',
                    loop_video: true,
                    use_advanced_settings: true,
                    user_id: userId,
                    youtube_channel_id: channelId,
                    youtube_description: streamDescription,
                    youtube_privacy: 'unlisted',
                    youtube_category: '10',
                    youtube_tags: 'auto-generated,smart-rotation',
                    // Random Thumbnail assignments
                    youtube_thumbnail: selectedThumbnailPath,
                    thumbnail_id: selectedThumbnailId
                };

                await Stream.create(streamData);
                generatedStreams.push(streamData);

                // Next start time = End time + 5 min buffer
                nextStartTime = new Date(streamEndTime.getTime() + 5 * 60000);
            }
        }

        console.log(`[AutoScheduler] Generated ${generatedStreams.length} streams.`);
        return { success: true, count: generatedStreams.length };
    }
}

module.exports = AutoSchedulerService;
