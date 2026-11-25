# AGENTS.md

Portal ujian online SMK Al Irsyad (https://smk-alirsyad.tech). Monorepo dua aplikasi.

## Struktur

- `online-exam-backend/` — NestJS 11 (TypeScript), port 3000, prefix global `/api`
- `online-exam-frontend/` — React 19 + Vite 7 + Tailwind 4 (JSX), port 5173

## Data layer — PENTING

- Semua akses data lewat `@supabase/supabase-js` (PostgREST) di service NestJS. File di `*/entities/*.entity.ts` HANYA tipe TypeScript, bukan entity TypeORM (tidak ada dekorator).
- TypeORM hanya dipakai untuk migrasi skema: `npm run migration:generate` / `migration:run` / `migration:revert` di `online-exam-backend/`. Runtime app: `ENABLE_TYPEORM=false`.
- JANGAN pakai `schema:sync`, `migration:revert`, DROP, atau ubah skema tanpa instruksi eksplisit — **.env lokal menunjuk ke database Supabase PRODUKSI** (data siswa & ujian nyata).
- Tabel utama: users, subjects, classes, exams, exam_students, exam_sessions, exam_submissions, questionnaires, questions, choices.

## Perintah

- Selalu **npm**, jangan yarn (yarn diblokir `C:\Users\MoccaGod\package.json`).
- Backend dev: `cd online-exam-backend && npm run start:dev` — butuh `.env` (sudah ada, jangan commit).
- Frontend dev: `cd online-exam-frontend && npm run dev` — butuh `.env`, `VITE_API_BASE_URL=http://localhost:3000/api`.
- Build: `npm run build` di masing-masing folder. Backend build harus jalan tanpa error sebelum selesai.
- Jalankan backend + frontend bersamaan untuk uji manual. Login pakai akun prod (userid + password sama dengan web).

## Auth & role

- Login: `POST /api/auth/login` → JWT. Token disimpan di `localStorage.token`. Payload: id, role (SISWA | GURU | ADMIN), name, userid.
- Role menentukan menu (frontend `src/constants/menus.ts`) — filter sisi klien saja.
- Password: bcryptjs, field `password` di tabel users.

## Git

- `origin` = fork `moccagod/online-exam-alirsyad` (push ke sini).
- `upstream` = `alfhian/online-exam-alirsyad` (repo vendor, PULL ONLY, jangan push).
- Kerja di feature branch dari `main`, commit kecil-kecil, pesan commit konvensional (`feat:`, `fix:`, `chore:`).
- Jangan commit `.env`, `dist/`, `node_modules/`.

## Konvensi kode

- Backend: ikuti pola module NestJS existing (controller/service/module/dto/entities). Service menerima `SupabaseClient` via `SupabaseModule`.
- Frontend: JSX bukan TSX untuk pages/components. axios instance dari `src/api/axiosConfig.js`. State global pakai zustand.
- UI: Tailwind class inline, warna emerald/slate, ikon react-icons/fa. Konfirmasi pakai sweetalert2 (Swal).
- Bahasa UI: Indonesia.
