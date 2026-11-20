-- =====================================================================
-- Kampus Netizen — skema database Supabase
-- Jalankan sekali di: Supabase Dashboard → SQL Editor → New query → Run
-- =====================================================================

-- ---------- 1. Mahasiswa (KTM) ----------
create table if not exists public.mahasiswa (
  id          uuid primary key references auth.users (id) on delete cascade,
  nama        text not null check (char_length(nama) between 2 and 20),
  jurusan     text not null check (jurusan in ('komunikasi','informatika','manajemen','kesehatan','kedokteran','ngepunk')),
  nim         text not null unique,
  angkatan    int  not null default extract(year from now())::int,
  is_dekan    boolean not null default false,          -- mahasiswa pertama di jurusan = Dekan
  role        text not null default 'mahasiswa' check (role in ('mahasiswa','rektor')),
  created_at  timestamptz not null default now()
);
create unique index if not exists mahasiswa_satu_dekan  on public.mahasiswa (jurusan) where is_dekan;
create unique index if not exists mahasiswa_satu_rektor on public.mahasiswa (role)    where role = 'rektor';
create unique index if not exists mahasiswa_nama_unik   on public.mahasiswa (lower(nama));

alter table public.mahasiswa enable row level security;
drop policy if exists "KTM bisa dilihat semua" on public.mahasiswa;
create policy "KTM bisa dilihat semua" on public.mahasiswa for select to authenticated using (true);
-- Tidak ada policy insert/update: KTM hanya bisa dibuat lewat fungsi daftar_ktm() di bawah,
-- jadi orang tidak bisa mengangkat dirinya sendiri jadi Dekan/Rektor.

-- Bikin KTM. Kalau jurusan belum punya Dekan, pendaftar ini otomatis jadi Dekan.
create or replace function public.daftar_ktm(p_nama text, p_jurusan text)
returns public.mahasiswa
language plpgsql
security definer
set search_path = public
as $$
declare
  -- true = wajib hubungkan Google dulu sebelum bikin KTM
  c_wajib_google constant boolean := false;
  v_uid   uuid := auth.uid();
  v_nama  text := btrim(regexp_replace(coalesce(p_nama, ''), '\s+', ' ', 'g'));
  v_kode  text;
  v_urut  int;
  v_dekan boolean;
  v_row   public.mahasiswa;
  v_con   text;
begin
  if v_uid is null then
    raise exception 'Belum login';
  end if;
  if c_wajib_google and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Hubungkan akun Google dulu untuk bikin KTM';
  end if;
  if exists (select 1 from public.mahasiswa where id = v_uid) then
    raise exception 'Kamu sudah punya KTM';
  end if;
  if char_length(v_nama) < 2 or char_length(v_nama) > 20 then
    raise exception 'Nama harus 2–20 huruf';
  end if;
  v_kode := case p_jurusan
    when 'komunikasi'  then '01' when 'informatika' then '02' when 'manajemen'  then '03'
    when 'kesehatan'   then '04' when 'kedokteran'  then '05' when 'ngepunk'    then '06'
  end;
  if v_kode is null then
    raise exception 'Jurusan tidak dikenal';
  end if;

  -- kunci per jurusan supaya tidak ada 2 Dekan / NIM kembar saat daftar bersamaan
  perform pg_advisory_xact_lock(hashtext('ktm:' || p_jurusan));
  select coalesce(max(right(nim, 5)::int), 0) + 1 into v_urut from public.mahasiswa where jurusan = p_jurusan;
  v_dekan := not exists (select 1 from public.mahasiswa where jurusan = p_jurusan and is_dekan);

  begin
    insert into public.mahasiswa (id, nama, jurusan, nim, is_dekan)
    values (v_uid, v_nama, p_jurusan, to_char(now(), 'YY') || v_kode || lpad(v_urut::text, 5, '0'), v_dekan)
    returning * into v_row;
  exception when unique_violation then
    get stacked diagnostics v_con = constraint_name;
    if v_con = 'mahasiswa_nama_unik' then
      raise exception 'Nama sudah dipakai mahasiswa lain';
    end if;
    raise;
  end;
  return v_row;
end;
$$;
revoke all on function public.daftar_ktm(text, text) from public, anon;
grant execute on function public.daftar_ktm(text, text) to authenticated;

-- Ringkasan per jurusan untuk tab "Jurusan"
create or replace function public.statistik_jurusan()
returns table (jurusan text, jumlah bigint, dekan text)
language sql stable
set search_path = public
as $$
  select m.jurusan, count(*)::bigint, max(case when m.is_dekan then m.nama end)
  from public.mahasiswa m
  group by m.jurusan;
$$;
revoke all on function public.statistik_jurusan() from public, anon;
grant execute on function public.statistik_jurusan() to authenticated;

-- ---------- 2. Chat (disimpan, jadi pengirimnya asli) ----------
create table if not exists public.chat (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  teks        text not null check (char_length(btrim(teks)) between 1 and 120),
  created_at  timestamptz not null default now()
);
create index if not exists chat_user_waktu on public.chat (user_id, created_at desc);
create index if not exists chat_waktu on public.chat (created_at desc);
alter table public.chat enable row level security;
drop policy if exists "chat dibaca semua" on public.chat;
create policy "chat dibaca semua" on public.chat for select to authenticated using (true);
drop policy if exists "chat atas nama sendiri" on public.chat;
create policy "chat atas nama sendiri" on public.chat for insert to authenticated with check (user_id = (select auth.uid()));

create or replace function public.chat_batas_kecepatan()
returns trigger language plpgsql set search_path = public as $$
begin
  if exists (select 1 from public.chat where user_id = new.user_id and created_at > now() - interval '1 second') then
    raise exception 'Pelan-pelan ngetiknya';
  end if;
  new.teks := btrim(new.teks);
  return new;
end;
$$;
drop trigger if exists chat_batas_kecepatan on public.chat;
create trigger chat_batas_kecepatan before insert on public.chat for each row execute function public.chat_batas_kecepatan();

-- ---------- 3. Kantin (jual-beli) ----------
create table if not exists public.kantin (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references public.mahasiswa (id) on delete cascade,
  barang      text not null check (char_length(btrim(barang)) between 1 and 60),
  harga       int  not null check (harga between 0 and 1000000000),
  created_at  timestamptz not null default now()
);
create index if not exists kantin_waktu on public.kantin (created_at desc);
create index if not exists kantin_user on public.kantin (user_id);
alter table public.kantin enable row level security;
drop policy if exists "kantin dibaca semua" on public.kantin;
create policy "kantin dibaca semua" on public.kantin for select to authenticated using (true);
drop policy if exists "jualan sendiri" on public.kantin;
create policy "jualan sendiri" on public.kantin for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "hapus jualan sendiri" on public.kantin;
create policy "hapus jualan sendiri" on public.kantin for delete to authenticated using (user_id = (select auth.uid()));

create or replace function public.kantin_batas()
returns trigger language plpgsql set search_path = public as $$
begin
  if (select count(*) from public.kantin where user_id = new.user_id) >= 5 then
    raise exception 'Maksimal 5 barang per mahasiswa';
  end if;
  new.barang := btrim(new.barang);
  return new;
end;
$$;
drop trigger if exists kantin_batas on public.kantin;
create trigger kantin_batas before insert on public.kantin for each row execute function public.kantin_batas();

-- ---------- 4. Pengumuman (hanya Rektor yang bisa menulis) ----------
create table if not exists public.pengumuman (
  id          bigint generated always as identity primary key,
  user_id     uuid default auth.uid() references public.mahasiswa (id) on delete set null,
  judul       text not null check (char_length(judul) between 1 and 80),
  isi         text not null check (char_length(isi) between 1 and 500),
  created_at  timestamptz not null default now()
);
create index if not exists pengumuman_user on public.pengumuman (user_id);
alter table public.pengumuman enable row level security;
drop policy if exists "pengumuman dibaca semua" on public.pengumuman;
create policy "pengumuman dibaca semua" on public.pengumuman for select to authenticated using (true);
drop policy if exists "rektor menulis pengumuman" on public.pengumuman;
create policy "rektor menulis pengumuman" on public.pengumuman for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (select 1 from public.mahasiswa where id = (select auth.uid()) and role = 'rektor'));

insert into public.pengumuman (user_id, judul, isi)
select null, 'Selamat datang di Kampus Netizen! 🎓',
       'Bikin KTM dan pilih jurusanmu. Mahasiswa pertama di tiap jurusan otomatis jadi Dekan.'
where not exists (select 1 from public.pengumuman);

-- ---------- 5. Realtime ----------
-- chat, kantin, pengumuman dikirim live ke semua pemain
do $$
begin
  begin alter publication supabase_realtime add table public.chat;       exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.kantin;     exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.pengumuman; exception when duplicate_object then null; end;
end $$;

-- ---------- 6. Bersih-bersih chat lama (opsional) ----------
create or replace function public.hapus_chat_lama() returns void language sql set search_path = public as $$
  delete from public.chat where created_at < now() - interval '7 days';
$$;
revoke all on function public.hapus_chat_lama() from public, anon, authenticated;
-- Aktifkan extension pg_cron (Database → Extensions), lalu:
-- select cron.schedule('hapus-chat-lama', '0 3 * * *', 'select public.hapus_chat_lama()');

-- ---------- 7. Angkat Rektor (jalankan manual, ganti namanya) ----------
-- update public.mahasiswa set role = 'rektor' where lower(nama) = lower('NamaKamu');
