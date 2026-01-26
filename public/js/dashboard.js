// Dashboard.js v2.8 - Fixed Channel Buttons (Dashboard \u0026 Delete)
console.log('%c🚀 Dashboard.js v2.8 LOADED - BUTTONS FIXED', 'background: #22c55e; color: white; padding: 8px; font-weight: bold; font-size: 14px;');
console.log('%c⚠️ If buttons still not working, press Ctrl+Shift+R to hard refresh!', 'background: #f59e0b; color: white; padding: 4px;');

// --- Stats Polling ---
async function updateSystemStats() {
    try {
        const response = await fetch('/api/system-stats');
        if (!response.ok) return;
        const stats = await response.json();

        // CPU
        const cpuElem = document.getElementById('cpu-usage');
        const cpuBar = document.getElementById('cpu-bar');
        const cpuMobile = document.getElementById('cpu-usage-mobile');

        if (cpuElem) cpuElem.textContent = stats.cpu.usage;
        if (cpuBar) cpuBar.style.width = `${stats.cpu.usage}%`;
        if (cpuMobile) cpuMobile.textContent = stats.cpu.usage;

        // Memory
        const memUsageElem = document.getElementById('memory-usage');
        const memTotalElem = document.getElementById('memory-total');
        const memBar = document.getElementById('memory-bar');
        const memUsageMobile = document.getElementById('memory-usage-mobile');
        const memTotalMobile = document.getElementById('memory-total-mobile');

        if (memUsageElem) memUsageElem.textContent = stats.memory.used;
        if (memTotalElem) memTotalElem.textContent = ` / ${stats.memory.total}`;
        if (memBar) memBar.style.width = `${stats.memory.usagePercent}%`;
        if (memUsageMobile) memUsageMobile.textContent = stats.memory.used;
        if (memTotalMobile) memTotalMobile.textContent = ` / ${stats.memory.total}`;

        // Disk (New design - single card)
        const diskUsed = document.getElementById('disk-used');
        const diskTotal = document.getElementById('disk-total');
        const diskBar = document.getElementById('disk-bar');

        if (diskUsed) diskUsed.textContent = stats.disk.used;
        if (diskTotal) diskTotal.textContent = ` / ${stats.disk.total}`;
        if (diskBar) diskBar.style.width = `${stats.disk.usagePercent}%`;

        // Disk (Mobile - legacy)
        const diskUsedMob = document.getElementById('disk-used-mobile');
        const diskTotalMob = document.getElementById('disk-total-mobile');

        if (diskUsedMob) diskUsedMob.textContent = stats.disk.used;
        if (diskTotalMob) diskTotalMob.textContent = ` / ${stats.disk.total}`;

        // Network
        const upSpeed = document.getElementById('upload-speed');
        const downSpeed = document.getElementById('download-speed');
        const upSpeedMob = document.getElementById('upload-speed-mobile');
        const downSpeedMob = document.getElementById('download-speed-mobile');

        if (upSpeed) upSpeed.textContent = stats.network.uploadFormatted;
        if (downSpeed) downSpeed.textContent = stats.network.downloadFormatted;
        if (upSpeedMob) upSpeedMob.textContent = stats.network.uploadFormatted;
        if (downSpeedMob) downSpeedMob.textContent = stats.network.downloadFormatted;

    } catch (error) {
        console.error('Failed to update stats:', error);
    }
}

// Toggle Network/Disk Display
function toggleNetworkDiskDisplay(view) {
    const isDesktop = view === 'desktop';
    const networkContent = document.getElementById(`network-content${isDesktop ? '-desktop' : '-mobile'}`);
    const diskContent = document.getElementById(`disk-content${isDesktop ? '-desktop' : '-mobile'}`);
    const icon = document.getElementById(`toggle-icon${isDesktop ? '-desktop' : '-mobile'}`);

    if (!networkContent || !diskContent || !icon) return;

    if (networkContent.style.display !== 'none') {
        networkContent.style.display = 'none';
        diskContent.style.display = isDesktop ? 'block' : 'flex';
        if (isDesktop) {
            const titleElem = document.getElementById('network-disk-title');
            if (titleElem) titleElem.textContent = 'Disk Usage';
            icon.className = 'ti ti-database text-xl text-white font-loaded';
        } else {
            icon.className = 'ti ti-database text-green-400 text-sm font-loaded';
        }
        localStorage.setItem('dashboardNetworkDiskMode', 'disk');
    } else {
        diskContent.style.display = 'none';
        networkContent.style.display = isDesktop ? 'block' : 'flex';
        if (isDesktop) {
            const titleElem = document.getElementById('network-disk-title');
            if (titleElem) titleElem.textContent = 'Internet Speed';
            icon.className = 'ti ti-wifi text-xl text-white font-loaded';
        } else {
            icon.className = 'ti ti-wifi text-yellow-400 text-sm font-loaded';
        }
        localStorage.setItem('dashboardNetworkDiskMode', 'network');
    }
}

// --- YouTube V2 Functions ---

async function syncChannelV2(channelId, event) {
    if (!event) return location.reload();
    const btn = event.currentTarget;
    const originalContent = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="ti ti-loader animate-spin text-sm"></i> Syncing...';

    try {
        const response = await fetch(`/api/channels/${channelId}/sync`, { method: 'POST' });
        const result = await response.json();
        if (result.success) {
            alert(result.message || 'Sinkronisasi berhasil!');
            location.reload();
        } else {
            alert('Gagal sinkronisasi: ' + result.error);
        }
    } catch (error) {
        console.error(error);
        alert('Terjadi kesalahan saat sinkronisasi');
    } finally {
        btn.disabled = false;
        if (!event.success) btn.innerHTML = originalContent;
    }
}

function editChannelV2(id, name, slug, description, color) {
    const modalId = 'editChannelModalV2';
    const modal = document.getElementById(modalId);
    if (!modal) return console.error('Modal not found:', modalId);

    document.getElementById('editChannelIdV2').value = id;
    document.getElementById('editChannelNameV2').value = name || '';
    document.getElementById('editChannelSlugV2').value = (slug && slug !== 'undefined') ? slug : '';
    document.getElementById('editChannelDescV2').value = (description && description !== 'undefined') ? description : '';

    const themeColor = color || '#0369a1';
    document.getElementById('editChannelColorV2').value = themeColor;
    document.getElementById('editChannelColorTextV2').value = themeColor;

    modal.classList.remove('hidden');
}

function closeEditChannelModalV2() {
    const modal = document.getElementById('editChannelModalV2');
    if (modal) modal.classList.add('hidden');
}

async function saveChannelInfoV2(event) {
    if (event) event.preventDefault();
    const id = document.getElementById('editChannelIdV2').value;
    const data = {
        channel_name: document.getElementById('editChannelNameV2').value,
        slug: document.getElementById('editChannelSlugV2').value,
        description: document.getElementById('editChannelDescV2').value,
        channel_color: document.getElementById('editChannelColorV2').value
    };

    try {
        const response = await fetch(`/api/channels/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await response.json();
        if (result.success) {
            closeEditChannelModalV2();
            location.reload();
        } else {
            alert('Error: ' + result.error);
        }
    } catch (error) {
        console.error(error);
        alert('Failed to save channel info');
    }
}

let deleteChannelId = null;
function confirmDeleteChannelV2(id, name) {
    deleteChannelId = id;
    const modal = document.getElementById('deleteChannelModal');
    const nameSpan = document.getElementById('deleteChannelName');
    if (modal) {
        if (nameSpan) nameSpan.textContent = name || 'ini';
        modal.classList.remove('hidden');
    }
}

function closeDeleteChannelModal() {
    const modal = document.getElementById('deleteChannelModal');
    if (modal) modal.classList.add('hidden');
    deleteChannelId = null;
}

// Global listener for color picker
document.addEventListener('input', (e) => {
    if (e.target.id === 'editChannelColorV2') {
        const textElem = document.getElementById('editChannelColorTextV2');
        if (textElem) textElem.value = e.target.value;
    }
});

let activeKeyChannelId = null;
function manageKeysV2(channelId) {
    activeKeyChannelId = channelId;
    const modal = document.getElementById('manageKeysModalV2');
    if (modal) {
        modal.classList.remove('hidden');
        loadStreamKeysV2(channelId);
    }
}

function closeManageKeysModalV2() {
    const modal = document.getElementById('manageKeysModalV2');
    if (modal) modal.classList.add('hidden');
    activeKeyChannelId = null;
}

async function loadStreamKeysV2(channelId) {
    try {
        const response = await fetch(`/api/channels/${channelId}/keys`);
        const data = await response.json();
        if (data.success) {
            const tbody = document.getElementById('streamKeysTableBodyV2');
            if (!tbody) return;
            tbody.innerHTML = '';

            let available = 0;
            let inUse = 0;

            data.keys.forEach((key, index) => {
                const isAvailable = key.status === 'available';
                if (isAvailable) available++; else inUse++;

                const tr = document.createElement('tr');
                tr.className = 'hover:bg-white/5 transition-colors';
                tr.innerHTML = `
                    <td class="px-6 py-4 text-xs text-gray-500 font-mono">${index + 1}</td>
                    <td class="px-6 py-4 text-xs font-bold text-white">${key.name}</td>
                    <td class="px-6 py-4 text-xs text-gray-400 font-mono">${key.stream_key.substring(0, 4)}****${key.stream_key.substring(key.stream_key.length - 4)}</td>
                    <td class="px-6 py-4 text-center">
                        <span class="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${isAvailable ? 'bg-emerald-500/10 text-emerald-500' : 'bg-blue-500/10 text-blue-500'}">
                            ${key.status}
                        </span>
                    </td>
                    <td class="px-6 py-4 text-right">
                        <button onclick="deleteStreamKeyV2('${key.id}')" class="text-gray-600 hover:text-red-500 transition-colors">
                            <i class="ti ti-trash text-base"></i>
                        </button>
                    </td>
                `;
                tbody.appendChild(tr);
            });

            if (document.getElementById('totalKeysCountV2')) document.getElementById('totalKeysCountV2').textContent = data.keys.length;
            if (document.getElementById('availableKeysCountV2')) document.getElementById('availableKeysCountV2').textContent = available;
            if (document.getElementById('inUseKeysCountV2')) document.getElementById('inUseKeysCountV2').textContent = inUse;
        }
    } catch (error) {
        console.error('Failed to load keys:', error);
    }
}

function toggleBulkCreateV2() {
    const container = document.getElementById('bulkCreateFormContainerV2');
    if (container) container.classList.toggle('hidden');
}

async function processBulkCreateV2() {
    const prefix = document.getElementById('bulkKeyPrefixV2').value;
    const count = document.getElementById('bulkKeyCountV2').value;
    if (!prefix) return alert('Silakan masukkan prefix');

    try {
        const response = await fetch(`/api/channels/${activeKeyChannelId}/keys/bulk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prefix, count })
        });
        const result = await response.json();
        if (result.success) {
            toggleBulkCreateV2();
            loadStreamKeysV2(activeKeyChannelId);
        } else alert(result.error);
    } catch (error) { console.error(error); }
}

async function syncFromYouTubeV2(event) {
    if (!event) return;
    const btn = event.currentTarget;
    const originalContent = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="ti ti-loader animate-spin text-sm"></i> Syncing...';

    try {
        const response = await fetch(`/api/channels/${activeKeyChannelId}/keys/sync`, { method: 'POST' });
        const result = await response.json();
        if (result.success) loadStreamKeysV2(activeKeyChannelId);
        else alert(result.error);
    } catch (error) { console.error(error); }
    finally { btn.disabled = false; btn.innerHTML = originalContent; }
}

async function deleteStreamKeyV2(keyId) {
    if (!(await showConfirm('Hapus stream key ini?'))) return;
    try {
        const response = await fetch(`/api/channels/${activeKeyChannelId}/keys/${keyId}`, { method: 'DELETE' });
        const result = await response.json();
        if (result.success) loadStreamKeysV2(activeKeyChannelId);
    } catch (error) { console.error(error); }
}

// --- Legacy Actions Support ---
function openVideoGallery() {
    if (typeof currentChannelId !== 'undefined') window.location.href = `/dashboard/${currentChannelId}/videos`;
}
function openThumbnailGallery() {
    if (typeof currentChannelId !== 'undefined') window.location.href = `/dashboard/${currentChannelId}/thumbnails`;
}
function openMusicGallery() {
    if (typeof currentChannelId !== 'undefined') window.location.href = `/dashboard/${currentChannelId}/music`;
}
function openPlaylistGallery() {
    if (typeof currentChannelId !== 'undefined') window.location.href = `/dashboard/${currentChannelId}/playlists`;
}

// --- Stream Actions ---
async function startStream(id) {
    const btn = document.querySelector(`button[onclick="startStream('${id}')"]`);
    const originalContent = btn ? btn.innerHTML : 'START';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="ti ti-loader animate-spin"></i>';
    }
    try {
        const response = await fetch(`/api/streams/${id}/start`, { method: 'POST' });
        const result = await response.json();
        if (result.success) window.location.reload();
        else alert('Failed to start stream: ' + result.error);
    } catch (error) {
        console.error(error);
        alert('Error starting stream');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = originalContent; }
    }
}

async function stopStream(id) {
    if (!confirm('Stop this stream?')) return;
    try {
        const response = await fetch(`/api/streams/${id}/stop`, { method: 'POST' });
        const result = await response.json();
        if (result.success) window.location.reload();
        else alert('Failed to stop stream: ' + result.error);
    } catch (error) {
        console.error(error);
        alert('Error stopping stream');
    }
}

async function deleteStream(id) {
    if (!(await showConfirm('Are you sure you want to delete this stream?'))) return;
    try {
        const response = await fetch(`/api/streams/${id}`, { method: 'DELETE' });
        const result = await response.json();
        if (result.success) window.location.reload();
        else alert('Failed to delete stream: ' + result.error);
    } catch (error) {
        console.error(error);
        alert('Error deleting stream');
    }
}

window.editStream = editStream;
async function editStream(id) {
    try {
        const response = await fetch(`/api/streams/${id}`);
        const result = await response.json();
        if (result.success && result.stream) {
            const s = result.stream;
            if (typeof openStreamModalV2 === 'function') openStreamModalV2('edit', id);
            else return console.error('openStreamModalV2 not found');

            const form = document.getElementById('newStreamForm');
            if (!form) return;
            // Form attributes sudah di-set oleh openStreamModalV2

            // Update Header & Button
            const modalTitle = document.getElementById('streamModalTitle');
            const modalDesc = document.getElementById('streamModalDescription');
            if (modalTitle) modalTitle.textContent = 'Edit Stream';
            if (modalDesc) modalDesc.textContent = 'Update your stream details';

            const createBtn = document.getElementById('createStreamBtn');
            if (createBtn) createBtn.innerHTML = '<i class="ti ti-device-floppy"></i> Update Stream';

            // Title
            const titleInput = form.querySelector('input[name="title"]');
            if (titleInput) titleInput.value = s.title || '';

            // Video / Selection
            document.querySelectorAll('.v2-selectable-card').forEach(c => c.classList.remove('video-item-selected'));
            document.querySelectorAll('.v2-check-marker, .v2-thumb-check').forEach(m => m.classList.add('hidden'));

            if (s.video_id) {
                const isPlaylist = s.video_type === 'playlist';
                if (typeof window.switchVideoModeV2 === 'function') switchVideoModeV2(isPlaylist ? 'playlist' : 'single');

                if (isPlaylist) {
                    const plSelect = document.getElementById('playlistSelect');
                    if (plSelect) {
                        plSelect.value = s.video_id;
                        document.getElementById('selectedPlaylistId').value = s.video_id;
                        // Trigger preview
                        document.getElementById('emptyPreview').classList.add('hidden');
                        const p = document.getElementById('videoPreview');
                        p.classList.remove('hidden');
                        p.innerHTML = `<div class="w-full h-full flex flex-col items-center justify-center bg-gray-900 text-emerald-500"><i class="ti ti-playlist text-4xl mb-2"></i><span>Playlist Selected</span></div>`;
                    }
                } else {
                    document.getElementById('selectedVideoId').value = s.video_id;
                    const cards = document.querySelectorAll('.v2-selectable-video');
                    cards.forEach(card => {
                        if (card.getAttribute('data-id') == s.video_id) {
                            card.classList.add('video-item-selected');
                            card.querySelectorAll('.v2-check-marker').forEach(m => m.classList.remove('hidden'));

                            // Trigger Preview
                            const preview = document.getElementById('videoPreview');
                            const empty = document.getElementById('emptyPreview');
                            if (preview && empty && s.video_filepath) {
                                const url = resolvePathV2(s.video_filepath);
                                empty.classList.add('hidden');
                                preview.classList.remove('hidden');
                                preview.innerHTML = `<video src="${url}" controls class="w-full h-full object-contain bg-black" autoplay muted></video>`;
                            }
                        }
                    });
                }
            }

            // Playback Order
            if (s.playback_order || s.loop_video !== undefined) {
                const order = s.playback_order || (s.is_shuffle ? 'random' : 'sequential');
                const radio = form.querySelector(`input[name="playbackOrder"][value="${order}"]`);
                if (radio) radio.checked = true;
            }

            // Thumbnail
            if (s.thumbnailId) {
                const thumbInput = document.getElementById('selectedThumbnailId');
                if (thumbInput) thumbInput.value = s.thumbnailId;
                const thumbCards = document.querySelectorAll('.v2-selectable-thumb');
                thumbCards.forEach(card => {
                    if (card.getAttribute('data-id') == s.thumbnailId) {
                        card.classList.add('video-item-selected');
                        card.querySelectorAll('.v2-thumb-check').forEach(m => m.classList.remove('hidden'));
                        document.getElementById('selectedThumbnailName').textContent = 'Selected: Custom';
                    }
                });
            } else if (s.youtube_thumbnail) {
                document.getElementById('selectedThumbnailName').textContent = 'Selected: YouTube Default';
            }

            // Category mapping helper (legacy string to numeric ID)
            const categoryMap = {
                'Film & Animation': '1', 'Autos & Vehicles': '2', 'Music': '10',
                'Pets & Animals': '15', 'Sports': '17', 'Travel & Events': '19',
                'Gaming': '20', 'People & Blogs': '22', 'Comedy': '23',
                'Entertainment': '24', 'News & Politics': '25', 'Howto & Style': '26',
                'Education': '27', 'Science & Technology': '28', 'Nonprofits & Activism': '29'
            };

            // Destination & Key
            const categorySelect = document.getElementById('youtubeCategorySelect');
            if (categorySelect) {
                let catVal = s.youtube_category || '10';
                console.log('[Auto-Fill Debug] DB Category:', catVal);
                // If the value is a legacy string name, map it to the numeric ID
                if (categoryMap[catVal]) {
                    console.log(`[Auto-Fill Debug] Mapping "${catVal}" to "${categoryMap[catVal]}"`);
                    catVal = categoryMap[catVal];
                }
                categorySelect.value = catVal;
                console.log('[Auto-Fill Debug] Select element value set to:', categorySelect.value);
            }

            const privacySelect = document.getElementById('youtubePrivacySelect');
            if (privacySelect) {
                let privVal = (s.youtube_privacy || 'public').toLowerCase();
                console.log('[Auto-Fill Debug] Setting Privacy to:', privVal);
                privacySelect.value = privVal;
            }

            if (form.querySelector('input[name="rtmpUrl"]')) form.querySelector('input[name="rtmpUrl"]').value = s.rtmp_url || '';
            const keySelect = form.querySelector('select[name="streamKeySelect"]');
            if (keySelect) {
                keySelect.value = 'manual';
                if (typeof window.handleKeySelectV2 === 'function') window.handleKeySelectV2(keySelect);
            }
            const keyInput = document.getElementById('streamKeyInput');
            const keyToggle = document.getElementById('streamKeyToggle');
            if (keyInput) {
                keyInput.value = s.stream_key || '';
                keyInput.disabled = false;
                keyInput.type = 'text'; // Make visible by default on edit
                if (keyToggle) keyToggle.className = 'ti ti-eye-off';
            }

            // Thumbnail
            if (s.thumbnail_id) {
                // Set hidden input value
                const thumbnailIdInput = document.getElementById('selectedThumbnailId');
                if (thumbnailIdInput) thumbnailIdInput.value = s.thumbnail_id;

                // Update UI to show selected thumbnail
                document.querySelectorAll('.v2-selectable-thumb').forEach(thumb => {
                    const thumbDiv = thumb;
                    if (thumbDiv.getAttribute('data-id') === s.thumbnail_id) {
                        thumbDiv.classList.add('video-item-selected');
                        thumbDiv.querySelectorAll('.v2-thumb-check').forEach(m => m.classList.remove('hidden'));
                        document.getElementById('selectedThumbnailName').textContent = 'Selected: Custom';
                    } else {
                        thumbDiv.classList.remove('video-item-selected');
                        thumbDiv.querySelectorAll('.v2-thumb-check').forEach(m => m.classList.add('hidden'));
                    }
                });
            }

            // Schedule
            if (s.schedule_time) {
                const start = new Date(s.schedule_time);
                const localStart = new Date(start.getTime() - (start.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
                const input = document.getElementById('scheduleStartTime');
                if (input) input.value = localStart;
            }
            if (s.end_time) {
                const end = new Date(s.end_time);
                const localEnd = new Date(end.getTime() - (end.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
                const input = document.getElementById('scheduleEndTime');
                if (input) input.value = localEnd;
            }

            // Loop & Advanced Settings
            const loopCheck = form.querySelector('input[name="loopVideo"]');
            if (loopCheck) loopCheck.checked = !!s.loop_video;
            const advCheck = form.querySelector('input[name="useAdvancedSettings"]');
            if (advCheck) advCheck.checked = !!s.use_advanced_settings;
        }
    } catch (e) { console.error('Error in editStream:', e); }
}

// --- DOM Init ---
document.addEventListener('DOMContentLoaded', () => {
    updateSystemStats();
    setInterval(updateSystemStats, 2000);
    if (localStorage.getItem('dashboardNetworkDiskMode') === 'disk') toggleNetworkDiskDisplay('desktop');

    const confirmBtn = document.getElementById('confirmDeleteBtn');
    if (confirmBtn) {
        confirmBtn.addEventListener('click', async () => {
            if (!deleteChannelId) return;
            const btn = document.getElementById('confirmDeleteBtn');
            const originalContent = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i class="ti ti-loader animate-spin"></i> Menghapus...';
            try {
                const response = await fetch(`/api/settings/youtube-channel/${deleteChannelId}`, { method: 'DELETE' });
                const data = await response.json();
                if (data.success) location.reload();
                else { alert(data.error || 'Gagal menghapus channel'); btn.disabled = false; btn.innerHTML = originalContent; closeDeleteChannelModal(); }
            } catch (e) { alert('Terjadi kesalahan'); btn.disabled = false; btn.innerHTML = originalContent; }
        });
    }
});

// --- Final Exports ---
window.toggleNetworkDiskDisplay = toggleNetworkDiskDisplay;
window.syncChannelV2 = syncChannelV2;
window.editChannelV2 = editChannelV2;
window.closeEditChannelModalV2 = closeEditChannelModalV2;
window.saveChannelInfoV2 = saveChannelInfoV2;
window.confirmDeleteChannelV2 = confirmDeleteChannelV2;
window.manageKeysV2 = manageKeysV2;
window.closeManageKeysModalV2 = closeManageKeysModalV2;
window.loadStreamKeysV2 = loadStreamKeysV2;
window.toggleBulkCreateV2 = toggleBulkCreateV2;
window.processBulkCreateV2 = processBulkCreateV2;
window.syncFromYouTubeV2 = syncFromYouTubeV2;
window.deleteStreamKeyV2 = deleteStreamKeyV2;
window.openVideoGallery = openVideoGallery;
window.openThumbnailGallery = openThumbnailGallery;
window.openMusicGallery = openMusicGallery;
window.openPlaylistGallery = openPlaylistGallery;
window.startStream = startStream;
window.stopStream = stopStream;
window.deleteStream = deleteStream;
