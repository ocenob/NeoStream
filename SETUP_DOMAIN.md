# Panduan Setup Domain & HTTPS (SSL) untuk NeoStream

Panduan ini akan membantu Anda menghubungkan domain `streamingo.site` ke VPS dan mengaktifkan HTTPS agar aman.

## 1. Setting DNS (Di Penyedia Domain)
Pastikan Anda sudah mengatur **A Record** di panel domain Anda (tempat Anda beli domain).
*   **Host/Name**: `@` (kosong)
*   **Type**: `A Record`
*   **Value/Target**: `103.197.188.130` (IP VPS Anda)

*Tunggu beberapa menit hingga propagasi DNS selesai.*

## 2. Install Nginx (Web Server)
Login ke VPS Anda, lalu jalankan perintah berikut:

```bash
sudo apt update
sudo apt install nginx -y
```

## 3. Konfigurasi Reverse Proxy
Kita perlu mengatur Nginx agar meneruskan trafik dari domain ke aplikasi NeoStream (port 7575).

Buat file konfigurasi baru:
```bash
sudo nano /etc/nginx/sites-available/streamingo
```

Copy-paste konfigurasi di bawah ini ke dalamnya:

```nginx
server {
    server_name streamingo.site www.streamingo.site;

    location / {
        proxy_pass http://localhost:7575;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
*(Tekan `Ctrl+X`, lalu `Y`, lalu `Enter` untuk menyimpan)*

Aktifkan konfigurasi tersebut:
```bash
sudo ln -s /etc/nginx/sites-available/streamingo /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```
*Jika `sudo nginx -t` muncul "successful", berarti aman.*

## 4. Install SSL (HTTPS) Gratis dengan Certbot
Agar bisa diakses via `https://`, kita gunakan Certbot (Let's Encrypt).

```bash
sudo apt install certbot python3-certbot-nginx -y
```

Jalankan Certbot:
```bash
sudo certbot --nginx -d streamingo.site -d www.streamingo.site
```
*   Jika diminta email, masukkan email aktif Anda.
*   Jika diminta menyetujui Terms, ketik `Y`.
*   Jika instalasi sukses, Nginx akan otomatis reload.

## 5. Update Konfigurasi Aplikasi
Karena sekarang sudah pakai HTTPS, kita perlu update konfigurasi aplikasi agar lebih aman.

Edit file environment:
```bash
cd ~/neostream
nano .env
```

Ubah bagian berikut:
```ini
# Ubah ke production agar aman (Secure Cookie akan aktif)
NODE_ENV=production

# Ganti BASE_URL dengan domain Anda
BASE_URL=https://streamingo.site
```
*(Simpan dengan `Ctrl+X`, `Y`, `Enter`)*

Terakhir, restart aplikasi:
```bash
pm2 restart neostream
```

## Selesai! 🎉
Sekarang coba buka **https://streamingo.site/** di browser Anda. Aplikasi seharusnya sudah bisa diakses dengan aman (gembok hijau).
