
const Stream = require('../models/Stream');
const Rotation = require('../models/Rotation');
const youtubeService = require('./youtubeService');
const youtubeAnalyticsService = require('./youtubeAnalyticsService');

async function processPendingMetadataUpdates() {
    console.log('[MetadataWorker] Checking for pending metadata updates...');
    try {
        const streams = await Stream.findAllPendingPostLive();
        if (streams.length === 0) {
            console.log('[MetadataWorker] No pending updates found.');
            return;
        }

        const now = new Date();
        const baseUrl = process.env.BASE_URL || 'http://localhost:7575';

        for (const stream of streams) {
            try {
                // 1. Check Time Trigger (Target Sync Date)
                if (stream.target_sync_date) {
                    const targetDate = new Date(stream.target_sync_date);
                    if (now < targetDate) {
                        console.log(`[MetadataWorker] Stream ${stream.id} waiting for target date: ${stream.target_sync_date}`);
                        continue;
                    }
                }

                // 2. Check Performance Trigger (CTR)
                if (stream.post_live_ctr_threshold > 0) {
                    const actualCtr = await youtubeAnalyticsService.getVideoCTR(stream, stream.user_id, stream.youtube_channel_id);

                    if (actualCtr === null) {
                        console.log(`[MetadataWorker] No CTR data for ${stream.id} yet, skipping for now.`);
                        continue;
                    }

                    if (actualCtr >= stream.post_live_ctr_threshold) {
                        console.log(`[MetadataWorker] Stream ${stream.id} CTR (${actualCtr}%) is above threshold (${stream.post_live_ctr_threshold}%). No update needed.`);
                        // Optional: Mark as "skipped" or keep pending? 
                        // Let's keep it pending to check again tomorrow, maybe CTR drops.
                        continue;
                    }

                    console.log(`[MetadataWorker] Stream ${stream.id} CTR (${actualCtr}%) is below threshold (${stream.post_live_ctr_threshold}%). Proceeding with update.`);
                }

                // 3. Execute Update
                console.log(`[MetadataWorker] Executing metadata update for ${stream.id}`);
                const result = await youtubeService.updatePostLiveMetadata(stream.id, baseUrl);

                if (result.success) {
                    await Rotation.updateStreamPostLiveMetadata(stream.id, {
                        post_live_sync_status: 'completed'
                    });
                    console.log(`[MetadataWorker] Successfully updated ${stream.id}`);
                } else {
                    console.error(`[MetadataWorker] Failed to update ${stream.id}: ${result.error}`);
                }

            } catch (err) {
                console.error(`[MetadataWorker] Error processing stream ${stream.id}:`, err);
            }
        }
    } catch (error) {
        console.error('[MetadataWorker] Global Error:', error);
    }
}

// Start worker
function startMetadataWorker(intervalMs = 3600000) { // Default 1 hour
    console.log(`[MetadataWorker] Started with interval ${intervalMs}ms`);
    setInterval(processPendingMetadataUpdates, intervalMs);
    // Also run immediately on start
    processPendingMetadataUpdates();
}

module.exports = {
    startMetadataWorker,
    processPendingMetadataUpdates
};
