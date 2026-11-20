/*
 * net.js — lapisan jaringan.
 *  - SupaNet: Supabase (Auth tamu + Google, Realtime presence/broadcast, Postgres)
 *  - DemoNet: tanpa server, semua disimpan di browser
 * Keduanya punya method yang sama, jadi game.js tidak peduli sedang pakai yang mana.
 */
(function () {
  'use strict';

  function lget(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function lset(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
  function ldel(k) { try { localStorage.removeItem(k); } catch (e) { } }
  function errMsg(e) {
    var m = (e && (e.message || e.error_description || e.msg)) || String(e);
    if (/Failed to fetch|NetworkError/i.test(m)) return 'Koneksi bermasalah, coba lagi';
    if (/manual linking/i.test(m)) return 'Aktifkan "Manual Linking" di Supabase Auth dulu';
    if (/identity.*already/i.test(m)) return 'Akun Google ini sudah punya KTM. Pakai "Masuk dengan Google".';
    if (/provider is not enabled/i.test(m)) return 'Login Google belum diaktifkan di Supabase';
    if (/anonymous sign-ins are disabled/i.test(m)) return 'Aktifkan "Anonymous sign-ins" di Supabase Auth';
    return m;
  }
  function guestOf(id) { return 'Tamu ' + String(id).replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase(); }

  // =====================================================================
  // Supabase
  // =====================================================================
  function SupaNet(cfg, H) {
    var sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    var user = null, profile = null, ch = null;
    var known = new Set(), metaQueue = new Set(), metaTimer = null, metaWaiters = {};
    var api = { mode: 'online', guestOf: guestOf };
    function redirectTo() { return location.origin + location.pathname; }
    function selfInfo() {
      var email = user && user.email;
      if (!email && user && user.identities) user.identities.forEach(function (i) { if (i.identity_data && i.identity_data.email) email = i.identity_data.email; });
      return { id: user.id, isAnon: !!user.is_anonymous, email: email || null, guestName: guestOf(user.id) };
    }

    api.start = async function () {
      // error dari redirect Google (mis. akun Google sudah dipakai)
      var q = new URLSearchParams(location.search + '&' + location.hash.replace(/^#/, ''));
      var urlErr = q.get('error_description');
      if (urlErr) { ldel('kn_pending_ktm'); setTimeout(function () { H.toast(errMsg({ message: urlErr })); }, 600); history.replaceState(null, '', redirectTo()); }

      var r = await sb.auth.getSession();
      var session = r.data && r.data.session;
      if (!session) {
        var a = await sb.auth.signInAnonymously();
        if (a.error) throw a.error;
        session = a.data.session;
      }
      user = session.user;
      sb.auth.onAuthStateChange(function (ev, s) {
        if (!s) return;
        if (user && s.user.id !== user.id) { location.reload(); return; }
        user = s.user; H.onSelf(selfInfo());
      });
      H.onSelf(selfInfo());
      await loadProfile();

      // lanjutkan pendaftaran KTM yang tertunda karena pindah ke halaman Google
      var pend = lget('kn_pending_ktm');
      if (pend) {
        ldel('kn_pending_ktm');
        if (!profile && !user.is_anonymous) {
          try { await api.daftarKTM(pend.nama, pend.jurusan); } catch (e) { H.toast(errMsg(e)); H.openKTM(); }
        }
      }
      joinChannel();
      loadKantin(); loadPengumuman(); loadChatHistory(); refreshStats();
      setInterval(refreshStats, 60000);
    };

    async function loadProfile() {
      var r = await sb.from('mahasiswa').select('*').eq('id', user.id).maybeSingle();
      if (r.error) { H.toast(errMsg(r.error)); return; }
      profile = r.data || null;
      H.onProfile(profile);
    }

    function joinChannel() {
      ch = sb.channel('kampus-netizen', { config: { presence: { key: user.id }, broadcast: { self: false } } });
      ch.on('presence', { event: 'sync' }, function () {
        var st = ch.presenceState(), ids = Object.keys(st);
        H.onOnline(ids.length);
        ids.forEach(function (id) { if (id !== user.id && !known.has(id)) { known.add(id); H.onPeerJoin(id); requestMeta(id); } });
        known.forEach(function (id) { if (!st[id]) { known.delete(id); H.onPeerLeave(id); } });
      });
      ch.on('broadcast', { event: 'p' }, function (m) { var p = m.payload; if (p && p.i !== user.id) H.onPeerPos(p.i, +p.x, +p.y, +p.vx || 0, +p.vy || 0); });
      ch.on('broadcast', { event: 'hi' }, function () { H.onHello(); });
      ch.on('broadcast', { event: 'ktm' }, function (m) { if (m.payload && m.payload.i) requestMeta(m.payload.i); refreshStats(); });
      ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat' }, function (m) {
        var row = m.new; if (!row || row.user_id === user.id) return;
        ensureMeta(row.user_id).then(function () { H.onChat(row.user_id, row.teks, Date.parse(row.created_at), false); });
      });
      ch.on('postgres_changes', { event: '*', schema: 'public', table: 'kantin' }, function () { clearTimeout(api._kt); api._kt = setTimeout(loadKantin, 300); });
      ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pengumuman' }, function () { loadPengumuman(true); });
      ch.subscribe(function (status) {
        if (status === 'SUBSCRIBED') {
          ch.track({ t: Date.now() });
          ch.send({ type: 'broadcast', event: 'hi', payload: {} });
          H.onConnected(true);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          H.onConnected(false);
        }
      });
    }

    // ambil data KTM pemain lain (dikumpulkan dulu supaya 1 query untuk banyak orang)
    function requestMeta(id) {
      metaQueue.add(id);
      clearTimeout(metaTimer);
      metaTimer = setTimeout(flushMeta, 150);
    }
    function ensureMeta(id) {
      if (H.hasMeta(id)) return Promise.resolve();
      return new Promise(function (res) { (metaWaiters[id] = metaWaiters[id] || []).push(res); requestMeta(id); });
    }
    async function flushMeta() {
      var ids = Array.from(metaQueue); metaQueue.clear();
      if (!ids.length) return;
      var r = await sb.from('mahasiswa').select('id,nama,jurusan,nim,is_dekan,role').in('id', ids);
      var found = {};
      (r.data || []).forEach(function (row) { found[row.id] = row; });
      ids.forEach(function (id) {
        H.onPeerMeta(id, found[id] || null);
        (metaWaiters[id] || []).forEach(function (f) { f(); }); delete metaWaiters[id];
      });
    }

    async function refreshStats() {
      var r = await sb.from('mahasiswa').select('id', { count: 'exact', head: true });
      if (!r.error) H.onMahasiswaCount(r.count || 0);
    }
    async function loadKantin() {
      var r = await sb.from('kantin').select('id,barang,harga,created_at,user_id,mahasiswa(nama,jurusan)').order('created_at', { ascending: false }).limit(50);
      if (r.error) return;
      H.onKantin(r.data.map(function (k) {
        return { id: k.id, barang: k.barang, harga: k.harga, at: Date.parse(k.created_at), seller: k.mahasiswa ? k.mahasiswa.nama : '?', jurusan: k.mahasiswa ? k.mahasiswa.jurusan : null, mine: k.user_id === user.id };
      }));
    }
    async function loadPengumuman(isNew) {
      var r = await sb.from('pengumuman').select('id,judul,isi,created_at').order('created_at', { ascending: false }).limit(20);
      if (!r.error) H.onPengumuman(r.data.map(function (p) { return { judul: p.judul, isi: p.isi, at: Date.parse(p.created_at) }; }), !!isNew);
    }
    async function loadChatHistory() {
      var r = await sb.from('chat').select('user_id,teks,created_at').order('created_at', { ascending: false }).limit(30);
      if (r.error || !r.data.length) return;
      var rows = r.data.reverse();
      await Promise.all(rows.map(function (x) { return x.user_id === user.id ? null : ensureMeta(x.user_id); }));
      rows.forEach(function (x) { H.onChat(x.user_id, x.teks, Date.parse(x.created_at), true); });
    }

    api.daftarKTM = async function (nama, jurusan) {
      if (cfg.WAJIB_GOOGLE_UNTUK_KTM && user.is_anonymous) {
        lset('kn_pending_ktm', { nama: nama, jurusan: jurusan });
        var l = await sb.auth.linkIdentity({ provider: 'google', options: { redirectTo: redirectTo() } });
        if (l.error) { ldel('kn_pending_ktm'); throw l.error; }
        return null; // browser pindah ke Google, lalu kembali ke sini
      }
      var r = await sb.rpc('daftar_ktm', { p_nama: nama, p_jurusan: jurusan });
      if (r.error) throw r.error;
      profile = r.data;
      H.onProfile(profile, true);
      if (ch) ch.send({ type: 'broadcast', event: 'ktm', payload: { i: user.id } });
      refreshStats();
      return profile;
    };
    api.loginGoogle = async function () {
      var r = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirectTo() } });
      if (r.error) throw r.error;
    };
    api.logout = async function () { await sb.auth.signOut(); location.reload(); };
    api.sendPos = function (x, y, vx, vy) {
      if (ch) ch.send({ type: 'broadcast', event: 'p', payload: { i: user.id, x: +x.toFixed(2), y: +y.toFixed(2), vx: +vx.toFixed(2), vy: +vy.toFixed(2) } });
    };
    api.sendChat = async function (teks) {
      var r = await sb.from('chat').insert({ teks: teks });
      if (r.error) throw r.error;
    };
    api.jual = async function (barang, harga) {
      var r = await sb.from('kantin').insert({ barang: barang, harga: harga });
      if (r.error) throw r.error;
      loadKantin();
    };
    api.hapusJualan = async function (id) {
      var r = await sb.from('kantin').delete().eq('id', id);
      if (r.error) throw r.error;
      loadKantin();
    };
    api.postPengumuman = async function (judul, isi) {
      var r = await sb.from('pengumuman').insert({ judul: judul, isi: isi });
      if (r.error) throw r.error;
      loadPengumuman(true);
    };
    api.statJurusan = async function () {
      var r = await sb.rpc('statistik_jurusan');
      if (r.error) throw r.error;
      return r.data;
    };
    return api;
  }

  // =====================================================================
  // Demo (tanpa Supabase)
  // =====================================================================
  function DemoNet(cfg, H) {
    var api = { mode: 'demo', guestOf: guestOf };
    var guestId = lget('kn_guest') || Math.random().toString(36).slice(2, 10);
    lset('kn_guest', guestId);
    var profile = lget('kn_profile');
    var kantin = lget('kn_kantin') || [
      { id: 1, barang: 'Kopi susu gula aren', harga: 12000, seller: 'Nadia', jurusan: 'manajemen', at: Date.now() - 3600e3 },
      { id: 2, barang: 'Jasa servis laptop', harga: 50000, seller: 'Bima', jurusan: 'informatika', at: Date.now() - 7200e3 },
      { id: 3, barang: 'Kaos band bekas, masih bagus', harga: 35000, seller: 'Raka', jurusan: 'ngepunk', at: Date.now() - 86400e3 },
      { id: 4, barang: 'Catatan Anatomi lengkap', harga: 25000, seller: 'Zahra', jurusan: 'kedokteran', at: Date.now() - 2 * 86400e3 }
    ];
    var pengumuman = lget('kn_pengumuman') || [
      { judul: 'Selamat datang di Kampus Netizen! 🎓', isi: 'Bikin KTM dan pilih jurusanmu. Mahasiswa pertama di tiap jurusan otomatis jadi Dekan.', at: Date.now() },
      { judul: 'Pekan orientasi maba', isi: 'Kumpul di Bundaran depan Rektorat. Jangan lupa bawa almamater.', at: Date.now() - 86400e3 },
      { judul: 'Konser kampus 🤘', isi: 'Fakultas Ngepunk bikin konser di Panggung malam Minggu.', at: Date.now() - 2 * 86400e3 }
    ];
    function mine(list) { return list.map(function (k) { return Object.assign({}, k, { mine: profile && k.seller === profile.nama }); }); }
    function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    api.start = async function () {
      H.onSelf({ id: 'me', isAnon: true, email: null, guestName: guestOf(guestId) });
      H.onProfile(profile);
      H.onMahasiswaCount(1280 + (profile ? 1 : 0));
      H.onKantin(mine(kantin)); H.onPengumuman(pengumuman, true);
      H.onConnected(true);
    };
    api.daftarKTM = async function (nama, jurusan) {
      await wait(250);
      nama = String(nama).replace(/\s+/g, ' ').trim();
      if (nama.length < 2 || nama.length > 20) throw new Error('Nama harus 2–20 huruf');
      var j = World.JMAP[jurusan]; if (!j) throw new Error('Pilih jurusan dulu');
      profile = { id: 'me', nama: nama, jurusan: jurusan, nim: String(new Date().getFullYear()).slice(2) + j.kode + String(200 + ((Math.random() * 700) | 0)).padStart(5, '0'), angkatan: new Date().getFullYear(), is_dekan: false, role: 'mahasiswa', created_at: new Date().toISOString() };
      lset('kn_profile', profile);
      H.onProfile(profile, true);
      H.onMahasiswaCount(1281);
      return profile;
    };
    api.loginGoogle = async function () { throw new Error('Mode demo: login Google aktif setelah Supabase dipasang'); };
    api.logout = async function () { ldel('kn_profile'); location.reload(); };
    api.sendPos = function () { };
    api.sendChat = async function () { };
    api.jual = async function (barang, harga) {
      if (kantin.filter(function (k) { return profile && k.seller === profile.nama; }).length >= 5) throw new Error('Maksimal 5 barang per mahasiswa');
      kantin.unshift({ id: Date.now(), barang: barang, harga: harga, seller: profile.nama, jurusan: profile.jurusan, at: Date.now() });
      lset('kn_kantin', kantin.slice(0, 50)); H.onKantin(mine(kantin));
    };
    api.hapusJualan = async function (id) { kantin = kantin.filter(function (k) { return k.id !== id; }); lset('kn_kantin', kantin); H.onKantin(mine(kantin)); };
    api.postPengumuman = async function (judul, isi) { pengumuman.unshift({ judul: judul, isi: isi, at: Date.now() }); lset('kn_pengumuman', pengumuman); H.onPengumuman(pengumuman, true); };
    api.statJurusan = async function () {
      var base = { komunikasi: 241, informatika: 318, manajemen: 287, kesehatan: 176, kedokteran: 129, ngepunk: 129 };
      if (profile) base[profile.jurusan]++;
      return World.JURUSAN.map(function (j) { var b = H.demoDekan(j.id); return { jurusan: j.id, jumlah: base[j.id], dekan: b }; });
    };
    return api;
  }

  window.Net = {
    create: function (cfg, hooks) {
      var useSupa = cfg && cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase && window.supabase.createClient;
      return useSupa ? SupaNet(cfg, hooks) : DemoNet(cfg || {}, hooks);
    },
    errMsg: errMsg
  };
})();
