const AnalyticsService = require('../utils/analyticsService');

class SmartSchedulerService {
    /**
     * @param {Object} config
     * @param {number} config.minDailyHours (Default: 5)
     * @param {number} config.maxDailyHours (Default: 10)
     * @param {number} config.minStreamDuration (Default: 3)
     * @param {number} config.maxStreamDuration (Default: 7)
     */
    constructor(config = {}) {
        this.minDailyHours = config.minDailyHours || 5;
        this.maxDailyHours = config.maxDailyHours || 10;
        this.minStreamDuration = config.minStreamDuration || 3;
        this.maxStreamDuration = config.maxStreamDuration || 7;
    }

    /**
     * Menghasilkan jadwal "smart" untuk satu hari tertentu.
     * @param {Date} date 
     * @param {Array} heatmap (7x24 array)
     */
    generateDaySchedule(date, heatmap) {
        const dayOfWeek = (date.getDay()); // 0=Sunday, 1=Monday...
        const dayActivity = heatmap[dayOfWeek];

        // 1. Tentukan Total Jam Hari Ini (5-10 Jam)
        const totalDailyHours = Math.random() * (this.maxDailyHours - this.minDailyHours) + this.minDailyHours;

        // 2. Tentukan Durasi Per Stream (3-7 Jam)
        // Jika totalDailyHours <= maxStreamDuration, bisa 1 stream atau 2 stream.
        // Kita coba buat stream dengan durasi rata-rata yang masuk akal.
        let streams = [];
        let remainingHours = totalDailyHours;

        while (remainingHours > 0) {
            let duration = Math.random() * (this.maxStreamDuration - this.minStreamDuration) + this.minStreamDuration;
            if (duration > remainingHours) duration = remainingHours;

            // Minimal durasi 1 jam jika sisa sedikit, atau gabung ke sebelumnya
            if (remainingHours < 1 && streams.length > 0) {
                streams[streams.length - 1].duration += remainingHours;
                remainingHours = 0;
            } else {
                streams.push({ duration: duration });
                remainingHours -= duration;
            }
        }

        // 3. Cari Block Waktu Terbaik (Sliding Window)
        // Kita cari start hour yang memberikan total activity tertinggi untuk durasi terbanyak.
        const schedules = [];
        let usedHours = new Set();

        streams.sort((a, b) => b.duration - a.duration).forEach(stream => {
            let bestStartHour = 0;
            let maxActivity = -1;

            for (let h = 0; h < 24; h++) {
                // Check if this block overlaps with used hours
                let overlap = false;
                for (let i = 0; i < Math.ceil(stream.duration); i++) {
                    if (usedHours.has((h + i) % 24)) {
                        overlap = true;
                        break;
                    }
                }
                if (overlap) continue;

                // Calculate activity for this window
                let activity = 0;
                for (let i = 0; i < Math.ceil(stream.duration); i++) {
                    activity += dayActivity[(h + i) % 24];
                }

                if (activity > maxActivity) {
                    maxActivity = activity;
                    bestStartHour = h;
                }
            }

            // Tandai jam sebagai terpakai
            for (let i = 0; i < Math.ceil(stream.duration); i++) {
                usedHours.add((bestStartHour + i) % 24);
            }

            // Berikan Jitter (Acak Menit/Detik)
            const startHour = bestStartHour;
            const startMinute = Math.floor(Math.random() * 60);
            const startSecond = Math.floor(Math.random() * 60);

            const startTime = new Date(date);
            startTime.setHours(startHour, startMinute, startSecond, 0);

            const endTime = new Date(startTime);
            endTime.setSeconds(endTime.getSeconds() + Math.floor(stream.duration * 3600));

            schedules.push({
                start: startTime,
                end: endTime,
                durationHours: stream.duration
            });
        });

        return schedules.sort((a, b) => a.start - b.start);
    }

    /**
     * Menghasilkan jadwal 14 hari ke depan.
     */
    async generateFullSchedule(user, channel, daysCount = 14) {
        const analytics = new AnalyticsService(user, channel);
        const heatmap = await analytics.getViewerActivityHeatmap();

        const fullSchedule = [];
        const today = new Date();

        for (let i = 1; i <= daysCount; i++) {
            const targetDate = new Date(today);
            targetDate.setDate(today.getDate() + i);
            targetDate.setHours(0, 0, 0, 0);

            const daySchedules = this.generateDaySchedule(targetDate, heatmap);
            fullSchedule.push(...daySchedules);
        }

        return fullSchedule;
    }
}

module.exports = SmartSchedulerService;
