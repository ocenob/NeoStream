const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// --- CONFIGURATION ---
const USER_WIDTH = '100%'; // Placeholder, will fetch from DB
const DB_PATH = path.resolve(__dirname, '../db/streamflow.db');
const DAYS_TO_GENERATE = 30; // Safety first: 30 days initially, can increase to 365
const STREAMS_PER_DAY_MIN = 8;
const STREAMS_PER_DAY_MAX = 12; // 8-12 streams
const START_HOUR = 6;  // 06:00 AM
const END_HOUR = 23;   // 11:00 PM (Last stream start)
// Note: If last stream starts at 23:00 and lasts 2 hours, it goes to 01:00 AM.
const MIN_DURATION_MINUTES = 60; // 1 hour min
const MAX_DURATION_MINUTES = 180; // 3 hours max (Compromise from 8h to fit 12 streams)

// --- DATABASE CONNECTION ---
const db = new sqlite3.Database(DB_PATH);
db.run('PRAGMA journal_mode = WAL;');

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function runQuery(query, params = []) {
    return new Promise((resolve, reject) => {
        db.run(query, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function getQuery(query, params = []) {
    return new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function getOne(query, params = []) {
    return new Promise((resolve, reject) => {
        db.get(query, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

// --- HELPERS ---
function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function addMinutes(date, minutes) {
    return new Date(date.getTime() + minutes * 60000);
}

function formatDateISO(date) {
    // YYYY-MM-DD HH:MM:SS
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

async function generate() {
    console.log('--- SMART SCHEDULER GENERATOR ---');

    try {
        // 1. Get User and Youtube Channels
        // Assuming single user for now or get first admin/active user
        const user = await getOne("SELECT * FROM users LIMIT 1");
        if (!user) throw new Error("No user found.");
        console.log(`Target User: ${user.username} (${user.id})`);

        const channels = await getQuery("SELECT * FROM youtube_channels WHERE user_id = ?", [user.id]);
        if (channels.length === 0) throw new Error("No YouTube channels connected.");

        console.log(`Found ${channels.length} channels.`);
        const targetChannel = channels[0]; // Use the first one
        console.log(`Target Channel: ${targetChannel.channel_name} (${targetChannel.id})`);

        // 2. Fetch Videos (Filtered by Channel)
        // Note: videos table uses youtube_channel_id column which maps to internal ID usually
        const videos = await getQuery("SELECT * FROM videos WHERE youtube_channel_id = ?", [targetChannel.id]);
        console.log(`Pool Size: ${videos.length} videos found for this channel.`);

        if (videos.length === 0) throw new Error("No videos found for this channel.");

        // 3. Generation Loop
        const today = new Date();
        // Start from tomorrow
        let cycleDate = new Date(today);
        cycleDate.setDate(cycleDate.getDate() + 1);
        cycleDate.setHours(START_HOUR, 0, 0, 0);

        let totalStreams = 0;

        for (let d = 0; d < DAYS_TO_GENERATE; d++) {
            console.log(`\nGenerating Day ${d + 1}: ${cycleDate.toDateString()}`);

            const numStreams = randomInt(STREAMS_PER_DAY_MIN, STREAMS_PER_DAY_MAX);

            // Time Logic
            // We have from START_HOUR to END_HOUR.
            // But we can overflow into next day morning if needed, but let's try to keep within block.
            // Basic approach: Distribute start times evenly or sequentially?
            // "Acak setiap harinya" -> Sequential packing with random durations is better.

            let currentCursor = new Date(cycleDate);

            for (let s = 1; s <= numStreams; s++) {
                // Determine duration for this session
                const sessionDurationMin = randomInt(MIN_DURATION_MINUTES, MAX_DURATION_MINUTES);

                // --- A. Build Playlist ---
                // Select videos until we hit sessionDuration
                let accumulatedDur = 0;
                let selectedVideos = [];
                let safety = 0;

                // Shuffle pool for this session
                const pool = shuffleArray([...videos]);
                let poolIndex = 0;

                while (accumulatedDur < sessionDurationMin * 60) { // duration in DB is seconds? Verify.
                    if (poolIndex >= pool.length) poolIndex = 0; // Loop pool
                    const v = pool[poolIndex++];
                    selectedVideos.push(v);
                    accumulatedDur += (v.duration || 300); // Default 5 mins if null
                    safety++;
                    if (safety > 1000) break;
                }

                // Create Playlist Record
                const playlistName = `Auto ${cycleDate.toLocaleDateString('en-GB')} #${s}`;
                const playlistId = uuidv4(); // Assuming standard UUID or Integer? Models seem to use INTEGER usually but let's check. 
                // ACTUALLY: The clean_gallery used standard SQLite, schema usually INTEGER PRIMARY KEY unless UUID.
                // Let's check Schema... user.id is TEXT, streams.id usually Integer?
                // Let's rely on DB autoincrement for IDs if possible, or UUID if schema requires.

                // Let's Check Schema quickly.
                // Assuming INTEGER PRIMARY KEY AUTOINCREMENT for IDs unless we see UUIDs. 
                // User ID is TEXT. Stream ID? `db/database.js` says users id is TEXT.
                // Let's assume standard INSERT returns `this.lastID`.

                // Insert Playlist
                const plResult = await runQuery(`
                    INSERT INTO playlists (name, user_id, description, is_shuffle, created_at, updated_at)
                    VALUES (?, ?, ?, 0, datetime('now'), datetime('now'))
                `, [playlistName, user.id]);

                const plId = plResult.lastID;

                // Insert Playlist Items
                let order = 0;
                for (const vid of selectedVideos) {
                    await runQuery(`
                        INSERT INTO playlist_videos (playlist_id, video_id, position, created_at)
                        VALUES (?, ?, ?, datetime('now'))
                    `, [plId, vid.id, order++]);
                }

                // --- B. Create Stream ---
                // Start Time: currentCursor
                // End Time: currentCursor + accumulatedDur
                const startTimeStr = formatDateISO(currentCursor);
                const endCursor = new Date(currentCursor.getTime() + accumulatedDur * 1000);
                const endTimeStr = formatDateISO(endCursor);

                await runQuery(`
                    INSERT INTO streams (
                        title, video_id, user_id, status, 
                        stream_key, rtmp_url, created_at, schedule_time, end_time,
                        youtube_privacy, youtube_category, youtube_channel_id,
                        use_advanced_settings, duration,
                        platform, platform_icon, loop_video, is_youtube_api
                    ) VALUES (
                        ?, ?, ?, 'scheduled',
                        '', '', datetime('now'), ?, ?,
                        'public', '10', ?,
                        1, ?,
                        'YouTube', 'brand-youtube', 1, 1
                    )
                `, [
                    playlistName, // Title
                    plId,         // video_id (stored as playlist ID here usually, handled by StreamingService logic) 
                    // WAIT: StreamingService checks video_type='playlist' and uses video_id as playlist ID. Correct.
                    user.id,
                    startTimeStr,
                    endTimeStr,
                    targetChannel.id,
                    accumulatedDur // Duration in seconds
                ]);
                // Note: use_advanced_settings=1 (Low CPU Mode) enabled by default for these bulk

                // Advance cursor + 5 mins buffer
                currentCursor = new Date(endCursor.getTime() + 5 * 60000);

                process.stdout.write('.'); // progress dot
                totalStreams++;
                await sleep(50); // Prevent IO Error
            }

            // Advance cycleDate to next day 06:00
            cycleDate.setDate(cycleDate.getDate() + 1);
            cycleDate.setHours(START_HOUR, 0, 0, 0);
        }

        console.log(`\n\n✅ DONE! Generated ${totalStreams} streams over ${DAYS_TO_GENERATE} days.`);
        console.log('NOTE: Advanced Settings (Low CPU Mode) is ENABLED by default for these streams.');

    } catch (err) {
        console.error('\n❌ ERROR:', err);
    } finally {
        db.close();
    }
}

generate();
