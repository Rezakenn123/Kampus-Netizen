// Isi dari Supabase Dashboard → Project Settings → API.
// Anon/publishable key AMAN ditaruh di frontend (keamanan dijaga oleh RLS di schema.sql).
// Kalau dikosongkan, game jalan dalam MODE DEMO (offline, warga lain = bot).
window.KN_CONFIG = {
  SUPABASE_URL: 'https://nfwjybmniwrlmhjjwgln.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_KAqSHG0qc9b5_lPGGmzhbA_Z1AQOiGQ',
  WAJIB_GOOGLE_UNTUK_KTM: true, // harus sama dengan c_wajib_google di schema.sql
  JUMLAH_BOT: 10,              // bot mahasiswa supaya kampus tidak sepi (0 = mati)
  POS_PER_DETIK: 3             // seberapa sering posisi dikirim saat bergerak (hemat kuota Realtime)
};
