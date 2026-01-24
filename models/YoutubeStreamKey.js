const { db } = require('../db/database');
const { v4: uuidv4 } = require('uuid');

class YoutubeStreamKey {
    static findAll(userId, channelId = null) {
        return new Promise((resolve, reject) => {
            let query = 'SELECT * FROM youtube_stream_keys WHERE user_id = ?';
            const params = [userId];

            if (channelId) {
                query += ' AND youtube_channel_id = ?';
                params.push(channelId);
            }

            query += ' ORDER BY created_at DESC';

            db.all(query, params, (err, rows) => {
                if (err) return reject(err);
                resolve(rows || []);
            });
        });
    }

    static findById(id) {
        return new Promise((resolve, reject) => {
            db.get('SELECT * FROM youtube_stream_keys WHERE id = ?', [id], (err, row) => {
                if (err) return reject(err);
                resolve(row);
            });
        });
    }

    static create(data) {
        return new Promise((resolve, reject) => {
            const { youtube_channel_id, user_id, name, stream_key, youtube_stream_id, status } = data;
            const id = uuidv4();

            db.run(
                `INSERT INTO youtube_stream_keys (id, youtube_channel_id, user_id, name, stream_key, youtube_stream_id, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [id, youtube_channel_id, user_id, name, stream_key, youtube_stream_id || null, status || 'available'],
                function (err) {
                    if (err) return reject(err);
                    resolve({ id, ...data });
                }
            );
        });
    }

    static bulkCreate(keys, userId, channelId) {
        return new Promise((resolve, reject) => {
            db.serialize(() => {
                db.run('BEGIN TRANSACTION');
                const stmt = db.prepare(
                    `INSERT INTO youtube_stream_keys (id, youtube_channel_id, user_id, name, stream_key, youtube_stream_id, status)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
                );

                keys.forEach(key => {
                    stmt.run([
                        uuidv4(),
                        channelId,
                        userId,
                        key.name,
                        key.stream_key,
                        key.youtube_stream_id || null,
                        'available'
                    ]);
                });

                stmt.finalize((err) => {
                    if (err) {
                        db.run('ROLLBACK');
                        return reject(err);
                    }
                    db.run('COMMIT', (err) => {
                        if (err) return reject(err);
                        resolve({ success: true, count: keys.length });
                    });
                });
            });
        });
    }

    static update(id, data) {
        const fields = [];
        const values = [];

        Object.entries(data).forEach(([key, value]) => {
            if (value !== undefined) {
                fields.push(`${key} = ?`);
                values.push(value);
            }
        });

        fields.push('updated_at = CURRENT_TIMESTAMP');
        values.push(id);

        return new Promise((resolve, reject) => {
            db.run(
                `UPDATE youtube_stream_keys SET ${fields.join(', ')} WHERE id = ?`,
                values,
                function (err) {
                    if (err) return reject(err);
                    resolve({ id, ...data });
                }
            );
        });
    }

    static delete(id, userId) {
        return new Promise((resolve, reject) => {
            db.run(
                'DELETE FROM youtube_stream_keys WHERE id = ? AND user_id = ?',
                [id, userId],
                function (err) {
                    if (err) return reject(err);
                    resolve({ deleted: this.changes > 0 });
                }
            );
        });
    }

    static deleteByChannel(channelId, userId) {
        return new Promise((resolve, reject) => {
            db.run(
                'DELETE FROM youtube_stream_keys WHERE youtube_channel_id = ? AND user_id = ?',
                [channelId, userId],
                function (err) {
                    if (err) return reject(err);
                    resolve({ deleted: this.changes });
                }
            );
        });
    }

    static findAvailable(channelId) {
        return new Promise((resolve, reject) => {
            db.get(
                `SELECT * FROM youtube_stream_keys 
         WHERE youtube_channel_id = ? AND status = 'available' 
         ORDER BY last_used_at ASC, created_at ASC LIMIT 1`,
                [channelId],
                (err, row) => {
                    if (err) return reject(err);
                    resolve(row);
                }
            );
        });
    }

    static markAsUsed(id) {
        return new Promise((resolve, reject) => {
            db.run(
                `UPDATE youtube_stream_keys SET status = 'in-use', last_used_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [id],
                function (err) {
                    if (err) return reject(err);
                    resolve({ success: true });
                }
            );
        });
    }

    static releaseKey(id) {
        return new Promise((resolve, reject) => {
            db.run(
                `UPDATE youtube_stream_keys SET status = 'available' WHERE id = ?`,
                [id],
                function (err) {
                    if (err) return reject(err);
                    resolve({ success: true });
                }
            );
        });
    }
}

module.exports = YoutubeStreamKey;
