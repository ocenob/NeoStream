#!/bin/bash

# Cek apakah swap sudah ada
if swapon --show | grep -q "/swapfile"; then
    echo "⚠️  Swap file sudah ada. Tidak perlu dibuat lagi."
    free -h
    exit 0
fi

echo "--- 🚀 Memulai Pembuatan Swap Memory 2GB ---"

# 1. Alokasi file 2GB
echo "1. Mengalokasikan file 2GB..."
sudo fallocate -l 2G /swapfile

# 2. Set permission (hanya root yang bisa baca)
echo "2. Mengatur permission..."
sudo chmod 600 /swapfile

# 3. Format sebagai swap
echo "3. Format area swap..."
sudo mkswap /swapfile

# 4. Aktifkan swap
echo "4. Mengaktifkan swap..."
sudo swapon /swapfile

# 5. Buat permanen di fstab (agar tidak hilang saat restart)
echo "5. Menyimpan konfigurasi permanen..."
# Cek dulu biar nggak duplikat
if ! grep -q "/swapfile" /etc/fstab; then
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi

echo "--- ✅ Swap Memory Berhasil Dibuat! ---"
echo "Status Memory Baru:"
free -h
