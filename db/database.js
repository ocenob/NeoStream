const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'database.db');
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to SQLite database at:', dbPath);
        initializeDatabase();
    }
});

function initializeDatabase() {
    db.serialize(() => {
        // Users table
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            avatar_path TEXT,
            user_role TEXT DEFAULT 'admin',
            status TEXT DEFAULT 'active',
            disk_limit INTEGER DEFAULT 0,
            welcome_shown INTEGER DEFAULT 0,
            email TEXT,
            youtube_client_id TEXT,
            youtube_client_secret TEXT,
            youtube_redirect_uri TEXT,
            youtube_access_token TEXT,
            youtube_refresh_token TEXT,
            youtube_channel_id TEXT,
            youtube_channel_name TEXT,
            gdrive_api_key TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Youtube Channels table
        db.run(`CREATE TABLE IF NOT EXISTS youtube_channels (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            channel_id TEXT NOT NULL,
            channel_name TEXT NOT NULL,
            channel_thumbnail TEXT,
            subscriber_count TEXT DEFAULT '0',
            video_count TEXT DEFAULT '0',
            access_token TEXT NOT NULL,
            refresh_token TEXT NOT NULL,
            is_default INTEGER DEFAULT 0,
            slug TEXT,
            description TEXT,
            channel_color TEXT DEFAULT '#0369a1',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )`);

        // Videos table
        db.run(`CREATE TABLE IF NOT EXISTS videos (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            filepath TEXT NOT NULL,
            thumbnail_path TEXT,
            file_size INTEGER,
            duration INTEGER,
            format TEXT,
            resolution TEXT,
            bitrate INTEGER,
            fps INTEGER,
            user_id TEXT NOT NULL,
            youtube_channel_id TEXT,
            upload_date DATETIME DEFAULT CURRENT_TIMESTAMP,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id),
            FOREIGN KEY (youtube_channel_id) REFERENCES youtube_channels (id)
        )`);

        // Streams table
        db.run(`CREATE TABLE IF NOT EXISTS streams (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            video_id TEXT,
            rtmp_url TEXT,
            stream_key TEXT,
            platform TEXT,
            platform_icon TEXT,
            bitrate INTEGER DEFAULT 2500,
            resolution TEXT,
            fps INTEGER DEFAULT 30,
            orientation TEXT DEFAULT 'horizontal',
            loop_video INTEGER DEFAULT 1,
            schedule_time DATETIME,
            start_time DATETIME,
            end_time DATETIME,
            duration INTEGER,
            status TEXT DEFAULT 'offline',
            status_updated_at DATETIME,
            use_advanced_settings INTEGER DEFAULT 0,
            user_id TEXT NOT NULL,
            youtube_broadcast_id TEXT,
            youtube_stream_id TEXT,
            youtube_description TEXT,
            youtube_privacy TEXT,
            youtube_category TEXT,
            youtube_tags TEXT,
            youtube_thumbnail TEXT,
            youtube_channel_id TEXT,
            is_youtube_api INTEGER DEFAULT 0,
            thumbnail_id TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id),
            FOREIGN KEY (video_id) REFERENCES videos (id),
            FOREIGN KEY (youtube_channel_id) REFERENCES youtube_channels (id)
        )`);

        // App Settings table
        db.run(`CREATE TABLE IF NOT EXISTS app_settings (
            setting_key TEXT PRIMARY KEY,
            setting_value TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Playlists table (referenced in Stream.js)
        db.run(`CREATE TABLE IF NOT EXISTS playlists (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            user_id TEXT NOT NULL,
            description TEXT,
            is_shuffle INTEGER DEFAULT 0,
            youtube_channel_id TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id),
            FOREIGN KEY (youtube_channel_id) REFERENCES youtube_channels (id)
        )`);

        // Playlist Videos (Relation)
        db.run(`CREATE TABLE IF NOT EXISTS playlist_videos (
            id TEXT PRIMARY KEY,
            playlist_id TEXT NOT NULL,
            video_id TEXT NOT NULL,
            position INTEGER DEFAULT 0,
            FOREIGN KEY (playlist_id) REFERENCES playlists (id) ON DELETE CASCADE,
            FOREIGN KEY (video_id) REFERENCES videos (id) ON DELETE CASCADE
        )`);

        // Playlist Audios (Relation)
        db.run(`CREATE TABLE IF NOT EXISTS playlist_audios (
            id TEXT PRIMARY KEY,
            playlist_id TEXT NOT NULL,
            audio_id TEXT NOT NULL,
            position INTEGER DEFAULT 0,
            FOREIGN KEY (playlist_id) REFERENCES playlists (id) ON DELETE CASCADE,
            FOREIGN KEY (audio_id) REFERENCES videos (id) ON DELETE CASCADE
        )`);

        // Thumbnails table (referenced in app.js)
        db.run(`CREATE TABLE IF NOT EXISTS thumbnails (
            id TEXT PRIMARY KEY,
            title TEXT,
            filepath TEXT NOT NULL,
            filename TEXT,
            original_filename TEXT,
            file_size INTEGER,
            width INTEGER DEFAULT 0,
            height INTEGER DEFAULT 0,
            user_id TEXT NOT NULL,
            youtube_channel_id TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id),
            FOREIGN KEY (youtube_channel_id) REFERENCES youtube_channels (id)
        )`);

        // Rotations table
        db.run(`CREATE TABLE IF NOT EXISTS stream_rotations (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            name TEXT NOT NULL,
            gap_minutes INTEGER DEFAULT 10,
            is_loop INTEGER DEFAULT 1,
            status TEXT DEFAULT 'active',
            current_index INTEGER DEFAULT 0,
            start_time DATETIME,
            end_time DATETIME,
            repeat_mode TEXT DEFAULT 'daily',
            youtube_channel_id TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id),
            FOREIGN KEY (youtube_channel_id) REFERENCES youtube_channels (id)
        )`);

        // Rotation Items table
        db.run(`CREATE TABLE IF NOT EXISTS rotation_items (
            id TEXT PRIMARY KEY,
            rotation_id TEXT NOT NULL,
            order_index INTEGER NOT NULL,
            video_id TEXT NOT NULL,
            title TEXT,
            description TEXT,
            tags TEXT,
            thumbnail_path TEXT,
            original_thumbnail_path TEXT,
            privacy TEXT DEFAULT 'unlisted',
            category TEXT DEFAULT '10',
            FOREIGN KEY (rotation_id) REFERENCES stream_rotations (id),
            FOREIGN KEY (video_id) REFERENCES videos (id)
        )`);
    });
}

function checkIfUsersExist() {
    return new Promise((resolve, reject) => {
        db.get('SELECT COUNT(*) as count FROM users', (err, row) => {
            if (err) {
                console.error('Error checking users existence:', err);
                return reject(err);
            }
            resolve(row.count > 0);
        });
    });
}

module.exports = {
    db,
    initializeDatabase,
    checkIfUsersExist
};
