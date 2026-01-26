# Panduan Deployment ke VPS (Ubuntu/Debian)

Panduan ini akan membantu Anda mengkonfigurasi VPS, menginstal dependency, dan menjalankan aplikasi Streaming.

## 1. Persiapan VPS
Login ke VPS Anda via SSH.

```bash
ssh user@ip-address-vps
```

Update sistem:
```bash
sudo apt update && sudo apt upgrade -y
```

## 2. Instalasi Node.js (v18 atau lebih baru)
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
```
Cek versi:
```bash
node -v
npm -v
```

## 3. Instalasi FFMPEG (Wajib)
FFMPEG diperlukan untuk proses streaming dan konversi.
```bash
sudo apt install -y ffmpeg
```
Cek instalasi:
```bash
ffmpeg -version
```

## 4. Instalasi Git & Clone Project
Jika belum ada git:
```bash
sudo apt install -y git
```

Clone repository GitHub Anda.
**Jika Repository Private**, gunakan format token:
```bash
git clone https://TOKEN_GITHUB_ANDA@github.com/USERNAME/neostream.git neostream
```

**Jika Repository Public**:
```bash
git clone https://github.com/USERNAME/neostream.git neostream
```

Masuk ke folder project:
```bash
cd neostream
```

## 5. Instalasi Dependency Aplikasi
Install paket npm (Node Modules) di VPS:
```bash
npm install
```
*Catatan: Ini akan membaca `package-lock.json` untuk menginstal versi library yang tepat.*

## 6. Konfigurasi Environment
Salin file contoh konfigurasi:
```bash
cp .env.example .env
```
Edit file `.env` (gunakan `nano`):
```bash
nano .env
```
**PENTING**:
- Sesuaikan `BASE_URL` dengan IP VPS atau Domain Anda (misal `http://123.456.78.90:7575`).
- Isi kredensial database (biarkan default `data/neostream.db` jika pakai SQLite).
- Pastikan folder database dibuat otomatis oleh aplikasi, atau buat manual: `mkdir data`.

## 7. Menjalankan Aplikasi dengan PM2 (Production)
Gunakan PM2 agar aplikasi tetap berjalan di background dan auto-restart jika crash.

Install PM2 global:
```bash
sudo npm install -g pm2
```

Jalankan aplikasi (pastikan di folder project):
```bash
pm2 start app.js --name "neostream"
```

Cek status:
```bash
pm2 status
pm2 logs neostream
```

Simpan konfigurasi agar auto-start saat reboot:
```bash
pm2 save
pm2 startup
```

## 8. Mengakses Aplikasi
Buka browser dan akses:
`http://IP-VPS:7575`

---

## Tips Ringan Upload
Saat upload ke GitHub dari komputer lokal, **JANGAN** sertakan folder-folder ini (sudah diatur di `.gitignore`):
- `node_modules/` (Sangat berat, install ulang di VPS)
- `data/` (Database lokal jangan dibawa)
- `public/uploads/` (Video/Thumbnail lokal jangan dibawa)
- `logs/`
- `temp/`

Pastikan file `.gitignore` ada sebelum Anda melakukan `git add .` dan `git commit`.
