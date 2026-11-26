# Penerapan sesi ujian

Jalankan `npm run test:exam-delivery` di backend untuk menguji migrasi, paket lintas kelas, rotasi token, revisi draf, penutupan sesi, pengiriman ganda, penilaian, dan impor Excel di PostgreSQL sementara. Jalankan `npm run build` di frontend. Pada lingkungan Windows yang membatasi akses ke folder induk, gunakan `npm run build -- --configLoader runner`.

Jadwalkan penerapan setelah ujian aktif selesai. Untuk penerapan yang telah diotorisasi, ambil cadangan, jalankan migrasi TypeORM, lalu terapkan backend dan frontend dalam jendela yang sama. Backend harus memakai `SUPABASE_SERVICE_ROLE_KEY` dan worker pengiriman aktif agar ujian offline ditutup dari draf terakhir di server.

1. Dari **Daftar Ujian**, isi jadwal WIB, pilih guru, atur daftar **Peserta**, dan bagikan token sesi. Jadwal lama yang akan dipakai tampil sebagai **Perlu dilengkapi**. Untuk ujian lama dengan hasil historis, siapkan sesi baru dan pilih paket ujian lama.
2. Dari halaman soal, guru dapat memakai paket sendiri atau memilih ujian mapel yang sama dalam penugasannya. Nama mapel yang sama dicocokkan tanpa membedakan huruf kapital. Gunakan template Excel yang tersedia dan periksa setiap baris sebelum menyimpan.
3. Di **Edit Siswa**, terbitkan kata sandi awal per akun terdampak. Bagikan secara pribadi. Siswa menggantinya saat login.
4. Saat uji penerimaan, gunakan Chrome Android dan Safari iPhone fisik. Periksa login, penolakan kamera, perbesar gambar, koneksi terputus, login kedaluwarsa, tiga kali meninggalkan halaman, pembukaan kembali oleh operator, dan kesesuaian bukti penerimaan dengan jawaban di panel guru.
5. Buka **Pratinjau hitung ulang** sebelum menerapkan perubahan nilai. Tinjau hasil bertanda **Periksa manual** dan gunakan riwayat pengawasan untuk menelusuri kejadian. Draf perangkat yang tertinggal ditandai setelah perangkat terhubung dan melaporkan revisinya.
