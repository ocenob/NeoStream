const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../db/database');
const Stream = require('../models/Stream');
const Playlist = require('../models/Playlist');
const Video = require('../models/Video');

let ffmpegPath;
try {
  // Try system ffmpeg first (works on Windows/Linux if in PATH)
  const { execSync } = require('child_process');
  execSync('ffmpeg -version', { stdio: 'ignore' });
  ffmpegPath = 'ffmpeg';
  console.log('[StreamingService] Using System FFmpeg (Global PATH)');
} catch (e) {
  // Fallback to installer
  if (fs.existsSync('/usr/bin/ffmpeg')) {
    ffmpegPath = '/usr/bin/ffmpeg';
  } else {
    ffmpegPath = ffmpegInstaller.path;
  }
  console.log(`[StreamingService] Using FFmpeg Installer: ${ffmpegPath}`);
}

// Hardware Encoder Detection
let cachedEncoder = null; // 'h264_nvenc', 'h264_qsv', 'h264_amf', or 'libx264'

function detectHardwareEncoder() {
  if (cachedEncoder) return cachedEncoder;
  try {
    const { execSync } = require('child_process');
    // Check available encoders
    // We limit output check to avoid large buffer issues, though 'ffmpeg -encoders' is usually safe
    const output = execSync(`"${ffmpegPath}" -encoders`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();

    // NVENC is detected but crashes (missing libcuda.so.1), so we skip it.
    /*
    if (output.includes('h264_nvenc')) {
      cachedEncoder = 'h264_nvenc';
      console.log('[StreamingService] Hardware Acceleration: NVIDIA NVENC enabled.');
    } else
    */
    if (output.includes('h264_qsv')) {
      cachedEncoder = 'h264_qsv';
      console.log('[StreamingService] Hardware Acceleration: Intel QSV enabled.');
    } else if (output.includes('h264_amf')) {
      cachedEncoder = 'h264_amf';
      console.log('[StreamingService] Hardware Acceleration: AMD AMF enabled.');
    } else {
      cachedEncoder = 'libx264';
      console.log('[StreamingService] No Hardware Acceleration found. Using CPU (libx264).');
    }
  } catch (e) {
    console.warn('[StreamingService] Failed to detect encoders. Defaulting to libx264.', e.message);
    cachedEncoder = 'libx264';
  }
  return cachedEncoder;
}

function getVideoEncoderArgs(resolution = '1280x720', bitrate = '2500k', fps = 30) {
  const encoder = detectHardwareEncoder();
  const args = [];

  // Parse bitrate/resolution if needed, but ffmpeg handles strings often.
  // We'll stick to simple insertion.

  if (encoder === 'h264_nvenc') {
    args.push(
      '-c:v', 'h264_nvenc',
      '-preset', 'medium', // Medium preset for NVENC (compatible)
      '-rc', 'cbr',
      '-b:v', bitrate,
      '-maxrate', bitrate,
      '-bufsize', `${parseInt(bitrate) * 2}k`,
      '-r', String(fps),
      '-g', String(fps * 2), // 2s GOP
      '-pix_fmt', 'yuv420p'
    );
  } else if (encoder === 'h264_qsv') {
    args.push(
      '-c:v', 'h264_qsv',
      '-preset', 'veryfast',
      '-b:v', bitrate,
      '-maxrate', bitrate,
      '-r', String(fps),
      '-g', String(fps * 2)
    );
  } else if (encoder === 'h264_amf') {
    args.push(
      '-c:v', 'h264_amf',
      '-usage', 'transcoding',
      '-rc', 'cbr',
      '-b:v', bitrate,
      '-maxrate', bitrate,
      '-r', String(fps),
      '-g', String(fps * 2)
    );
  } else {
    // libx264 fallback
    args.push(
      '-c:v', 'libx264',
      '-preset', 'veryfast', // Use veryfast to save CPU
      '-tune', 'zerolatency',
      '-profile:v', 'high',
      '-b:v', bitrate,
      '-maxrate', `${parseInt(bitrate) * 1.1}k`,
      '-bufsize', `${parseInt(bitrate) * 2}k`,
      '-pix_fmt', 'yuv420p',
      '-g', String(fps * 2),
      '-r', String(fps)
    );
  }

  if (resolution) {
    args.push('-s', resolution);
  }

  return args;
}

function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

const activeStreams = new Map();
const streamLogs = new Map();
const streamRetryCount = new Map();
const manuallyStoppingStreams = new Set();

const MAX_LOG_LINES = 50;
const MAX_RETRY_ATTEMPTS = 15;
const BASE_RETRY_DELAY = 2000;
const MAX_RETRY_DELAY = 30000;
const HEALTH_CHECK_INTERVAL = 30000;
const SYNC_INTERVAL = 60000;

// SAFETY: Limit the number of concurrent FFmpeg processes to prevent server crash
const MAX_CONCURRENT_STREAMS = process.env.MAX_CONCURRENT_STREAMS ? parseInt(process.env.MAX_CONCURRENT_STREAMS) : 10;

let schedulerService = null;
let syncIntervalId = null;
let healthCheckIntervalId = null;
let initialized = false;

function setSchedulerService(service) {
  schedulerService = service;

  if (!initialized) {
    initialized = true;
    syncIntervalId = setInterval(syncStreamStatuses, SYNC_INTERVAL);
    healthCheckIntervalId = setInterval(healthCheckStreams, HEALTH_CHECK_INTERVAL);
  }
}

function addStreamLog(streamId, message) {
  if (!streamLogs.has(streamId)) {
    streamLogs.set(streamId, []);
  }
  const logs = streamLogs.get(streamId);
  logs.push({ timestamp: new Date().toISOString(), message });
  if (logs.length > MAX_LOG_LINES) {
    logs.shift();
  }
}

function getStreamLogs(streamId) {
  return streamLogs.get(streamId) || [];
}

function cleanupStreamData(streamId) {
  streamRetryCount.delete(streamId);
  manuallyStoppingStreams.delete(streamId);
}

function getRetryDelay(retryCount) {
  const delay = Math.min(BASE_RETRY_DELAY * Math.pow(1.5, retryCount), MAX_RETRY_DELAY);
  return delay + Math.random() * 1000;
}

async function buildFFmpegArgsForPlaylist(stream, playlist) {
  if (!playlist.videos || playlist.videos.length === 0) {
    throw new Error('Playlist is empty');
  }

  const projectRoot = path.resolve(__dirname, '..');
  const rtmpUrl = `${stream.rtmp_url.replace(/\/$/, '')}/${stream.stream_key}`;
  const tempDir = path.join(projectRoot, 'temp');

  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  let videoPaths = [];
  const videos = playlist.is_shuffle ? shuffleArray(playlist.videos) : playlist.videos;

  for (const video of videos) {
    const relPath = video.filepath.startsWith('/') ? video.filepath.substring(1) : video.filepath;
    const fullPath = path.join(projectRoot, 'public', relPath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Video file not found: ${fullPath}`);
    }
    videoPaths.push(fullPath);
  }

  const concatFile = path.join(tempDir, `playlist_${stream.id}.txt`);
  let content = '';
  const loopCount = stream.loop_video ? 10000 : 1;

  for (let i = 0; i < loopCount; i++) {
    for (const vp of videoPaths) {
      content += `file '${vp.replace(/\\/g, '/')}'\n`;
    }
  }
  fs.writeFileSync(concatFile, content);

  const hasAudio = playlist.audios && playlist.audios.length > 0;

  if (!hasAudio) {
    console.log('[StreamingService] Playlist has no audio.');

    const bitrate = stream.bitrate ? `${stream.bitrate}k` : '2500k';
    const fps = stream.fps || 30;
    const resolution = stream.resolution || '1280x720';

    if (!stream.use_advanced_settings) {
      // LOW CPU MODE for Silence: Copy Video + Inject Silent Audio
      console.log('[StreamingService] Low CPU Mode (Copy) active. Generating silent audio.');
      return [
        '-nostdin',
        '-loglevel', 'info',
        '-re',
        '-fflags', '+genpts+igndts+discardcorrupt',
        '-avoid_negative_ts', 'make_zero',
        '-f', 'concat',
        '-safe', '0',
        '-i', concatFile,
        // Silent Audio Injection
        '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',

        // VIDEO: COPY
        '-c:v', 'copy',

        // AUDIO: Encode silence to AAC
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ar', '44100',
        '-ac', '2',

        '-shortest', // Stop when video ends
        '-f', 'flv',
        '-flvflags', 'no_duration_filesize',
        rtmpUrl
      ];
    }

    console.log('[StreamingService] Advanced/Standard Mode. Injecting silent audio with transcoding (HW Accel if avail).');

    // Normal Mode: Transcode Video (hopefully with HW) + Silent Audio
    const encoderArgs = getVideoEncoderArgs(resolution, bitrate, fps);

    return [
      '-nostdin',
      '-loglevel', 'info',
      '-re',
      '-fflags', '+genpts+igndts+discardcorrupt',
      '-avoid_negative_ts', 'make_zero',
      '-f', 'concat',
      '-safe', '0',
      '-i', concatFile,
      '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100', // Silent audio source

      ...encoderArgs,

      '-c:a', 'aac',
      '-b:a', '128k',
      '-ar', '44100',
      '-ac', '2',
      '-shortest', // Stop when video ends
      '-f', 'flv',
      '-flvflags', 'no_duration_filesize',
      rtmpUrl
    ];
  }




  let audioPaths = [];
  const audios = playlist.is_shuffle ? shuffleArray(playlist.audios) : playlist.audios;

  for (const audio of audios) {
    const relPath = audio.filepath.startsWith('/') ? audio.filepath.substring(1) : audio.filepath;
    const fullPath = path.join(projectRoot, 'public', relPath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Audio file not found: ${fullPath}`);
    }
    audioPaths.push(fullPath);
  }

  const audioConcatFile = path.join(tempDir, `playlist_audio_${stream.id}.txt`);
  let audioContent = '';
  for (let i = 0; i < 10000; i++) {
    for (const ap of audioPaths) {
      audioContent += `file '${ap.replace(/\\/g, '/')}'\n`;
    }
  }
  fs.writeFileSync(audioConcatFile, audioContent);

  if (!stream.use_advanced_settings) {
    console.log('[StreamingService] Playlist with Audio: Copying streams (Low CPU).');
    return [
      '-nostdin',
      '-loglevel', 'info',
      '-re',
      '-fflags', '+genpts+igndts+discardcorrupt',
      '-avoid_negative_ts', 'make_zero',
      '-f', 'concat',
      '-safe', '0',
      '-i', concatFile,
      '-f', 'concat',
      '-safe', '0',
      '-i', audioConcatFile,
      '-map', '0:v:0',
      '-map', '1:a:0',

      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ar', '44100',
      '-ac', '2',

      '-f', 'flv',
      '-flvflags', 'no_duration_filesize',
      rtmpUrl
    ];
  }

  // Advanced Mode: Transcoding
  console.log('[StreamingService] Advanced Mode. Enforcing transcoding using HW Accel if avail.');

  const resolution = stream.resolution || '1280x720';
  const bitrate = stream.bitrate ? `${stream.bitrate}k` : '2500k';
  const fps = stream.fps || 30;

  const encoderArgs = getVideoEncoderArgs(resolution, bitrate, fps);

  return [
    '-nostdin',
    '-loglevel', 'info',
    '-re',
    '-fflags', '+genpts+igndts+discardcorrupt',
    '-avoid_negative_ts', 'make_zero',
    '-f', 'concat',
    '-safe', '0',
    '-i', concatFile,
    '-f', 'concat',
    '-safe', '0',
    '-i', audioConcatFile,
    '-map', '0:v:0',
    '-map', '1:a:0',

    ...encoderArgs,

    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '44100',
    '-ac', '2',
    '-shortest',
    '-f', 'flv',
    '-flvflags', 'no_duration_filesize',
    rtmpUrl
  ];
}

async function buildFFmpegArgs(stream) {
  const streamWithVideo = await Stream.getStreamWithVideo(stream.id);

  if (streamWithVideo && streamWithVideo.video_type === 'playlist') {
    const playlist = await Playlist.findByIdWithVideos(stream.video_id);
    if (!playlist) {
      throw new Error('Playlist not found');
    }
    return await buildFFmpegArgsForPlaylist(stream, playlist);
  }

  const video = await Video.findById(stream.video_id);
  if (!video) {
    throw new Error('Video not found');
  }

  const relPath = video.filepath.startsWith('/') ? video.filepath.substring(1) : video.filepath;
  const projectRoot = path.resolve(__dirname, '..');
  const videoPath = path.join(projectRoot, 'public', relPath);

  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`);
  }

  const rtmpUrl = `${stream.rtmp_url.replace(/\/$/, '')}/${stream.stream_key}`;
  const loopValue = stream.loop_video ? '-1' : '0';

  if (!stream.use_advanced_settings) {
    // CRITICAL FIX: YouTube Live memerlukan audio + video
    // Jika video tidak punya audio, generate silent audio dengan anullsrc
    return [
      '-nostdin',
      '-loglevel', 'info',
      '-re',
      '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100', // Silent audio source
      '-fflags', '+genpts+igndts+discardcorrupt',
      '-avoid_negative_ts', 'make_zero',
      '-stream_loop', loopValue,
      '-i', videoPath,
      '-shortest', // Stop saat video selesai (bukan audio)
      '-c:v', 'copy',
      '-c:a', 'aac', // Encode silent audio ke AAC
      '-b:a', '128k',
      '-ar', '44100',
      '-f', 'flv',
      '-flvflags', 'no_duration_filesize',
      rtmpUrl
    ];
  }


  const resolution = stream.resolution || '1280x720';
  const bitrate = stream.bitrate || 2500;
  const fps = stream.fps || 30;

  // CRITICAL FIX: YouTube Live memerlukan audio + video (advanced mode)

  const encoderArgs = getVideoEncoderArgs(resolution, `${bitrate}k`, fps);

  return [
    '-nostdin',
    '-loglevel', 'info',
    '-re',
    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100', // Silent audio source
    '-fflags', '+genpts+igndts+discardcorrupt',
    '-avoid_negative_ts', 'make_zero',
    '-stream_loop', loopValue,
    '-i', videoPath,
    '-shortest', // Stop saat video selesai

    ...encoderArgs,

    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '44100',
    '-ac', '2',
    '-f', 'flv',
    '-flvflags', 'no_duration_filesize',
    rtmpUrl
  ];
}


const treeKill = require('tree-kill');

async function killFFmpegProcess(streamId, streamData) {
  return new Promise((resolve) => {
    if (!streamData || !streamData.process) {
      resolve(true);
      return;
    }

    const proc = streamData.process;

    if (proc.exitCode !== null) {
      resolve(true);
      return;
    }

    console.log(`[StreamingService] Killing process tree for stream ${streamId} (PID: ${proc.pid})`);

    treeKill(proc.pid, 'SIGTERM', (err) => {
      if (err) {
        console.error(`[StreamingService] Failed to kill process tree for ${streamId}:`, err);
        // Fallback to force kill if tree-kill fails
        try {
          proc.kill('SIGKILL');
        } catch (e) { }
      } else {
        console.log(`[StreamingService] Successfully killed process tree for stream ${streamId}`);
      }
      resolve(true);
    });

    // Safety timeout
    setTimeout(() => {
      if (proc.exitCode === null) {
        try {
          proc.kill('SIGKILL');
        } catch (e) { }
      }
      resolve(true);
    }, 5000);
  });
}

async function startStream(streamId, isRetry = false, baseUrl = null) {
  console.log(`[StreamingService] startStream called for ${streamId}, isRetry=${isRetry}`);
  try {
    if (!isRetry) {
      streamRetryCount.set(streamId, 0);
    }

    if (activeStreams.has(streamId)) {
      const existing = activeStreams.get(streamId);
      // LOCK CHECK: If process is null, it is initializing (Race Condition)
      if (!existing.process) {
        if (!isRetry) {
          console.log(`[StreamingService] Stream ${streamId} is initializing (Race Condition Prevention). Ignoring.`);
          return { success: true, message: 'Stream is starting' };
        }
        // If retry, proceed (lock will be overwritten/deleted)
      } else if (existing.process.exitCode === null) {
        if (!isRetry) {
          return { success: false, error: 'Stream is already active' };
        }
        addStreamLog(streamId, 'Killing existing FFmpeg process before restart...');
        manuallyStoppingStreams.add(streamId);
        await killFFmpegProcess(streamId, existing);
        manuallyStoppingStreams.delete(streamId);
      }
      activeStreams.delete(streamId);
    }

    // CHECK CONCURRENCY LIMIT
    const currentActiveCount = Array.from(activeStreams.values()).filter(s => s.status === 'live' || s.process).length;
    if (currentActiveCount >= MAX_CONCURRENT_STREAMS) {
      console.warn(`[StreamingService] CONCURRENCY LIMIT REACHED (${currentActiveCount}/${MAX_CONCURRENT_STREAMS}). Queuing or rejecting.`);
      addStreamLog(streamId, `Max concurrent streams reached (${MAX_CONCURRENT_STREAMS}). Please wait or upgrade server.`);
      return {
        success: false,
        error: `Server at maximum capacity (${MAX_CONCURRENT_STREAMS} streams). New streams are queued.`,
        isAtCapacity: true
      };
    }
    // SET LOCK
    activeStreams.set(streamId, { process: null, startTime: new Date().toISOString(), status: 'initializing' });

    let stream = await Stream.findById(streamId);
    if (!stream) {
      activeStreams.delete(streamId); // Cleanup lock
      return { success: false, error: 'Stream not found' };
    }

    const originalStartTime = stream.start_time;
    const originalEndTime = stream.end_time;

    if (stream.is_youtube_api) {
      const youtubeService = require('./youtubeService');
      const effectiveBaseUrl = baseUrl || process.env.BASE_URL || 'http://localhost:7575';



      addStreamLog(streamId, 'Creating YouTube broadcast...');

      try {
        const ytResult = await youtubeService.createYouTubeBroadcast(streamId, effectiveBaseUrl);
        if (!ytResult.success) {
          addStreamLog(streamId, `YouTube broadcast failed: ${ytResult.error}`);
          activeStreams.delete(streamId); // Cleanup lock
          return { success: false, error: ytResult.error || 'Failed to create YouTube broadcast' };
        }
        stream = await Stream.findById(streamId);

        addStreamLog(streamId, `YouTube broadcast created: ${ytResult.broadcastId}`);
      } catch (ytError) {
        addStreamLog(streamId, `YouTube API error: ${ytError.message}`);
        activeStreams.delete(streamId); // Cleanup lock
        return { success: false, error: `YouTube API error: ${ytError.message}` };
      }
    }

    if (!stream.rtmp_url || !stream.stream_key) {
      activeStreams.delete(streamId); // Cleanup lock
      return { success: false, error: 'Missing RTMP URL or stream key' };
    }

    const ffmpegArgs = await buildFFmpegArgs(stream);

    // DEBUG: Log the RTMP Target (Masked)
    const targetUrl = stream.rtmp_url ? stream.rtmp_url + '/' + (stream.stream_key ? stream.stream_key.substring(0, 4) + '****' : '???') : 'UNKNOWN';
    console.log(`[StreamingService] DEBUG: Target URL Base: ${stream.rtmp_url}`);
    console.log(`[StreamingService] DEBUG: Stream Key (First 4): ${stream.stream_key ? stream.stream_key.substring(0, 4) : 'NULL'}`);
    addStreamLog(streamId, `Preparing to stream to: ${targetUrl}`);
    addStreamLog(streamId, `FFmpeg Args Length: ${ffmpegArgs.length}`);


    console.log(`[StreamingService] Starting FFmpeg for stream ${streamId}`);
    addStreamLog(streamId, `Starting FFmpeg process`);


    // DEBUG: Log arguments
    console.log(`[StreamingService] DEBUG: Full FFmpeg Args: ${JSON.stringify(ffmpegArgs)}`);

    const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs, {
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    console.log(`[StreamingService] FFmpeg PID: ${ffmpegProcess.pid} for stream ${streamId}`);

    // CRITICAL: Daftarkan event handler SEGERA setelah spawn, sebelum operasi async lainnya
    // untuk memastikan tidak ada data yang hilang
    ffmpegProcess.stdout.on('data', (data) => {
      console.log(`[DEBUG] STDOUT HANDLER CALLED for stream ${streamId}`);
      const msg = data.toString().trim();
      if (msg) {
        console.log(`[DEBUG] STDOUT data: ${msg.substring(0, 100)}`);
        addStreamLog(streamId, `[OUT] ${msg}`);
        updateStreamActivity(streamId);
      }
    });

    ffmpegProcess.stderr.on('data', (data) => {
      console.log(`[DEBUG] STDERR HANDLER CALLED for stream ${streamId}`);
      const msg = data.toString().trim();
      if (msg) {
        console.log(`[DEBUG] STDERR data length: ${msg.length}, preview: ${msg.substring(0, 100)}`);
        if (msg.includes('frame=') || msg.includes('speed=')) {
          updateStreamActivity(streamId);
        } else {
          addStreamLog(streamId, `[FFmpeg] ${msg}`);
        }
      }
    });

    ffmpegProcess.on('exit', async (code, signal) => {
      console.log(`[StreamingService] FFmpeg exited for stream ${streamId}: code=${code}, signal=${signal}`);
      addStreamLog(streamId, `FFmpeg exited: code=${code}, signal=${signal}`);

      const wasActive = activeStreams.delete(streamId);
      const isManualStop = manuallyStoppingStreams.has(streamId);

      if (isManualStop) {
        manuallyStoppingStreams.delete(streamId);
        cleanupStreamData(streamId);
        return;
      }

      const currentStream = await Stream.findById(streamId);

      if (currentStream && currentStream.end_time) {
        const endTime = new Date(currentStream.end_time);
        const now = new Date();
        if (endTime.getTime() <= now.getTime()) {
          addStreamLog(streamId, 'Stream ended - scheduled end time reached');
          if (wasActive) {
            try {
              await Stream.updateStatus(streamId, 'offline', currentStream.user_id);
              if (schedulerService) {
                schedulerService.handleStreamStopped(streamId);
              }
            } catch (e) { }
          }
          cleanupStreamData(streamId);
          return;
        }
      }

      const shouldRetry = signal === 'SIGSEGV' || signal === 'SIGKILL' || signal === 'SIGPIPE' ||
        (code !== 0 && code !== null) || (code === null && signal === null);

      if (shouldRetry && currentStream && currentStream.status !== 'offline') {
        const retryCount = streamRetryCount.get(streamId) || 0;

        if (retryCount < MAX_RETRY_ATTEMPTS) {
          streamRetryCount.set(streamId, retryCount + 1);
          const delay = getRetryDelay(retryCount);

          addStreamLog(streamId, `Retry #${retryCount + 1} in ${Math.round(delay / 1000)}s`);

          setTimeout(async () => {
            try {
              const latestStream = await Stream.findById(streamId);
              if (latestStream && latestStream.status !== 'offline') {
                if (latestStream.end_time) {
                  const endTime = new Date(latestStream.end_time);
                  const now = new Date();
                  if (endTime.getTime() <= now.getTime()) {
                    await Stream.updateStatus(streamId, 'offline', latestStream.user_id);
                    cleanupStreamData(streamId);
                    return;
                  }
                }
                const result = await startStream(streamId, true, baseUrl);
                if (!result.success) {
                  await Stream.updateStatus(streamId, 'offline', latestStream.user_id);
                  cleanupStreamData(streamId);
                }
              } else {
                cleanupStreamData(streamId);
              }
            } catch (e) {
              cleanupStreamData(streamId);
            }
          }, delay);
          return;
        } else {
          addStreamLog(streamId, `Max retries (${MAX_RETRY_ATTEMPTS}) reached`);
        }
      }

      if (wasActive && currentStream) {
        try {
          await Stream.updateStatus(streamId, 'offline', currentStream.user_id);

          // Release pooled key if YouTube and clear broadcast
          if (currentStream.is_youtube_api) {
            const youtubeService = require('./youtubeService');
            if (currentStream.youtube_channel_id && currentStream.stream_key) {
              await youtubeService.releasePooledKey(currentStream.youtube_channel_id, currentStream.stream_key);
            }
            await youtubeService.deleteYouTubeBroadcast(streamId);
          }

          if (schedulerService) {
            schedulerService.handleStreamStopped(streamId);
          }
        } catch (e) { }
        cleanupStreamData(streamId);
      }
    });

    ffmpegProcess.on('error', async (err) => {
      addStreamLog(streamId, `Process error: ${err.message}`);
      activeStreams.delete(streamId);
      try {
        await Stream.updateStatus(streamId, 'offline', stream.user_id);
      } catch (e) { }
      cleanupStreamData(streamId);
    });

    // Setelah semua event handler didaftarkan, baru set activeStreams dan update status
    let startTimeIso;
    if (isRetry && originalStartTime) {
      startTimeIso = originalStartTime;
    } else {
      startTimeIso = new Date().toISOString();
    }

    activeStreams.set(streamId, {
      process: ffmpegProcess,
      userId: stream.user_id,
      startTime: startTimeIso,
      endTime: originalEndTime,
      pid: ffmpegProcess.pid,
      lastActivity: Date.now()
    });

    if (!isRetry) {
      await Stream.updateStatus(streamId, 'live', stream.user_id, { startTimeOverride: startTimeIso });
    }

    if (schedulerService && originalEndTime) {
      if (typeof schedulerService.scheduleStreamTerminationByEndTime === 'function') {
        schedulerService.scheduleStreamTerminationByEndTime(streamId, originalEndTime, stream.user_id);
      }
    }

    return {
      success: true,
      message: 'Stream started successfully',
      isAdvancedMode: stream.use_advanced_settings
    };
  } catch (error) {
    console.error(`[StreamingService] CRITICAL START ERROR for ${streamId}:`, error);
    addStreamLog(streamId, `Start failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

function updateStreamActivity(streamId) {
  const streamData = activeStreams.get(streamId);
  if (streamData) {
    streamData.lastActivity = Date.now();
  }
}

async function stopStream(streamId) {
  try {
    const streamData = activeStreams.get(streamId);
    const stream = await Stream.findById(streamId);

    if (!streamData) {
      if (stream && stream.status === 'live') {
        await Stream.updateStatus(streamId, 'offline', stream.user_id);
        if (schedulerService) {
          schedulerService.handleStreamStopped(streamId);
        }
        cleanupStreamData(streamId);
        return { success: true, message: 'Stream status fixed' };
      }
      return { success: false, error: 'Stream is not active' };
    }

    addStreamLog(streamId, 'Stopping stream...');
    manuallyStoppingStreams.add(streamId);

    await killFFmpegProcess(streamId, streamData);

    activeStreams.delete(streamId);
    cleanupTempFiles(streamId);

    if (stream) {
      if (stream.is_youtube_api && stream.youtube_broadcast_id) {
        try {
          const youtubeService = require('./youtubeService');
          await youtubeService.deleteYouTubeBroadcast(streamId);

          // Release pooled key
          if (stream.youtube_channel_id && stream.stream_key) {
            await youtubeService.releasePooledKey(stream.youtube_channel_id, stream.stream_key);
          }
        } catch (e) { }
      }

      await saveStreamHistory(stream);
      await Stream.updateStatus(streamId, 'offline', stream.user_id);
    }

    if (schedulerService) {
      schedulerService.handleStreamStopped(streamId);
    }

    cleanupStreamData(streamId);
    return { success: true, message: 'Stream stopped successfully' };
  } catch (error) {
    manuallyStoppingStreams.delete(streamId);
    return { success: false, error: error.message };
  }
}

function cleanupTempFiles(streamId) {
  const tempDir = path.join(__dirname, '..', 'temp');
  const files = [
    path.join(tempDir, `playlist_${streamId}.txt`),
    path.join(tempDir, `playlist_audio_${streamId}.txt`)
  ];

  for (const file of files) {
    try {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    } catch (e) { }
  }
}

function isStreamActive(streamId) {
  const streamData = activeStreams.get(streamId);
  if (!streamData) return false;

  if (streamData.process && streamData.process.exitCode !== null) {
    activeStreams.delete(streamId);
    return false;
  }

  return true;
}

function getActiveStreams() {
  return Array.from(activeStreams.keys());
}

function getActiveStreamInfo(streamId) {
  const streamData = activeStreams.get(streamId);
  if (!streamData) return null;

  return {
    streamId,
    userId: streamData.userId,
    startTime: streamData.startTime,
    endTime: streamData.endTime,
    pid: streamData.pid,
    lastActivity: streamData.lastActivity,
    retryCount: streamRetryCount.get(streamId) || 0
  };
}


async function syncStreamStatuses() {
  try {
    const liveStreams = await Stream.findAll(null, 'live');

    for (const stream of liveStreams) {
      const isActive = activeStreams.has(stream.id);

      if (!isActive) {
        const retryCount = streamRetryCount.get(stream.id);
        if (retryCount !== undefined && retryCount < MAX_RETRY_ATTEMPTS) {
          continue;
        }

        if (stream.end_time) {
          const endTime = new Date(stream.end_time);
          if (endTime.getTime() <= Date.now()) {
            await Stream.updateStatus(stream.id, 'offline', stream.user_id);
            cleanupStreamData(stream.id);
            continue;
          }
        }

        console.log(`[StreamingService] Stream ${stream.id} is LIVE in DB but NOT in active memory. Fixing status to offline.`);
        await Stream.updateStatus(stream.id, 'offline', stream.user_id, { preserveEndTime: true });
        cleanupStreamData(stream.id);
      }
    }

    for (const [streamId, streamData] of activeStreams) {
      const stream = await Stream.findById(streamId);

      if (!stream) {
        const proc = streamData.process;
        if (proc && typeof proc.kill === 'function') {
          try {
            proc.kill('SIGTERM');
          } catch (e) { }
        }
        activeStreams.delete(streamId);
        cleanupStreamData(streamId);
        continue;
      }

      if (stream.status !== 'live') {
        await Stream.updateStatus(streamId, 'live', stream.user_id);
      }

      if (streamData.process && streamData.process.exitCode !== null) {
        activeStreams.delete(streamId);
        await Stream.updateStatus(streamId, 'offline', stream.user_id);
        cleanupStreamData(streamId);
      }
    }
  } catch (error) { }
}

async function healthCheckStreams() {
  try {
    const now = Date.now();
    const staleThreshold = 5 * 60 * 1000;

    for (const [streamId, streamData] of activeStreams) {
      if (streamData.process && streamData.process.exitCode !== null) {
        activeStreams.delete(streamId);
        const stream = await Stream.findById(streamId);
        if (stream && stream.status === 'live') {
          if (stream.end_time) {
            const endTime = new Date(stream.end_time);
            if (endTime.getTime() <= Date.now()) {
              await Stream.updateStatus(streamId, 'offline', stream.user_id);
              cleanupStreamData(streamId);
              continue;
            }
          }
          await Stream.updateStatus(streamId, 'offline', stream.user_id, { preserveEndTime: true });
        }
        cleanupStreamData(streamId);
        continue;
      }

      if (streamData.lastActivity && (now - streamData.lastActivity) > staleThreshold) {
        console.warn(`[StreamingService] Stream ${streamId} appears stale (no activity for 5m). Restarting...`);
        addStreamLog(streamId, 'Stream appears stale, restarting...');

        const stream = await Stream.findById(streamId);
        if (stream && stream.status === 'live') {
          if (stream.end_time) {
            const endTime = new Date(stream.end_time);
            if (endTime.getTime() <= Date.now()) {
              manuallyStoppingStreams.add(streamId);
              await killFFmpegProcess(streamId, streamData);
              activeStreams.delete(streamId);
              manuallyStoppingStreams.delete(streamId);
              await Stream.updateStatus(streamId, 'offline', stream.user_id);
              cleanupStreamData(streamId);
              continue;
            }
          }

          manuallyStoppingStreams.add(streamId);
          await killFFmpegProcess(streamId, streamData);
          activeStreams.delete(streamId);
          manuallyStoppingStreams.delete(streamId);

          setTimeout(async () => {
            try {
              const currentStream = await Stream.findById(streamId);
              if (currentStream && currentStream.status === 'live') {
                await startStream(streamId, true);
              }
            } catch (e) { }
          }, 3000);
        }
      }
    }
  } catch (error) { }
}

async function saveStreamHistory(stream) {
  try {
    if (!stream.start_time) {
      return false;
    }

    const startTime = new Date(stream.start_time);
    const endTime = new Date();
    const durationSeconds = Math.floor((endTime - startTime) / 1000);

    if (durationSeconds < 10) {
      return false;
    }

    const videoDetails = stream.video_id ? await Video.findById(stream.video_id) : null;

    const historyData = {
      id: uuidv4(),
      stream_id: stream.id,
      title: stream.title,
      platform: stream.platform || 'Custom',
      platform_icon: stream.platform_icon,
      video_id: stream.video_id,
      video_title: videoDetails ? videoDetails.title : null,
      resolution: stream.resolution,
      bitrate: stream.bitrate,
      fps: stream.fps,
      start_time: stream.start_time,
      end_time: endTime.toISOString(),
      duration: durationSeconds,
      use_advanced_settings: stream.use_advanced_settings ? 1 : 0,
      user_id: stream.user_id
    };

    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO stream_history (
          id, stream_id, title, platform, platform_icon, video_id, video_title,
          resolution, bitrate, fps, start_time, end_time, duration, use_advanced_settings, user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          historyData.id, historyData.stream_id, historyData.title,
          historyData.platform, historyData.platform_icon, historyData.video_id, historyData.video_title,
          historyData.resolution, historyData.bitrate, historyData.fps,
          historyData.start_time, historyData.end_time, historyData.duration,
          historyData.use_advanced_settings, historyData.user_id
        ],
        function (err) {
          if (err) {
            return reject(err);
          }
          resolve(historyData);
        }
      );
    });
  } catch (error) {
    return false;
  }
}

async function gracefulShutdown() {
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
  }
  if (healthCheckIntervalId) {
    clearInterval(healthCheckIntervalId);
    healthCheckIntervalId = null;
  }

  const streamIds = Array.from(activeStreams.keys());

  for (const streamId of streamIds) {
    try {
      const streamData = activeStreams.get(streamId);

      manuallyStoppingStreams.add(streamId);
      await killFFmpegProcess(streamId, streamData);

      const stream = await Stream.findById(streamId);
      if (stream) {
        await Stream.updateStatus(streamId, 'offline', stream.user_id);
      }

      activeStreams.delete(streamId);
      cleanupStreamData(streamId);
    } catch (e) { }
  }
}

process.on('SIGTERM', async () => {
  await gracefulShutdown();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await gracefulShutdown();
  process.exit(0);
});

module.exports = {
  startStream,
  stopStream,
  isStreamActive,
  getActiveStreams,
  getActiveStreamInfo,
  getStreamLogs,
  syncStreamStatuses,
  healthCheckStreams,
  saveStreamHistory,
  gracefulShutdown,
  setSchedulerService
};

exports.testLog = () => { console.log("[StreamingService] Test log inside module"); };
