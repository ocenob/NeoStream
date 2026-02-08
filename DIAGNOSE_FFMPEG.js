const { exec } = require('child_process');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, process.env.DB_PATH || 'data/neostream.db');

console.log('=== NEOSTREAM FFMPEG DIAGNOSTIC ===');
console.log(`Time: ${new Date().toISOString()}`);

// 1. Get DB Live Count
const db = new sqlite3.Database(dbPath);
db.all("SELECT id, title, status, use_advanced_settings FROM streams WHERE status='live'", (err, rows) => {
    if (err) {
        console.error('DB Error:', err.message);
        return;
    }
    console.log(`\n[DATABASE] Found ${rows.length} streams with status='live':`);
    rows.forEach(r => {
        console.log(` - [${r.id}] ${r.title.substring(0, 30)}... (Advanced: ${r.use_advanced_settings})`);
    });
    db.close();

    // 2. Get Actual Process Count
    console.log('\n[SYSTEM] Checking running ffmpeg processes...');
    exec('ps aux | grep ffmpeg | grep -v grep | grep -v DIAGNOSE', (error, stdout, stderr) => {
        if (error) {
            console.log('No ffmpeg processes found (or error running ps).');
            return;
        }

        const lines = stdout.split('\n').filter(l => l.trim());
        console.log(`[SYSTEM] Found ${lines.length} running ffmpeg processes.`);

        let copyCount = 0;
        let transcodeCount = 0;

        lines.forEach((line, i) => {
            const isCopy = line.includes('-c:v copy');
            const isTranscode = line.includes('-c:v libx264') || line.includes('-c:v h264');

            if (isCopy) copyCount++;
            if (isTranscode) transcodeCount++;

            console.log(`\nProcess #${i + 1}:`);
            // Extract PID and Command
            const parts = line.split(/\s+/);
            const pid = parts[1];
            console.log(`  PID: ${pid}`);
            console.log(`  Mode: ${isCopy ? '✅ COPY (Low CPU)' : (isTranscode ? '⚠️ TRANSCODE (High CPU)' : '❓ UNKNOWN')}`);
            if (line.includes('anullsrc')) console.log('  Audio: Silent Injection (anullsrc)');

            // Try to find stream ID in args if possible (rtmp url often has id or key)
            const rtmpMatch = line.match(/rtmp:\/\/[^\s]+/);
            if (rtmpMatch) console.log(`  Target: ${rtmpMatch[0].substring(0, 40)}...`);
        });

        console.log('\n=== SUMMARY ===');
        console.log(`Database Live Streams: ${rows.length}`);
        console.log(`Actual FFmpeg Processes: ${lines.length}`);
        console.log(`Start Mode: ${copyCount} Copy / ${transcodeCount} Transcode`);

        if (lines.length > rows.length) {
            console.log('⚠️ WARNING: ZOMBIE PROCESSES DETECTED! (More processes than DB records)');
            console.log('Recommendation: Run "pm2 restart all" to kill orphans.');
        } else if (lines.length < rows.length) {
            console.log('⚠️ WARNING: GHOST STREAMS! (Database says live, but no process)');
            console.log('Recommendation: Database status is out of sync.');
        }

        if (transcodeCount > 0) {
            console.log('⚠️ WARNING: TRANSCODING DETECTED! This causes High CPU.');
            console.log('Check "use_advanced_settings" in your streams.');
        }
    });
});
