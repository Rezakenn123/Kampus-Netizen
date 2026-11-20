# Kampus Netizen 🎓

Kampus virtual multiplayer di browser. Ada peta kampus isometrik dengan Rektorat, 6 fakultas, Perpustakaan, Kantin, Lapangan, Masjid, Danau, dan Gerbang. Mahasiswa bisa bikin **KTM** dan memilih jurusan. **Pak Rektor** jadi karakter utama, dan **Dekan** tiap jurusan adalah mahasiswa pertama yang mendaftar di jurusan itu.

- **Frontend:** Vanilla JS + Canvas, tanpa build step
- **Hosting:** Vercel (file statis)
- **Backend:** Supabase (Auth tamu + Google, Postgres + RLS, Realtime)

Jurusan: Ilmu Komunikasi · Informatika · Manajemen · Kesehatan · Kedokteran · Ngepunk

---

## 1. Siapkan Supabase

1. Buat project di [supabase.com](https://supabase.com).
2. **SQL Editor → New query**, tempel isi `supabase/schema.sql`, lalu **Run**.
3. **Authentication → Sign In / Providers**:
   - Aktifkan **Allow anonymous sign-ins** (supaya orang bisa jalan-jalan sebagai tamu).
   - Aktifkan **Allow manual linking** (supaya akun tamu bisa disambungkan ke Google tanpa kehilangan data).
   - Aktifkan provider **Google**. Isi Client ID dan Secret dari Google Cloud Console (APIs & Services → Credentials → OAuth client ID → Web application). Di Google, tambahkan *Authorized redirect URI*: `https://<ref-project>.supabase.co/auth/v1/callback`.
4. **Authentication → URL Configuration**:
   - Site URL: domain Vercel kamu, misalnya `https://kampus-netizen.vercel.app`
   - Redirect URLs: domain Vercel kamu + `http://localhost:3000` (untuk uji lokal)
5. **Project Settings → API**: salin **Project URL** dan **anon/publishable key** ke `config.js`.

> Anon key memang boleh ada di frontend. Yang menjaga data adalah RLS di `schema.sql`. Contohnya: orang tidak bisa mengangkat dirinya jadi Dekan/Rektor, tidak bisa chat atas nama orang lain, dan tidak bisa menghapus jualan orang lain.

## 2. Coba di komputer

```bash
npx serve -l 3000 .        # atau: python3 -m http.server 3000
# buka http://localhost:3000
```

Kalau `config.js` masih kosong, game jalan di **mode demo** (offline, mahasiswa lain bot).

## 3. Deploy ke Vercel

1. Upload folder ini ke GitHub.
2. Di Vercel: **Add New → Project → Import** repo tersebut.
3. Framework Preset: **Other**. Build Command: *(kosong)*. Output Directory: `.`
4. Deploy. Pastikan domainnya sudah terdaftar di Redirect URLs Supabase (langkah 1.4).

Atau lewat terminal: `npx vercel --prod`

## 4. Angkat Rektor

Bikin KTM dulu, lalu di SQL Editor:

```sql
update public.mahasiswa set role = 'rektor' where lower(nama) = lower('NamaKamu');
```

Rektor punya label 👑 dan topi toga, bisa menulis pengumuman di tab **Info**, dan menggantikan NPC "Pak Rektor" saat online.

---

## Cara kerja

| Bagian | Teknologi |
|---|---|
| Peta, bot, cuaca | Dihitung dari *seed* dan jam (`js/world.js`). Semua pemain melihat hal yang sama tanpa server game. |
| Siapa yang online | Supabase Realtime **Presence** |
| Posisi pemain | Realtime **Broadcast**. Dikirim ±3×/detik saat bergerak, lalu layar "menebak" gerakan di antaranya. |
| Chat | Disimpan ke tabel `chat` + **Postgres Changes**, jadi pengirimnya terjamin asli |
| KTM | Fungsi `daftar_ktm()` (NIM otomatis, Dekan pertama otomatis, nama tidak boleh kembar) |
| Kantin, Pengumuman | Tabel Postgres + RLS + Postgres Changes |
| Login | Tamu anonim → `linkIdentity(google)` saat bikin KTM → `signInWithOAuth(google)` di HP lain |

```
index.html            tampilan (top bar, tombol, joystick, menu bawah, panel)
config.js             URL & key Supabase, jumlah bot, frekuensi kirim posisi
js/world.js           peta kampus, data jurusan, bot & Rektor berbasis waktu
js/net.js             jaringan: SupaNet (Supabase) & DemoNet (offline)
js/game.js            render kanvas, input, panel KTM/Jurusan/Kantin/Info/Akun
supabase/schema.sql   tabel, RLS, fungsi, realtime
build-demo.js         membuat dist/demo.html (satu file, mode demo)
vercel.json           pengaturan Vercel
```

## Kuota Realtime

Paket Free Supabase dibatasi **200 koneksi bersamaan** dan **100 pesan/detik**. Setiap posisi yang di-broadcast dihitung untuk tiap penerima, jadi:

- Paket Free nyaman untuk sekitar **5–8 orang yang bergerak bersamaan**.
- Untuk lebih ramai: naik ke Pro, turunkan `POS_PER_DETIK` di `config.js`, atau bagi kampus jadi beberapa channel (misalnya satu channel per area/fakultas).
- Untuk ratusan pemain bergerak bersamaan, pertimbangkan server WebSocket sendiri (Railway/Fly.io) khusus posisi. Supabase tetap dipakai untuk akun dan data.

Pantau pemakaian di **Supabase → Realtime → Reports**.

## Keamanan tambahan yang disarankan

- Aktifkan **CAPTCHA** (Cloudflare Turnstile) di Supabase Auth supaya akun tamu tidak di-spam.
- Jadwalkan `hapus_chat_lama()` dengan pg_cron (contohnya ada di `schema.sql`).
- Tambahkan filter kata kasar di trigger `chat_batas_kecepatan`.
- Catatan: posisi lewat Broadcast tidak diverifikasi server, jadi orang iseng bisa "memindahkan" avatar orang lain di layar. Nama, chat, KTM, dan jabatan tetap aman karena dibaca dari database.

## Ide lanjutan

Kuis per fakultas, absen kuliah (koin), KRS-an, voting Dekan, konser di Panggung Ngepunk, peminjaman buku Perpus, dan dekorasi ruang himpunan.
