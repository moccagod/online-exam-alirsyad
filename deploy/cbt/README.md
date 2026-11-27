# Instalasi CBT terpisah

Instalasi ini memakai `/var/www/online-exam-cbt`, PM2 `online-exam-cbt-backend`, port API `127.0.0.1:3001`, dan Nginx `127.0.0.1:8081` selama pengujian. Situs `smk-alirsyad.tech` tetap memakai direktori, PM2, dan port `3000` miliknya sendiri.

## Sebelum domain tersedia

1. Deploy branch development ke direktori CBT baru. Jangan pull branch ini di direktori situs lama.
2. Di `online-exam-backend/.env` CBT, pakai kredensial Supabase development dan set `NODE_ENV=production`, `PORT=3001`, `HOST=127.0.0.1`, `CORS_ORIGIN=http://localhost:8081`, `ENABLE_TYPEORM=false`. Simpan file dengan mode `600`. Jangan salin kredensial dari instalasi situs lama.
3. Jalankan `npm ci` dan `npm run build` di backend. Jalankan `npm ci` dan `VITE_API_BASE_URL=/api npm run build` di frontend.
4. Jalankan backend sebagai proses PM2 baru dari direktori backend CBT: `pm2 start dist/src/main.js --name online-exam-cbt-backend --cwd /var/www/online-exam-cbt/online-exam-backend`. Periksa log dan port `3001`.
5. Salin `nginx-testing.conf` ke `/etc/nginx/sites-available/online-exam-cbt`, buat symlink di `sites-enabled`, jalankan `nginx -t`, lalu `systemctl reload nginx`.
6. Dari PowerShell komputer penguji, jalankan `& 'C:\Windows\System32\OpenSSH\ssh.exe' -N -L 127.0.0.1:8081:127.0.0.1:8081 root@72.62.124.232` lalu buka `http://localhost:8081`. Biarkan jendela PowerShell tersebut terbuka selama pengujian dan tekan `Ctrl+C` untuk menutup tunnel. Pastikan situs lama tetap merespons.

## Setelah domain tersedia

1. Di panel DNS `smkalirsyadjkt.sch.id`, tambahkan **A record** dengan host `cbt` dan nilai IP publik VPS. Jangan ubah record domain lama atau nameserver yang sudah bekerja.
2. Pastikan `cbt.smkalirsyadjkt.sch.id` mengarah ke VPS. Ganti konfigurasi CBT saja dengan `nginx-domain.conf`; jalankan `nginx -t` sebelum reload.
3. Terbitkan sertifikat HTTPS untuk `cbt.smkalirsyadjkt.sch.id` menggunakan Certbot Nginx. Periksa konfigurasi Nginx setelah Certbot mengubahnya.
4. Set `CORS_ORIGIN=https://cbt.smkalirsyadjkt.sch.id` pada `.env` CBT dan restart **hanya** `online-exam-cbt-backend`. Frontend tetap memakai `/api`, sehingga tidak perlu build ulang untuk perubahan hostname.
5. Uji login dan alur ujian melalui HTTPS, lalu periksa ulang `smk-alirsyad.tech` beserta API-nya.

Jangan jalankan migrasi, `schema:sync`, atau `migration:revert` sebagai bagian dari deploy ini. Bila terjadi masalah pada CBT, nonaktifkan konfigurasi Nginx CBT dan hentikan proses PM2 CBT saja.
