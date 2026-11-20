/*
 * world.js — peta Kampus Netizen + data jurusan + bot.
 * Peta & bot dihitung dari seed dan jam, jadi semua pemain melihat hal yang sama
 * tanpa perlu server game (cocok untuk Vercel + Supabase).
 */
(function (root) {
  'use strict';

  var N = 72;
  var T = { GRASS: 0, ROAD: 1, WATER: 2, FIELD: 3, FOREST: 4, PAVE: 5, BANK: 6 };
  var ROADS = [6, 25, 46, 65];

  var JURUSAN = [
    { id: 'komunikasi', nama: 'Ilmu Komunikasi', fak: 'Fak. Ilmu Komunikasi', kode: '01', color: '#e8833a', emoji: '🎙️' },
    { id: 'informatika', nama: 'Informatika', fak: 'Fak. Informatika', kode: '02', color: '#2f6fd6', emoji: '💻' },
    { id: 'manajemen', nama: 'Manajemen', fak: 'Fak. Ekonomi & Bisnis', kode: '03', color: '#2e9b5f', emoji: '📈' },
    { id: 'kesehatan', nama: 'Kesehatan', fak: 'Fak. Ilmu Kesehatan', kode: '04', color: '#16a3a0', emoji: '🩺' },
    { id: 'kedokteran', nama: 'Kedokteran', fak: 'Fak. Kedokteran', kode: '05', color: '#c8323a', emoji: '⚕️' },
    { id: 'ngepunk', nama: 'Ngepunk', fak: 'Fak. Ngepunk', kode: '06', color: '#e0338f', emoji: '🤘' }
  ];
  var JMAP = {}; JURUSAN.forEach(function (j) { JMAP[j.id] = j; });

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash2(x, y) {
    var h = (x * 374761393 + y * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function generate() {
    var rnd = mulberry32(2026);
    var tiles = new Uint8Array(N * N), blocked = new Uint8Array(N * N);
    var objects = [], deco = [], fakultas = {};
    function idx(x, y) { return y * N + x; }
    function inb(x, y) { return x >= 0 && y >= 0 && x < N && y < N; }
    function set(x, y, t) { if (inb(x, y)) tiles[idx(x, y)] = t; }
    function get(x, y) { return inb(x, y) ? tiles[idx(x, y)] : -1; }
    function fill(x0, y0, w, h, t) { for (var y = y0; y < y0 + h; y++) for (var x = x0; x < x0 + w; x++) set(x, y, t); }
    function block(x0, y0, w, h) { for (var y = y0; y < y0 + h; y++) for (var x = x0; x < x0 + w; x++) if (inb(x, y)) blocked[idx(x, y)] = 1; }
    function bld(o) { o.type = 'building'; objects.push(o); block(o.x, o.y, o.w, o.h); return o; }
    function prop(o) { objects.push(o); if (o.solid) block(Math.floor(o.x), Math.floor(o.y), 1, 1); return o; }

    // 1) dasar: rumput, taman kota di tepi, danau di kanan
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
      var t = T.GRASS;
      if (x < 5 || y < 5) t = T.FOREST;
      var lakeEdge = 67 + Math.sin(y / 5) * 1.2 + Math.sin(y / 2.3) * 0.5;
      if (y > 14 && y < 62 && x > lakeEdge) t = T.WATER;
      else if (y > 13 && y < 63 && x > lakeEdge - 1.1) t = T.BANK;
      set(x, y, t);
    }

    // 2) jalan kampus (grid) + boulevard ke gerbang
    for (var i = 0; i < ROADS.length; i++) for (var k = 6; k <= 65; k++) { set(ROADS[i], k, T.ROAD); set(k, ROADS[i], T.ROAD); }
    for (var by = 46; by < N; by++) { set(35, by, T.ROAD); set(36, by, T.ROAD); }

    // 3) Rektorat + Bundaran (tengah)
    fill(26, 26, 20, 20, T.PAVE);
    for (var gy = 26; gy < 46; gy++) for (var gx = 26; gx < 46; gx++) {
      var d = Math.hypot(gx + 0.5 - 36, gy + 0.5 - 40);
      if (d > 3 && d < 5.2) set(gx, gy, T.GRASS);           // taman bundaran
      if ((gx < 28 || gx > 43) && gy > 33) set(gx, gy, T.GRASS);
    }
    bld({ kind: 'rektorat', name: '🏛️ Rektorat', x: 30, y: 28, w: 12, h: 5, wall: '#f2ede2', roof: '#8a3b2a', band: '#c9a227', height: 66, roofType: 'hip' });
    prop({ type: 'fountain', x: 36, y: 40, solid: true });
    prop({ type: 'flag', x: 31.5, y: 35.5 }); prop({ type: 'flag', x: 40.5, y: 35.5 });
    deco.push({ type: 'circle', x: 36, y: 40, r: 1.6, color: '#7fb2d6' });

    // 4) Fakultas
    function fak(jid, x, y, w, h, extra) {
      var j = JMAP[jid];
      var o = bld(Object.assign({ kind: 'fakultas', jurusan: jid, name: j.emoji + ' ' + j.fak, x: x, y: y, w: w, h: h, wall: '#f4f1ea', roof: shade(j.color, -0.25), band: j.color, height: 50, roofType: 'flat' }, extra || {}));
      fill(x - 2, y + h, w + 4, 3, T.PAVE);
      fakultas[jid] = { x: x + w / 2, y: y + h + 1.2 };
      return o;
    }
    fak('komunikasi', 10, 11, 10, 4);
    prop({ type: 'dish', x: 21.5, y: 9.5 });
    fak('informatika', 30, 11, 12, 4, { glass: true });
    prop({ type: 'antenna', x: 43.5, y: 10.5 });
    fak('manajemen', 51, 11, 10, 4, { height: 58 });
    fak('kesehatan', 10, 29, 10, 4);
    prop({ type: 'cross', x: 21.6, y: 30.5, color: '#16a3a0' });
    fak('kedokteran', 51, 28, 10, 4, { height: 56 });
    bld({ kind: 'rs', name: '🏥 RS Pendidikan', x: 51, y: 37, w: 7, h: 4, wall: '#ffffff', roof: '#b9c3c9', band: '#c8323a', height: 40, roofType: 'flat' });
    fill(49, 41, 11, 2, T.PAVE);
    prop({ type: 'ambulance', x: 60.5, y: 42 });
    fak('ngepunk', 10, 49, 9, 4, { wall: '#3a3a3f', roof: '#1f1f22', height: 44, punk: true });
    fill(10, 56, 11, 7, T.PAVE);
    bld({ kind: 'stage', name: '🎸 Panggung', x: 13, y: 57, w: 5, h: 3, wall: '#2b2b2b', roof: '#e0338f', height: 7, roofType: 'flat' });
    prop({ type: 'speaker', x: 12.4, y: 58.5 }); prop({ type: 'speaker', x: 18.6, y: 58.5 });

    // 5) Kantin & Perpustakaan (kiri-kanan boulevard)
    fill(26, 47, 9, 18, T.PAVE);
    var stallColors = ['#e24b3b', '#3f8fd0', '#f0b429', '#4caf50'];
    for (var s = 0; s < 4; s++) bld({ kind: 'stall', name: s === 0 ? '🍜 Kantin' : '', x: 27 + s * 2, y: 48, w: 2, h: 1, wall: '#d9c6a0', roof: stallColors[s], height: 12, roofType: 'hip' });
    for (var ty = 52; ty <= 61; ty += 3) for (var tx = 27.5; tx <= 33.5; tx += 3) prop({ type: 'table', x: tx, y: ty, color: stallColors[(tx + ty) % 4 | 0] });
    fill(37, 47, 9, 18, T.PAVE);
    bld({ kind: 'perpus', name: '📚 Perpustakaan', x: 38, y: 49, w: 7, h: 6, wall: '#efe8d8', roof: '#3d5a80', band: '#3d5a80', height: 46, roofType: 'flat' });
    for (var bb = 0; bb < 3; bb++) prop({ type: 'bench', x: 39 + bb * 2.2, y: 57.5 });

    // 6) Lapangan & Masjid
    fill(48, 48, 16, 11, T.FIELD);
    deco.push({ type: 'pitch', x0: 49, y0: 49, x1: 63, y1: 58 });
    prop({ type: 'goal', x: 49.2, y: 53.5 }); prop({ type: 'goal', x: 62.8, y: 53.5 });
    bld({ kind: 'masjid', name: '🕌 Masjid Kampus', x: 51, y: 60, w: 5, h: 4, wall: '#f5f2e8', roof: '#2e8b57', height: 30, roofType: 'hip' });

    // 7) Gerbang & parkiran
    fill(26, 66, 9, 5, T.PAVE); fill(37, 66, 9, 5, T.PAVE);
    for (var my = 67; my <= 69; my += 2) for (var mx = 27; mx <= 33; mx += 1.5) prop({ type: 'motor', x: mx, y: my + 0.5, color: ['#d63031', '#0984e3', '#2d3436', '#fdcb6e'][(mx * 2 + my) % 4 | 0] });
    prop({ type: 'gate', x: 34.6, y: 69, x2: 37.4 });
    block(34, 69, 1, 1); block(37, 69, 1, 1);
    prop({ type: 'sign', x: 40, y: 67.5, name: '🅿️ Parkiran' });

    // 8) lampu jalan di boulevard
    for (var ly = 48; ly <= 64; ly += 4) { prop({ type: 'lamp', x: 34.6, y: ly + 0.5 }); prop({ type: 'lamp', x: 37.4, y: ly + 0.5 }); }

    // 9) pohon
    for (var yy = 0; yy < N; yy++) for (var xx = 0; xx < N; xx++) {
      if (blocked[idx(xx, yy)]) continue;
      var tile = get(xx, yy), r = rnd();
      var nearRoad = get(xx - 1, yy) === T.ROAD || get(xx + 1, yy) === T.ROAD || get(xx, yy - 1) === T.ROAD || get(xx, yy + 1) === T.ROAD;
      if (tile === T.FOREST && r < 0.5) prop({ type: 'tree', kind: r < 0.3 ? 'pine' : 'round', x: xx + 0.5, y: yy + 0.5, s: 0.8 + rnd() * 0.5 });
      else if (tile === T.GRASS && nearRoad && (xx + yy) % 4 === 0 && !nearBlocked(xx, yy)) prop({ type: 'tree', kind: 'round', x: xx + 0.5, y: yy + 0.5, s: 0.75 + rnd() * 0.3 });
      else if (tile === T.GRASS && !nearRoad && r < 0.06 && !nearBlocked(xx, yy)) prop({ type: 'tree', kind: rnd() < 0.4 ? 'palm' : 'round', x: xx + 0.5, y: yy + 0.5, s: 0.8 + rnd() * 0.4 });
      else if (tile === T.BANK && r < 0.12) prop({ type: 'tree', kind: 'palm', x: xx + 0.5, y: yy + 0.5, s: 0.9 + rnd() * 0.3 });
    }
    function nearBlocked(x, y) {
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) if (inb(x + dx, y + dy) && blocked[idx(x + dx, y + dy)]) return true;
      return false;
    }
    for (var q = 0; q < N * N; q++) if (tiles[q] === T.WATER) blocked[q] = 1;

    return {
      N: N, T: T, tiles: tiles, blockedMap: blocked, objects: objects, deco: deco, fakultas: fakultas,
      spawn: { x: 36.5, y: 44.5 }, gate: { x: 35.9, y: 67.5 },
      tileAt: function (x, y) { return get(x | 0, y | 0); },
      isBlocked: function (x, y) {
        if (x < 0.3 || y < 0.3 || x > N - 0.3 || y > N - 0.3) return true;
        return blocked[idx(x | 0, y | 0)] === 1;
      }
    };
  }

  function shade(hex, amt) {
    var n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    if (amt < 0) { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; } else { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
    return '#' + ((1 << 24) + ((r | 0) << 16) + ((g | 0) << 8) + (b | 0)).toString(16).slice(1);
  }

  // Cuaca berganti tiap 20 menit, sama untuk semua pemain
  function weatherAt(ms) {
    var r = hash2(Math.floor(ms / (20 * 60 * 1000)), 7);
    return r < 0.3 ? 'HUJAN' : r < 0.6 ? 'BERAWAN' : 'CERAH';
  }

  // ---------------- Bot berbasis waktu ----------------
  // Posisi bot = fungsi dari jam, jadi semua HP melihat bot di tempat yang sama.
  var NAMES = ['Raka', 'Nadia', 'Bima', 'Salsa', 'Dimas', 'Aulia', 'Fikri', 'Zahra', 'Rizal', 'Keisha', 'Bayu', 'Tiara', 'Gilang', 'Nayla', 'Farhan', 'Citra', 'Yoga', 'Anisa', 'Reza', 'Putri', 'Ilham', 'Dinda', 'Arya', 'Vina', 'Kevin', 'Laras', 'Hanif', 'Sekar'];
  var LINES = ['Ada yang udah KRS-an?', 'Dosennya telat lagi 😅', 'Kantin yuk 🍜', 'Perpus rame banget', 'Tugas numpuk 😭', 'Anak Ngepunk konser di panggung 🤘', 'Semangat UTS!', 'Wifi kampus lemot', 'Siapa mau mabar?', 'Halo maba 👋', 'Parkiran penuh', 'Neduh dulu, hujan', 'Info beasiswa dong', 'Ngopi di kantin?', 'Ada Dekan lewat, rapihin baju', 'Praktikum jam berapa?', 'Lapangan kosong, main bola yuk ⚽', 'Salam kenal semua'];
  var REKTOR_LINES = ['Selamat datang di Kampus Netizen! 🎓', 'Jangan lupa isi KRS tepat waktu ya.', 'Perpustakaan buka sampai jam 9 malam.', 'Anak Ngepunk, volumenya dikecilin dikit 😅', 'Bangga sama mahasiswa semua!', 'Para Dekan, rapat di Rektorat jam 2.', 'Jaga kebersihan kampus ya.'];

  function nodePos(i, j) { return [ROADS[i] + 0.5, ROADS[j] + 0.5]; }
  var LOOPS = [
    [[32.5, 36.5], [40.5, 36.5], [40.5, 43.5], [32.5, 43.5]],     // bundaran
    [[27.5, 51.5], [33.5, 51.5], [33.5, 62.5], [27.5, 62.5]],     // kantin
    [[48.5, 48.5], [63.5, 48.5], [63.5, 58.5], [48.5, 58.5]],     // lapangan
    [[37.5, 56.5], [45.5, 56.5], [45.5, 63.5], [37.5, 63.5]],     // depan perpus
    [[9.5, 63.5], [20.5, 63.5], [20.5, 55.5], [9.5, 55.5]]        // panggung
  ];

  function buildSegs(points, rnd, speed, pauseChance) {
    var segs = [], total = 0;
    for (var i = 0; i < points.length; i++) {
      var a = points[i], b = points[(i + 1) % points.length];
      if (rnd() < pauseChance) { var pd = 2 + rnd() * 5; segs.push({ x0: a[0], y0: a[1], x1: a[0], y1: a[1], t0: total, dur: pd }); total += pd; }
      var len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len > 0.01) { var dd = len / speed; segs.push({ x0: a[0], y0: a[1], x1: b[0], y1: b[1], t0: total, dur: dd }); total += dd; }
    }
    return { segs: segs, total: total };
  }

  function makeBots(count, opts) {
    opts = opts || {};
    var rnd = mulberry32(777), bots = [];
    for (var i = 0; i < count; i++) {
      var pts;
      if (i % 3 === 2) {
        pts = LOOPS[(i / 3 | 0) % LOOPS.length].map(function (p) { return [p[0] + (rnd() - 0.5) * 1.5, p[1] + (rnd() - 0.5) * 1.5]; });
      } else {
        var ci = (rnd() * 4) | 0, cj = (rnd() * 4) | 0, path = [[ci, cj]], prev = null;
        for (var s = 0; s < 9; s++) {
          var nb = [[ci + 1, cj], [ci - 1, cj], [ci, cj + 1], [ci, cj - 1]].filter(function (n) { return n[0] >= 0 && n[0] < 4 && n[1] >= 0 && n[1] < 4 && !(prev && n[0] === prev[0] && n[1] === prev[1]); });
          var n = nb[(rnd() * nb.length) | 0]; prev = [ci, cj]; ci = n[0]; cj = n[1]; path.push([ci, cj]);
        }
        var back = path.slice(1, -1).reverse();
        var lane = (rnd() - 0.5) * 0.45;
        pts = path.concat(back).map(function (p) { var q = nodePos(p[0], p[1]); return [q[0] + lane, q[1] + lane]; });
      }
      var speed = 1.3 + rnd() * 0.8;
      var built = buildSegs(pts, rnd, speed, 0.35);
      var guest = rnd() < 0.2;
      var jur = JURUSAN[(rnd() * JURUSAN.length) | 0].id;
      var dekan = !!opts.dekan && i < JURUSAN.length;
      if (dekan) jur = JURUSAN[i].id;
      bots.push({
        id: 'bot' + i, bot: true, segs: built.segs, total: built.total, phase: rnd() * built.total,
        name: guest ? 'Tamu ' + Math.floor(rnd() * 1679616).toString(36).toUpperCase() : NAMES[i % NAMES.length],
        jurusan: guest ? null : jur, role: dekan ? 'dekan' : (guest ? 'tamu' : 'mahasiswa'),
        chatPeriod: 35 + rnd() * 70, chatPhase: rnd() * 100, lines: LINES
      });
    }
    return bots;
  }

  function makeRektor() {
    var rnd = mulberry32(42);
    var pts = [[36, 33.6], [36, 35.5], [33, 36.5], [33, 43.5], [39.5, 43.5], [39.5, 36.5], [36, 35.5]];
    var built = buildSegs(pts, rnd, 1.1, 0.6);
    return { id: 'rektor-npc', bot: true, npc: true, segs: built.segs, total: built.total, phase: 0, name: 'Pak Rektor', role: 'rektor', jurusan: null, chatPeriod: 40, chatPhase: 3, lines: REKTOR_LINES };
  }

  function botState(b, tSec) {
    var u = ((tSec + b.phase) % b.total + b.total) % b.total;
    var segs = b.segs, lo = 0, hi = segs.length - 1;
    while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (segs[mid].t0 <= u) lo = mid; else hi = mid - 1; }
    var s = segs[lo], f = s.dur > 0 ? (u - s.t0) / s.dur : 0;
    return { x: s.x0 + (s.x1 - s.x0) * f, y: s.y0 + (s.y1 - s.y0) * f, moving: s.x0 !== s.x1 || s.y0 !== s.y1, dx: s.x1 - s.x0, dy: s.y1 - s.y0 };
  }

  // Bot "ngomong" selama 6 detik di setiap periode; teks dipilih dari jam juga
  function botChat(b, tSec) {
    var v = tSec + b.chatPhase, k = Math.floor(v / b.chatPeriod);
    if (v - k * b.chatPeriod > 6) return null;
    var idx = Math.floor(hash2(k, b.id.length * 31 + b.chatPeriod | 0) * b.lines.length);
    return { key: k, text: b.lines[idx] };
  }

  var World = { generate: generate, JURUSAN: JURUSAN, JMAP: JMAP, weatherAt: weatherAt, makeBots: makeBots, makeRektor: makeRektor, botState: botState, botChat: botChat, mulberry32: mulberry32, hash2: hash2, shade: shade };
  if (typeof module !== 'undefined' && module.exports) module.exports = World; else root.World = World;
})(typeof window !== 'undefined' ? window : this);
