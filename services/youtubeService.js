const { google } = require('googleapis');
const { encrypt, decrypt } = require('../utils/encryption');
const User = require('../models/User');
const Stream = require('../models/Stream');
const YoutubeChannel = require('../models/YoutubeChannel');
const fs = require('fs');
const path = require('path');

const loggedAlreadyHasBroadcast = new Set();

function getYouTubeOAuth2Client(clientId, clientSecret, redirectUri) {
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

async function createYouTubeBroadcast(streamId, baseUrl) {
  const stream = await Stream.findById(streamId);
  if (!stream) {
    throw new Error('Stream not found');
  }

  if (!stream.is_youtube_api) {
    return { success: true, message: 'Not a YouTube API stream' };
  }

  if (stream.youtube_broadcast_id && stream.rtmp_url && stream.stream_key) {
    if (!loggedAlreadyHasBroadcast.has(streamId)) {
      console.log(`[YouTubeService] Stream ${streamId} already has YouTube broadcast, skipping creation`);
      loggedAlreadyHasBroadcast.add(streamId);
    }
    return {
      success: true,
      rtmpUrl: stream.rtmp_url,
      streamKey: stream.stream_key,
      broadcastId: stream.youtube_broadcast_id,
      streamId: stream.youtube_stream_id
    };
  }

  const user = await User.findById(stream.user_id);
  if (!user || !user.youtube_client_id || !user.youtube_client_secret) {
    throw new Error('YouTube API credentials not configured');
  }

  const selectedChannel = await YoutubeChannel.findById(stream.youtube_channel_id);
  if (!selectedChannel || !selectedChannel.access_token || !selectedChannel.refresh_token) {
    throw new Error('YouTube channel not found or not connected');
  }

  const clientSecret = decrypt(user.youtube_client_secret);
  const accessToken = decrypt(selectedChannel.access_token);
  const refreshToken = decrypt(selectedChannel.refresh_token);

  if (!clientSecret || !accessToken) {
    throw new Error('Failed to decrypt YouTube credentials');
  }

  const redirectUri = `${baseUrl}/auth/youtube/callback`;
  const oauth2Client = getYouTubeOAuth2Client(user.youtube_client_id, clientSecret, redirectUri);
  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken
  });

  oauth2Client.on('tokens', async (tokens) => {
    if (tokens.access_token) {
      await YoutubeChannel.update(selectedChannel.id, {
        access_token: encrypt(tokens.access_token)
      });
    }
    if (tokens.refresh_token) {
      await YoutubeChannel.update(selectedChannel.id, {
        refresh_token: encrypt(tokens.refresh_token)
      });
    }
  });

  const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

  const tagsArray = stream.youtube_tags ? stream.youtube_tags.split(',').map(t => t.trim()).filter(t => t) : [];

  const broadcastSnippet = {
    title: stream.title,
    description: stream.youtube_description || '',
    scheduledStartTime: new Date().toISOString()
  };

  console.log(`[YouTubeService] Creating YouTube broadcast for stream ${streamId}`);

  const broadcastResponse = await youtube.liveBroadcasts.insert({
    part: 'snippet,contentDetails,status',
    requestBody: {
      snippet: broadcastSnippet,
      contentDetails: {
        enableAutoStart: true,
        enableAutoStop: true,
        monitorStream: {
          enableMonitorStream: false
        }
      },
      status: {
        privacyStatus: stream.youtube_privacy || 'unlisted',
        selfDeclaredMadeForKids: false
      }
    }
  });

  const broadcast = broadcastResponse.data;
  console.log(`[YouTubeService] Created broadcast: ${broadcast.id}`);

  // Update Metadata
  if (tagsArray.length > 0 || stream.youtube_category) {
    try {
      const videoResponse = await youtube.videos.list({
        part: 'snippet',
        id: broadcast.id
      });
      if (videoResponse.data.items && videoResponse.data.items.length > 0) {
        const currentSnippet = videoResponse.data.items[0].snippet;
        await youtube.videos.update({
          part: 'snippet',
          requestBody: {
            id: broadcast.id,
            snippet: {
              title: stream.title,
              description: stream.youtube_description || '',
              categoryId: stream.youtube_category || '22',
              tags: tagsArray.length > 0 ? tagsArray : currentSnippet.tags,
              defaultLanguage: currentSnippet.defaultLanguage,
              defaultAudioLanguage: currentSnippet.defaultAudioLanguage
            }
          }
        });
      }
    } catch (e) {
      console.log('[YouTubeService] Note: Could not update video metadata:', e.message);
    }
  }

  // Upload Thumbnail
  if (stream.youtube_thumbnail) {
    try {
      const projectRoot = path.resolve(__dirname, '..');
      const thumbnailPath = path.join(projectRoot, 'public', stream.youtube_thumbnail);
      if (fs.existsSync(thumbnailPath)) {
        const thumbnailStream = fs.createReadStream(thumbnailPath);
        await youtube.thumbnails.set({
          videoId: broadcast.id,
          media: {
            mimeType: 'image/jpeg',
            body: thumbnailStream
          }
        });
        console.log(`[YouTubeService] Uploaded thumbnail for broadcast ${broadcast.id}`);
      }
    } catch (e) {
      console.log('[YouTubeService] Note: Could not upload thumbnail:', e.message);
    }
  }

  // --- POOLED KEY LOGIC (DISABLED to restore streamflow-ori stability) ---
  const YoutubeStreamKey = require('../models/YoutubeStreamKey');
  // Force NULL to bypass pooled key logic and create new unique stream key
  const availableKey = null; // await YoutubeStreamKey.findAvailable(stream.youtube_channel_id);

  let liveStream;
  let rtmpUrl;
  let streamKey;

  if (availableKey && availableKey.youtube_stream_id) {
    console.log(`[YouTubeService] Using pooled stream key: ${availableKey.name} (${availableKey.stream_key})`);

    try {
      // Bind the NEW broadcast to the EXISTING stream ID
      await youtube.liveBroadcasts.bind({
        part: 'id,contentDetails',
        id: broadcast.id,
        streamId: availableKey.youtube_stream_id
      });

      // Get Ingestion Info from YouTube
      const streamInfo = await youtube.liveStreams.list({
        part: 'cdn',
        id: availableKey.youtube_stream_id
      });

      if (streamInfo.data.items && streamInfo.data.items.length > 0) {
        const ytStream = streamInfo.data.items[0];
        rtmpUrl = ytStream.cdn.ingestionInfo.ingestionAddress;
        streamKey = ytStream.cdn.ingestionInfo.streamName;
        liveStream = ytStream;

        // Mark as used in DB
        await YoutubeStreamKey.markAsUsed(availableKey.id);
      } else {
        throw new Error('Pooled key found in DB but not on YouTube');
      }
    } catch (bindError) {
      console.error(`[YouTubeService] Failed to bind pooled key ${availableKey.name}:`, bindError.message);
      // Fallback: liveStream remains null, so new stream will be created below
    }
  } else {
    console.log('[YouTubeService] No available pooled keys found.');
  }

  // Fallback: Create NEW Live Stream
  if (!liveStream) {
    console.log(`[YouTubeService] Creating new unique live stream (fallback)...`);
    const streamResponse = await youtube.liveStreams.insert({
      part: 'snippet,cdn,contentDetails,status',
      requestBody: {
        snippet: { title: `${stream.title} - Stream` },
        cdn: { frameRate: '30fps', ingestionType: 'rtmp', resolution: '1080p' },
        contentDetails: { isReusable: false }
      }
    });

    liveStream = streamResponse.data;
    console.log(`[YouTubeService] Created live stream: ${liveStream.id}`);

    await youtube.liveBroadcasts.bind({
      part: 'id,contentDetails',
      id: broadcast.id,
      streamId: liveStream.id
    });

    rtmpUrl = liveStream.cdn.ingestionInfo.ingestionAddress;
    streamKey = liveStream.cdn.ingestionInfo.streamName;
  }

  await Stream.update(streamId, {
    youtube_broadcast_id: broadcast.id,
    youtube_stream_id: liveStream.id || liveStream.id,
    rtmp_url: rtmpUrl,
    stream_key: streamKey
  });

  console.log(`[YouTubeService] YouTube broadcast setup complete for stream ${streamId}`);

  return {
    success: true,
    broadcastId: broadcast.id,
    streamId: liveStream.id,
    rtmpUrl: rtmpUrl,
    streamKey: streamKey
  };
}

// Helper to release key
async function releasePooledKey(channelId, streamKeyString) {
  try {
    const { db } = require('../db/database');
    db.run(
      `UPDATE youtube_stream_keys SET status = 'available' 
       WHERE youtube_channel_id = ? AND stream_key = ? AND status = 'in-use'`,
      [channelId, streamKeyString],
      function (err) {
        if (err) console.error('[YouTubeService] Error releasing key DB:', err);
        else console.log(`[YouTubeService] Released pooled key: ${streamKeyString}`);
      }
    );
  } catch (error) {
    console.error('[YouTubeService] Error releasing pooled key:', error);
  }
}


async function deleteYouTubeBroadcast(streamId) {
  try {
    loggedAlreadyHasBroadcast.delete(streamId);

    const stream = await Stream.findById(streamId);
    if (!stream || !stream.is_youtube_api || !stream.youtube_broadcast_id) {
      return { success: true, message: 'No YouTube broadcast to clean up' };
    }

    await Stream.update(streamId, {
      rtmp_url: '',
      stream_key: '',
      youtube_broadcast_id: '',
      youtube_stream_id: ''
    });

    console.log(`[YouTubeService] Cleared YouTube broadcast credentials and IDs for stream ${streamId} to ensure fresh session on next start.`);

    return { success: true };
  } catch (error) {
    console.error('[YouTubeService] Error clearing YouTube broadcast data:', error);
    return { success: false, error: error.message };
  }
}

// Explicitly transition broadcast to live (Fix for "Stuck in Upcoming")
async function transitionBroadcastToLive(streamId, baseUrl) {
  try {
    const stream = await Stream.findById(streamId);
    if (!stream || !stream.is_youtube_api || !stream.youtube_broadcast_id) return;

    const user = await User.findById(stream.user_id);
    const channel = await YoutubeChannel.findById(stream.youtube_channel_id);
    if (!user || !channel) return;

    const clientSecret = decrypt(user.youtube_client_secret);
    const accessToken = decrypt(channel.access_token);
    const refreshToken = decrypt(channel.refresh_token);

    if (!clientSecret || !accessToken) return;

    const oauth2Client = getYouTubeOAuth2Client(user.youtube_client_id, clientSecret, `${baseUrl}/auth/youtube/callback`);
    oauth2Client.setCredentials({ access_token: accessToken, refresh_token: refreshToken });

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    // Retry loop: Try to transition for up to 60 seconds
    let attempts = 0;
    const maxAttempts = 12; // 12 * 5s = 60s

    console.log(`[YouTubeService] Starting transition monitor for stream ${streamId} (Broadcast: ${stream.youtube_broadcast_id})`);

    while (attempts < maxAttempts) {
      try {
        // Check Status First
        const castRes = await youtube.liveBroadcasts.list({
          part: 'status',
          id: stream.youtube_broadcast_id
        });
        const status = castRes.data.items[0]?.status?.lifeCycleStatus;

        if (status === 'live') {
          console.log(`[YouTubeService] Broadcast ${stream.youtube_broadcast_id} is already LIVE.`);
          return;
        }
        if (status === 'complete' || status === 'revoked') {
          console.log(`[YouTubeService] Broadcast ${stream.youtube_broadcast_id} is ${status}, cannot transition.`);
          return;
        }

        // Attempt Transition
        // Note: This will fail if stream is not yet 'active' (receiving data)
        console.log(`[YouTubeService] Attempting transition to LIVE (Try ${attempts + 1}/${maxAttempts})...`);
        await youtube.liveBroadcasts.transition({
          part: 'id,status',
          id: stream.youtube_broadcast_id,
          broadcastStatus: 'live'
        });

        console.log(`[YouTubeService] SUCCESS: Broadcast ${stream.youtube_broadcast_id} transitioned to LIVE.`);
        return;

      } catch (err) {
        // Known error: "Stream is inactive" -> Wait and Retry
        const msg = err.message || '';
        if (msg.includes('stream is inactive') || msg.includes('Stream is inactive')) {
          console.log(`[YouTubeService] Stream not ready yet. Retrying in 5s...`);
        } else {
          console.log(`[YouTubeService] Transition error: ${msg}. Retrying in 5s...`);
        }
      }

      await new Promise(r => setTimeout(r, 5000));
      attempts++;
    }
    console.log(`[YouTubeService] Timeout: Could not transition broadcast ${stream.youtube_broadcast_id} to live after 60s.`);

  } catch (error) {
    console.error(`[YouTubeService] Critical error in transition logic: ${error.message}`);
  }
}

module.exports = {
  createYouTubeBroadcast,
  deleteYouTubeBroadcast,
  getYouTubeOAuth2Client,
  transitionBroadcastToLive
};
