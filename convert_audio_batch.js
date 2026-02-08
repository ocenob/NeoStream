const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const sqlite3 = require('sqlite3').verbose();
require('dotenv').config();

// CONFIGURATION
const CONCURRENCY = 1; // Process 1 file at a time to save CPU
const DELETE_ORIGINAL = true; // Set to true to delete .wav after conversion
const UPDATE_DB = true; // Set to true to update database records

// PATHS
const ROOT_DIR = path.resolve(__dirname);
const UPLOADS_DIRS = [
    path.join(ROOT_DIR, 'public', 'uploads'),
    path.join(ROOT_DIR, 'public', 'uploads', 'audio'),
    // Add more specific paths if needed
];
const DB_PATH = path.join(ROOT_DIR, process.env.DB_PATH || 'data/neostream.db');

// Database Connection
const db = new sqlite3.Database(DB_PATH);

function runCommand(command) {
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(stdout.trim());
        });
    });
}

function updateDatabase(oldPath, newPath) {
    return new Promise((resolve, reject) => {
        // Convert absolute paths to relative paths stored in DB (e.g., "uploads/audio/file.m4a")
        // Typically DB stores relative path from 'public/'

        // Find relative path pattern
        let relOld = oldPath;
        let relNew = newPath;

        if (oldPath.includes('public')) {
            relOld = oldPath.split('public')[1].replace(/^[\\\/]/, ''); // Remove leading slash
        }
        if (newPath.includes('public')) {
            relNew = newPath.split('public')[1].replace(/^[\\\/]/, '');
        }

        // Also try full filename match
        const oldFilename = path.basename(oldPath);
        const newFilename = path.basename(newPath);

        console.log(`[DB] Updating: ${oldFilename} -> ${newFilename}`);

        db.serialize(() => {
            // Update Videos/Audios table (assuming table is 'videos' or similar, strict check needed)
            // Neostream usually puts audio in 'videos' table with type='audio' or just checks filepath.

            // Query to find ID first
            db.get("SELECT id FROM videos WHERE filepath LIKE ? OR filename = ?", [`%${relOld}%`, oldFilename], (err, row) => {
                if (err) {
                    console.error('[DB] Error finding record:', err.message);
                    return resolve(false);
                }
                if (!row) {
                    console.log(`[DB] No record found for ${oldFilename}. Skipping DB update.`);
                    return resolve(false);
                }

                const id = row.id;
                // Update filepath and filename
                db.run("UPDATE videos SET filepath = ?, filename = ? WHERE id = ?", [relNew, newFilename, id], (err) => {
                    if (err) {
                        console.error('[DB] Update failed:', err.message);
                        resolve(false);
                    } else {
                        console.log(`[DB] Successfully updated record ${id} to ${newFilename}`);
                        resolve(true);
                    }
                });
            });
        });
    });
}

async function convertFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext !== '.wav') return false;

    const dir = path.dirname(filePath);
    const name = path.basename(filePath, ext);
    const newPath = path.join(dir, `${name}.m4a`); // AAC format

    if (fs.existsSync(newPath)) {
        console.log(`[SKIP] ${name}.m4a already exists.`);
        // If wav still exists and we want to delete, maybe do it? 
        // Safer to skip to prevent data loss if new file is bad.
        return false;
    }

    console.log(`[CONVERT] Processing: ${name}.wav`);

    // FFmpeg command: Convert to AAC, 128k bitrate, 44.1kHz, Stereo, -movflags +faststart for streaming
    // Using -v error to silence output
    const cmd = `ffmpeg -y -i "${filePath}" -c:a aac -b:a 128k -ar 44100 -ac 2 -movflags +faststart "${newPath}"`;

    try {
        await runCommand(cmd);
        console.log(`[SUCCESS] Created: ${name}.m4a`);

        if (UPDATE_DB) {
            await updateDatabase(filePath, newPath);
        }

        if (DELETE_ORIGINAL) {
            fs.unlinkSync(filePath);
            console.log(`[DELETE] Removed original: ${name}.wav`);
        }
        return true;
    } catch (err) {
        console.error(`[ERROR] Failed to convert ${name}.wav:`, err.message);
        // Clean up partial file if exists
        if (fs.existsSync(newPath)) fs.unlinkSync(newPath);
        return false;
    }
}

async function scanDirectory(directory) {
    if (!fs.existsSync(directory)) {
        console.log(`[WARN] Directory not found: ${directory}`);
        return [];
    }

    let results = [];
    const list = fs.readdirSync(directory);

    for (const file of list) {
        const fullPath = path.join(directory, file);
        const stat = fs.statSync(fullPath);

        if (stat && stat.isDirectory()) {
            const children = await scanDirectory(fullPath);
            results = results.concat(children);
        } else {
            if (path.extname(file).toLowerCase() === '.wav') {
                results.push(fullPath);
            }
        }
    }
    return results;
}

async function main() {
    console.log('=== BATCH AUDIO CONVERTER (WAV -> AAC) ===');
    console.log(`Concurrency: ${CONCURRENCY}`);
    console.log(`Delete Original: ${DELETE_ORIGINAL}`);

    let allFiles = [];
    for (const dir of UPLOADS_DIRS) {
        console.log(`Scanning: ${dir}`);
        const files = await scanDirectory(dir);
        allFiles = allFiles.concat(files);
    }

    console.log(`\nFound ${allFiles.length} WAV files to convert.`);
    if (allFiles.length === 0) {
        console.log('Nothing to do.');
        process.exit(0);
    }

    // Process files sequentially (to save CPU on VPS)
    let convertedCount = 0;
    for (let i = 0; i < allFiles.length; i++) {
        const file = allFiles[i];
        console.log(`\n[${i + 1}/${allFiles.length}] Processing...`);
        const success = await convertFile(file);
        if (success) convertedCount++;
    }

    console.log(`\n=== COMPLETED ===`);
    console.log(`Converted: ${convertedCount} / ${allFiles.length}`);

    // Close DB after a short delay to ensure all queries finish
    setTimeout(() => {
        db.close();
        process.exit(0);
    }, 2000);
}

main().catch(console.error);
