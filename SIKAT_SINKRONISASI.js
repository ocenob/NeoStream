const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function sikatSinkronisasi() {
    console.log('\n--- 🔥 SIKAT SINKRONISASI START 🔥 ---');

    // 1. KILL ALL ORPHAN FFMPEG
    console.log('\n[1] Membersihkan FFmpeg Orphan...');
    try {
        if (process.platform === 'win32') {
            execSync('taskkill /F /IM ffmpeg.exe', { stdio: 'ignore' });
        } else {
            execSync('pkill -9 ffmpeg', { stdio: 'ignore' });
        }
        console.log('✅ Semua proses FFmpeg telah dimatikan.');
    } catch (e) {
        console.log('ℹ️ Tidak ada proses FFmpeg yang berjalan.');
    }

    // 2. FIND ACTIVE DB
    const possibleDbs = [
        './data/neostream.db',
        './data/streamflow.db',
        './db/database.db',
        './db/streamflow.db'
    ];

    let activeDbPath = null;
    let fallbackDb = './data/neostream.db';

    for (const dbPath of possibleDbs) {
        if (fs.existsSync(dbPath)) {
            console.log(`\n🔍 Memeriksa Database: ${dbPath}`);
            const dbCheck = new sqlite3.Database(dbPath);
            const channelCount = await new Promise(resolve => {
                dbCheck.get('SELECT COUNT(*) as count FROM youtube_channels', (err, row) => {
                    resolve(row ? row.count : 0);
                });
            });
            dbCheck.close();

            if (channelCount > 0) {
                console.log(`✅ Database AKTIF ditemukan: ${dbPath} (${channelCount} channel)`);
                activeDbPath = dbPath;
                break;
            }
        }
    }

    if (!activeDbPath) {
        console.log('⚠️ Tidak menemukan channel di DB manapun. Menggunakan default.');
        activeDbPath = fallbackDb;
    }

    const db = new sqlite3.Database(activeDbPath);

    try {
        // 3. GET ADMIN USER ID
        const admin = await new Promise((resolve, reject) => {
            db.get('SELECT id, username FROM users WHERE user_role = "admin" OR user_role = "user" LIMIT 1', (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!admin) {
            console.error('❌ Tidak ditemukan user admin/user di database!');
            return;
        }

        console.log(`\n[2] User Pemilik: ${admin.username} (${admin.id})`);

        // 4. FIX CHANNEL OWNERSHIP
        console.log('\n[3] Memperbaiki User ID Channel...');
        await new Promise((resolve) => {
            db.run('UPDATE youtube_channels SET user_id = ?', [admin.id], function (err) {
                console.log(`✅ ${this.changes} channel telah diperbarui user_id-nya.`);
                resolve();
            });
        });

        // 5. RESET STREAM STATUSES
        console.log('\n[4] Mereset Status Stream & Rotasi...');
        await new Promise(resolve => {
            db.run('UPDATE streams SET status = "offline" WHERE status = "live"', function () {
                console.log(`✅ ${this.changes} stream reset ke offline.`);
                resolve();
            });
        });

        await new Promise(resolve => {
            db.run('UPDATE stream_rotations SET status = "active"', function () {
                console.log(`✅ Semua rotasi reset ke active.`);
                resolve();
            });
        });

        console.log('\n--- ✅ SINKRONISASI SELESAI ✅ ---');
        console.log('Silakan RESTART panel (pm2 restart neostream)');

    } catch (error) {
        console.error('❌ Terjadi kesalahan:', error.message);
    } finally {
        db.close();
    }
}

sikatSinkronisasi();
