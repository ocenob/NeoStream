const { db } = require('../db/database');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

class Thumbnail {
    static create(data) {
        return new Promise((resolve, reject) => {
            const id = uuidv4();
            db.run(
                `INSERT INTO thumbnails (
          id, title, filename, filepath, user_id, youtube_channel_id, 
          file_size, width, height
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    id, data.title || data.filename, data.filename, data.filepath, data.user_id, data.youtube_channel_id,
                    data.file_size, data.width, data.height
                ],
                function (err) {
                    if (err) {
                        return reject(err);
                    }
                    resolve({ id, ...data });
                }
            );
        });
    }

    static findAll(userId, channelId = null) {
        return new Promise((resolve, reject) => {
            let query = 'SELECT * FROM thumbnails WHERE user_id = ?';
            const params = [userId];

            if (channelId === 'NULL') {
                query += ' AND youtube_channel_id IS NULL';
            } else if (channelId) {
                query += ' AND youtube_channel_id = ?';
                params.push(channelId);
            }

            query += ' ORDER BY created_at DESC';

            db.all(query, params, (err, rows) => {
                if (err) {
                    return reject(err);
                }
                resolve(rows || []);
            });
        });
    }

    static findById(id) {
        return new Promise((resolve, reject) => {
            db.get('SELECT * FROM thumbnails WHERE id = ?', [id], (err, row) => {
                if (err) {
                    return reject(err);
                }
                resolve(row);
            });
        });
    }

    static delete(id) {
        return new Promise((resolve, reject) => {
            Thumbnail.findById(id).then(thumbnail => {
                if (!thumbnail) return reject(new Error('Thumbnail not found'));

                db.run('DELETE FROM thumbnails WHERE id = ?', [id], function (err) {
                    if (err) return reject(err);

                    // Delete file
                    if (thumbnail.filepath) {
                        const fullPath = path.join(__dirname, '..', 'public', thumbnail.filepath);
                        try {
                            if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
                        } catch (e) {
                            console.error('Error deleting thumbnail file:', e);
                        }
                    }
                    resolve({ success: true });
                });
            }).catch(reject);
        });
    }
}

module.exports = Thumbnail;
