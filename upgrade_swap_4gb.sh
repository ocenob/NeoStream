#!/bin/bash

echo "--- 🚀 Upgrade Swap ke 4GB ---"

# 1. Matikan swap yang sekarang (2GB)
echo "1. Mematikan swap lama..."
sudo swapoff /swapfile

# 2. Resize file jadi 4GB
echo "2. Mengubah ukuran menjadi 4GB (Tunggu sebentar)..."
sudo fallocate -l 4G /swapfile

# 3. Format ulang
echo "3. Format ulang swap area..."
sudo mkswap /swapfile

# 4. Aktifkan kembali
echo "4. Mengaktifkan swap baru..."
sudo swapon /swapfile

# Tidak perlu edit fstab karena nama file sama (/swapfile)

echo "--- ✅ Berhasil Upgrade ke 4GB! ---"
echo "Status Memory Baru:"
free -h
