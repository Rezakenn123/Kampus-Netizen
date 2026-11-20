/*
 * game.js — klien Kampus Netizen (Vanilla JS + Canvas)
 */
(function () {
  'use strict';

  var CFG = window.KN_CONFIG || {};
  var world = World.generate();
  var N = world.N, T = world.T, JMAP = World.JMAP;
  var HW = 32, HH = 16;

  // ---------- util ----------
  var $ = function (id) { return document.getElementById(id); };
  function P(x, y, z) { return [(x - y) * HW, (x + y) * HH - (z || 0)]; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function strHash(s) { var h = 0; s = String(s); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  var shade = World.shade;
  function el(tag, props, kids) {
    var e = document.createElement(tag);
    if (props) for (var k in props) {
      var v = props[k];
      if (v == null) continue;
      if (k === 'text') e.textContent = v;
      else if (k === 'cls') e.className = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function rupiah(n) { return 'Rp' + Number(n || 0).toLocaleString('id-ID'); }
  var DAYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  function wib(ms) { return new Date((ms || Date.now()) + 7 * 3600 * 1000); }
  function fmtDate(ms) { var d = wib(ms); return DAYS[d.getUTCDay()] + ', ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); }
  function fmtTime(ms) { var d = wib(ms); return pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()); }
  function hourWIB() { if (window.KN_HOUR != null) return window.KN_HOUR; var d = wib(); return d.getUTCHours() + d.getUTCMinutes() / 60; }
  function nowSec() { return Date.now() / 1000; }

  var SHIRTS = ['#e85d4a', '#3f8fd0', '#f0b429', '#4caf50', '#9b59b6', '#e67e22', '#1abc9c', '#ec6f9b', '#34495e'];
  var SKINS = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'];
  var UMBRELLAS = ['#e24b3b', '#3f8fd0', '#f0b429', '#7d3c98', '#2e8b57', '#ec6f9b'];

  // ---------- identitas & label ----------
  // meta: null = tamu, atau {nama, jurusan, role, is_dekan}
  function labelOf(meta, guestName) {
    if (!meta) return guestName || 'Tamu';
    if (meta.role === 'rektor') return '👑 Rektor · ' + meta.nama;
    var j = JMAP[meta.jurusan];
    if (meta.is_dekan || meta.role === 'dekan') return 'Dekan ' + (j ? j.nama : '') + ' · ' + meta.nama;
    return meta.nama;
  }
  function lookOf(seed, meta) {
    var h = strHash(seed), j = meta && JMAP[meta.jurusan];
    return {
      shirt: meta && meta.role === 'rektor' ? '#1f2330' : (j ? j.color : SHIRTS[h % SHIRTS.length]),
      skin: SKINS[(h >> 3) % SKINS.length], umb: UMBRELLAS[(h >> 6) % UMBRELLAS.length], phase: (h % 100) / 10,
      toga: !!(meta && meta.role === 'rektor'), tie: !!(meta && (meta.is_dekan || meta.role === 'dekan'))
    };
  }
  function applyMeta(p, meta) {
    p.meta = meta; p.jurusan = meta ? meta.jurusan : null;
    p.name = meta ? meta.nama : p.guestName;
    p.label = labelOf(meta, p.guestName);
    p.look = lookOf(p.id, meta);
  }

  // ---------- canvas ----------
  var canvas = $('game'), ctx = canvas.getContext('2d');
  var W = 0, H = 0, DPR = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  }
  window.addEventListener('resize', resize); resize();

  // ---------- state ----------
  var me = { id: 'me', x: world.spawn.x, y: world.spawn.y, guestName: 'Tamu', dir: 1, moving: false, isMe: true, isAnon: true, email: null, profile: null };
  applyMeta(me, null);
  var peers = new Map();    // id -> pemain sungguhan lain
  var metas = new Map();    // id -> meta
  var bots = World.makeBots(CFG.SUPABASE_URL ? (CFG.JUMLAH_BOT | 0) : 28, { dekan: !CFG.SUPABASE_URL });
  bots.forEach(function (b) { b.guestName = b.name; applyMeta(b, b.jurusan ? { nama: b.name, jurusan: b.jurusan, role: b.role } : null); b.lastChatKey = null; });
  var rektor = World.makeRektor();
  rektor.guestName = rektor.name; applyMeta(rektor, { nama: 'Pak Rektor', role: 'rektor' }); rektor.lastChatKey = null;
  var stats = { mahasiswa: 0, online: 1, updated: Date.now() };
  var kantin = [], pengumuman = [], chatLog = [];
  var zoom = window.innerWidth < 600 ? 0.62 : 0.9;
  var connected = false;

  // ---------- jaringan ----------
  var net = Net.create(CFG, {
    onSelf: function (s) {
      var oldId = me.id;
      me.id = s.id; me.isAnon = s.isAnon; me.email = s.email; me.guestName = s.guestName;
      if (!me.profile) applyMeta(me, null);
      if (oldId !== me.id) metas.set(me.id, me.profile);
      if (currentTab === 'akun' || currentTab === 'ktm') refreshPanel();
    },
    onProfile: function (p, isNew) {
      me.profile = p; applyMeta(me, p); metas.set(me.id, p);
      $('ktpBtn').textContent = p ? p.nama : 'Bikin KTM';
      if (p && isNew) {
        var j = JMAP[p.jurusan];
        toast(p.is_dekan ? ('Selamat! Kamu Dekan pertama ' + j.nama + ' 🎉') : ('KTM jadi! Selamat datang di ' + j.nama + ' ' + j.emoji));
        goFakultas(); openPanel('ktm');
      }
      if (!placed) { if (p) goFakultas(); placed = true; }
      if (currentTab) refreshPanel();
    },
    onConnected: function (ok) { connected = ok; if (!ok && net.mode === 'online') toast('Koneksi realtime terputus, menyambung ulang…'); },
    onOnline: function (n) { stats.online = n; },
    onMahasiswaCount: function (n) { stats.mahasiswa = n; stats.updated = Date.now(); },
    onPeerJoin: function (id) {
      if (peers.has(id)) return;
      var p = { id: id, x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, t: 0, hasPos: false, dir: 1, guestName: net.guestOf(id) };
      applyMeta(p, metas.has(id) ? metas.get(id) : null);
      peers.set(id, p);
    },
    onPeerLeave: function (id) { peers.delete(id); },
    onPeerMeta: function (id, meta) {
      metas.set(id, meta);
      var p = peers.get(id); if (p) applyMeta(p, meta);
      if (currentTab === 'jurusan' || currentTab === 'dekat') refreshPanel();
    },
    hasMeta: function (id) { return metas.has(id); },
    onPeerPos: function (id, x, y, vx, vy) {
      var p = peers.get(id);
      if (!p) { this.onPeerJoin(id); p = peers.get(id); }
      if (!p.hasPos) { p.x = x; p.y = y; }
      p.px = x; p.py = y; p.vx = clamp(vx, -5, 5); p.vy = clamp(vy, -5, 5); p.t = performance.now(); p.hasPos = true;
    },
    onHello: function () { setTimeout(function () { sendPosNow(); }, Math.random() * 1200); },
    onChat: function (id, text, at, history) {
      var p = id === me.id ? me : peers.get(id);
      var meta = metas.get(id);
      var name = meta ? meta.nama : (p ? p.name : net.guestOf(id));
      pushChat(name, text, at, meta ? meta.jurusan : null);
      if (!history && p) p.chat = { text: text, until: Date.now() + 7000 };
    },
    onKantin: function (list) { kantin = list; if (currentTab === 'kantin') refreshPanel(); },
    onPengumuman: function (list, isNew) { pengumuman = list; if (isNew && currentTab !== 'info') $('infoDot').style.display = 'block'; if (currentTab === 'info') refreshPanel(); },
    toast: function (m) { toast(m); },
    openKTM: function () { openPanel('ktm'); },
    demoDekan: function (jid) { var b = bots.find(function (x) { return x.role === 'dekan' && x.jurusan === jid; }); return b ? b.name : null; }
  });
  var placed = false;

  function goFakultas() {
    var f = me.profile ? world.fakultas[me.profile.jurusan] : world.spawn;
    me.x = f.x; me.y = f.y; camOff.x = camOff.y = 0; sendPosNow();
  }

  // ---------- chat ----------
  function pushChat(name, text, at, jurusan) {
    chatLog.push({ name: name, text: text, at: at || Date.now(), jurusan: jurusan });
    if (chatLog.length > 80) chatLog.shift();
    if (currentTab === 'chat') renderChatLog();
  }
  var lastChatAt = 0;
  function sendChat(text) {
    text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!text) return;
    if (Date.now() - lastChatAt < 1100) { toast('Pelan-pelan ngetiknya 😄'); return; }
    lastChatAt = Date.now();
    me.chat = { text: text, until: Date.now() + 7000 };
    pushChat(me.name, text, Date.now(), me.jurusan);
    net.sendChat(text).catch(function (e) { toast(Net.errMsg(e)); });
  }

  // ---------- input ----------
  var joy = { x: 0, y: 0, id: null };
  var joyEl = $('joy'), knob = $('knob');
  function joyMove(e) {
    var r = joyEl.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    var dx = e.clientX - cx, dy = e.clientY - cy, d = Math.sqrt(dx * dx + dy * dy), max = r.width / 2 - 20;
    if (d > max) { dx = dx / d * max; dy = dy / d * max; }
    knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    joy.x = dx / max; joy.y = dy / max;
  }
  joyEl.addEventListener('pointerdown', function (e) { joy.id = e.pointerId; joyEl.setPointerCapture(e.pointerId); joyMove(e); unlockAudio(); });
  joyEl.addEventListener('pointermove', function (e) { if (e.pointerId === joy.id) joyMove(e); });
  function joyEnd(e) { if (e.pointerId !== joy.id) return; joy.id = null; joy.x = joy.y = 0; knob.style.transform = ''; }
  joyEl.addEventListener('pointerup', joyEnd); joyEl.addEventListener('pointercancel', joyEnd);

  var keys = {};
  window.addEventListener('keydown', function (e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    keys[e.key.toLowerCase()] = true;
    if (e.key === 'Enter') { openPanel('chat'); e.preventDefault(); }
  });
  window.addEventListener('keyup', function (e) { keys[e.key.toLowerCase()] = false; });
  window.addEventListener('blur', function () { keys = {}; });

  var drag = null, camOff = { x: 0, y: 0 };
  canvas.addEventListener('pointerdown', function (e) { drag = { x: e.clientX, y: e.clientY, ox: camOff.x, oy: camOff.y }; canvas.setPointerCapture(e.pointerId); unlockAudio(); });
  canvas.addEventListener('pointermove', function (e) { if (!drag) return; camOff.x = drag.ox - (e.clientX - drag.x) / zoom; camOff.y = drag.oy - (e.clientY - drag.y) / zoom; });
  canvas.addEventListener('pointerup', function () { drag = null; });
  canvas.addEventListener('wheel', function (e) { e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.1 : 0.9)); }, { passive: false });
  function setZoom(z) { zoom = clamp(z, 0.4, 2.2); }
  $('zoomIn').onclick = function () { setZoom(zoom * 1.2); };
  $('zoomOut').onclick = function () { setZoom(zoom / 1.2); };
  $('homeBtn').onclick = function () { if (me.profile) { goFakultas(); toast('Ke ' + JMAP[me.profile.jurusan].fak); } else openPanel('ktm'); };
  $('nearBtn').onclick = function () { openPanel('dekat'); };
  $('ktpBtn').onclick = function () { openPanel('ktm'); };
  $('chatTab').onclick = function () { openPanel('chat'); };

  // ---------- suara hujan ----------
  var audio = null, soundOn = false;
  function unlockAudio() { if (audio && audio.ctx.state === 'suspended') audio.ctx.resume(); }
  function initAudio() {
    var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    var ac = new AC(), len = ac.sampleRate * 2, buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    var src = ac.createBufferSource(); src.buffer = buf; src.loop = true;
    var f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1400;
    var g = ac.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(ac.destination); src.start();
    return { ctx: ac, gain: g };
  }
  $('soundBtn').onclick = function () {
    soundOn = !soundOn;
    try { if (soundOn && !audio) audio = initAudio(); unlockAudio(); } catch (e) { }
    $('soundBtn').textContent = soundOn ? '🔊' : '🔇';
  };

  // ---------- simulasi ----------
  var sendAcc = 0, wasMoving = false, vel = { x: 0, y: 0 };
  var POS_INTERVAL = 1 / Math.max(1, CFG.POS_PER_DETIK || 3);
  function sendPosNow() { net.sendPos(me.x, me.y, me.moving ? vel.x : 0, me.moving ? vel.y : 0); sendAcc = 0; }

  function update(dt, now) {
    var jx = joy.x, jy = joy.y;
    if (keys['arrowleft'] || keys['a']) jx -= 1;
    if (keys['arrowright'] || keys['d']) jx += 1;
    if (keys['arrowup'] || keys['w']) jy -= 1;
    if (keys['arrowdown'] || keys['s']) jy += 1;
    var m = Math.sqrt(jx * jx + jy * jy);
    var ox = me.x, oy = me.y;
    if (m > 0.15) {
      if (m > 1) { jx /= m; jy /= m; m = 1; }
      var wx = jx / HW + jy / HH, wy = jy / HH - jx / HW, wl = Math.sqrt(wx * wx + wy * wy);
      wx /= wl; wy /= wl;
      var sp = 3.8 * m * dt, nx = me.x + wx * sp, ny = me.y + wy * sp;
      if (!world.isBlocked(nx, me.y)) me.x = nx;
      if (!world.isBlocked(me.x, ny)) me.y = ny;
      me.moving = true; if (Math.abs(jx) > 0.05) me.dir = jx < 0 ? -1 : 1;
      camOff.x *= 0.85; camOff.y *= 0.85;
    } else me.moving = false;
    if (dt > 0) { vel.x = (me.x - ox) / dt; vel.y = (me.y - oy) / dt; }

    // kirim posisi seperlunya (hemat kuota Realtime)
    sendAcc += dt;
    if (me.moving && sendAcc >= POS_INTERVAL) sendPosNow();
    if (!me.moving && wasMoving) sendPosNow();
    wasMoving = me.moving;

    // pemain lain: tebak posisi dari kecepatan terakhir lalu haluskan
    peers.forEach(function (p) {
      if (!p.hasPos) return;
      var age = Math.min(0.8, (now - p.t) / 1000);
      var tx = p.px + p.vx * age, ty = p.py + p.vy * age;
      if (world.isBlocked(tx, ty)) { tx = p.px; ty = p.py; }
      var dx = tx - p.x, dy = ty - p.y;
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) { p.x = tx; p.y = ty; }
      else { var f = Math.min(1, dt * 8); p.x += dx * f; p.y += dy * f; }
      p.moving = Math.abs(p.vx) + Math.abs(p.vy) > 0.1 || Math.abs(dx) + Math.abs(dy) > 0.05;
      var sdx = (p.vx - p.vy) || (dx - dy); if (Math.abs(sdx) > 0.01) p.dir = sdx < 0 ? -1 : 1;
    });

    // bot & Rektor (posisi dari jam)
    var t = nowSec();
    bots.concat([rektor]).forEach(function (b) {
      var s = World.botState(b, t);
      b.x = s.x; b.y = s.y; b.moving = s.moving;
      if (s.moving && Math.abs(s.dx - s.dy) > 0.01) b.dir = (s.dx - s.dy) < 0 ? -1 : 1;
      var c = World.botChat(b, t);
      if (c && c.key !== b.lastChatKey) {
        if (b.lastChatKey !== null && (!b.npc || !realRektorOnline())) pushChat(b.name, c.text, Date.now(), b.jurusan);
        b.lastChatKey = c.key;
      }
      b.chat = c && (!b.npc || !realRektorOnline()) ? { text: c.text, until: Date.now() + 1000 } : null;
    });
    if (net.mode === 'demo') stats.online = bots.length + 2;
  }
  function realRektorOnline() {
    if (me.profile && me.profile.role === 'rektor') return true;
    var found = false; peers.forEach(function (p) { if (p.meta && p.meta.role === 'rektor') found = true; });
    return found;
  }

  // ---------- render ----------
  var tileColor = new Array(N * N), roadDir = new Uint8Array(N * N), tileScreen = new Float32Array(N * N * 2);
  (function precompute() {
    var base = {};
    base[T.GRASS] = [136, 196, 104]; base[T.FOREST] = [104, 160, 86]; base[T.ROAD] = [84, 90, 98];
    base[T.WATER] = [74, 159, 216]; base[T.FIELD] = [96, 180, 84]; base[T.PAVE] = [214, 206, 190]; base[T.BANK] = [166, 201, 122];
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
      var i = y * N + x, t = world.tiles[i], c = base[t];
      var v = t === T.FIELD ? (((x + y) & 1) ? 6 : -6) : (World.hash2(x, y) - 0.5) * (t === T.ROAD || t === T.PAVE ? 6 : 14);
      tileColor[i] = 'rgb(' + ((c[0] + v) | 0) + ',' + ((c[1] + v) | 0) + ',' + ((c[2] + v * 0.6) | 0) + ')';
      var s = P(x, y); tileScreen[i * 2] = s[0]; tileScreen[i * 2 + 1] = s[1];
      if (t === T.ROAD) {
        var ex = world.tileAt(x - 1, y) === T.ROAD && world.tileAt(x + 1, y) === T.ROAD;
        var ey = world.tileAt(x, y - 1) === T.ROAD && world.tileAt(x, y + 1) === T.ROAD;
        var wideX = world.tileAt(x - 1, y) === T.ROAD || world.tileAt(x + 1, y) === T.ROAD;
        roadDir[i] = ex && !ey ? 1 : (ey && !ex && !(x === 35 || x === 36) ? 2 : 0);
        if (ey && (x === 35 || x === 36) && wideX) roadDir[i] = 0;
      }
    }
    world.objects.forEach(function (o) {
      var w = o.w || 0, h = o.h || 0;
      o.cx = o.x + w / 2; o.cy = o.y + h / 2; o.depth = o.cx + o.cy;
      var s = P(o.cx, o.cy); o.sx = s[0]; o.sy = s[1];
      o.isBox = o.type === 'building';
      o.seed = strHash(o.name || o.kind || '') + o.x * 7 + o.y;
    });
  })();

  function poly(pts, fill, stroke, lw) {
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke(); }
  }

  function drawTiles(vl, vr, vt, vb, now) {
    var waterShift = Math.sin(now / 700);
    for (var i = 0; i < N * N; i++) {
      var sx = tileScreen[i * 2], sy = tileScreen[i * 2 + 1];
      if (sx + HW < vl || sx - HW > vr || sy + 2 * HH < vt || sy > vb) continue;
      var t = world.tiles[i], col = tileColor[i];
      if (t === T.WATER) { var x = i % N, y = (i / N) | 0, w = Math.sin(now / 600 + x * 0.7 + y * 0.5); col = 'rgb(' + (70 + w * 8 | 0) + ',' + (155 + w * 10 | 0) + ',' + (214 + w * 6 | 0) + ')'; }
      ctx.beginPath();
      ctx.moveTo(sx, sy); ctx.lineTo(sx + HW, sy + HH); ctx.lineTo(sx, sy + 2 * HH); ctx.lineTo(sx - HW, sy + HH); ctx.closePath();
      ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 0.8; ctx.stroke();
      if (t === T.ROAD && roadDir[i]) {
        ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1.4; ctx.beginPath();
        if (roadDir[i] === 1) { ctx.moveTo(sx - 8, sy + HH - 4); ctx.lineTo(sx + 8, sy + HH + 4); }
        else { ctx.moveTo(sx + 8, sy + HH - 4); ctx.lineTo(sx - 8, sy + HH + 4); }
        ctx.stroke();
      } else if (t === T.PAVE && ((i * 13) % 7 === 0)) {
        ctx.strokeStyle = 'rgba(150,135,110,.25)'; ctx.lineWidth = 1; ctx.beginPath();
        ctx.moveTo(sx - 16, sy + HH); ctx.lineTo(sx, sy + HH + 8); ctx.stroke();
      } else if (t === T.WATER && ((i * 7) % 5 === 0)) {
        ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1; ctx.beginPath();
        ctx.moveTo(sx - 6 + waterShift * 4, sy + HH); ctx.lineTo(sx + 6 + waterShift * 4, sy + HH); ctx.stroke();
      }
    }
    // garis lapangan
    world.deco.forEach(function (d) {
      if (d.type === 'pitch') {
        ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 2;
        var a = P(d.x0, d.y0), b = P(d.x1, d.y0), c = P(d.x1, d.y1), e = P(d.x0, d.y1);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(e[0], e[1]); ctx.closePath(); ctx.stroke();
        var mx = (d.x0 + d.x1) / 2, m1 = P(mx, d.y0), m2 = P(mx, d.y1);
        ctx.beginPath(); ctx.moveTo(m1[0], m1[1]); ctx.lineTo(m2[0], m2[1]); ctx.stroke();
        var cc = P(mx, (d.y0 + d.y1) / 2); ctx.beginPath(); ctx.ellipse(cc[0], cc[1], 2 * HW * 0.9, 2 * HH * 0.9, 0, 0, Math.PI * 2); ctx.stroke();
      }
    });
  }

  var nightWindows = [];
  function drawBuilding(o, night) {
    var x = o.x, y = o.y, w = o.w, h = o.h, Hh = o.height || 16;
    var A = P(x, y, 0), B = P(x + w, y, 0), C = P(x + w, y + h, 0), D = P(x, y + h, 0);
    var At = P(x, y, Hh), Bt = P(x + w, y, Hh), Ct = P(x + w, y + h, Hh), Dt = P(x, y + h, Hh);
    var sh = Math.min(16, Hh * 0.2);
    poly([C, B, [B[0] + sh * 2, B[1] + sh], [C[0] + sh * 2, C[1] + sh]], 'rgba(0,0,0,.13)');
    poly([D, C, Ct, Dt], o.wall);
    poly([C, B, Bt, Ct], shade(o.wall, -0.18));
    function F(u, z) { return P(x + u * w, y + h, z); }
    function R(v, z) { return P(x + w, y + v * h, z); }

    if (o.kind !== 'stall' && o.kind !== 'stage') {
      var floors = Math.max(1, Math.round(Hh / 16)), fh = Hh / floors;
      var glassCol = o.glass ? '#5f9fd6' : '#87b8dc';
      var nF = Math.max(2, Math.round(w * 1.2)), nR = Math.max(1, Math.round(h * 1.2));
      for (var f = 0; f < floors; f++) {
        var z0 = f * fh + fh * 0.3, z1 = f * fh + fh * (o.glass ? 0.85 : 0.75);
        for (var k = 0; k < nF; k++) {
          var u0 = (k + (o.glass ? 0.08 : 0.22)) / nF, u1 = (k + (o.glass ? 0.92 : 0.78)) / nF;
          if (f === 0 && u1 > 0.42 && u0 < 0.58) continue; // pintu
          var lit = night && World.hash2(o.seed + k, f) > 0.35;
          var q = [F(u0, z0), F(u1, z0), F(u1, z1), F(u0, z1)];
          poly(q, lit ? '#ffd76a' : (night ? '#3a4660' : (o.punk ? '#ff5fb8' : glassCol)));
          if (lit) nightWindows.push(q);
        }
        for (var r = 0; r < nR; r++) {
          var v0 = (r + 0.25) / nR, v1 = (r + 0.75) / nR;
          var lit2 = night && World.hash2(o.seed + 50 + r, f) > 0.45;
          var q2 = [R(v0, z0), R(v1, z0), R(v1, z1), R(v0, z1)];
          poly(q2, lit2 ? '#e8c45c' : (night ? '#2f3a52' : shade(o.punk ? '#ff5fb8' : glassCol, -0.18)));
          if (lit2) nightWindows.push(q2);
        }
      }
      var dz = Math.min(15, fh * 0.85);
      poly([F(0.44, 0), F(0.56, 0), F(0.56, dz), F(0.44, dz)], o.kind === 'masjid' ? '#6d4c2f' : '#4f6f88');
      if (o.band) {
        poly([F(0, Hh - 5), F(1, Hh - 5), F(1, Hh), F(0, Hh)], o.band);
        poly([R(0, Hh - 5), R(1, Hh - 5), R(1, Hh), R(0, Hh)], shade(o.band, -0.2));
      }
      if (o.punk) { // grafiti
        var cols = ['#39ff14', '#00e5ff', '#ffea00', '#ff3ea5'];
        for (var g = 0; g < 4; g++) {
          ctx.strokeStyle = cols[g]; ctx.lineWidth = 2; ctx.beginPath();
          var gu = 0.06 + g * 0.24;
          for (var s = 0; s <= 6; s++) { var pt = F(gu + s * 0.025, 3 + (s % 2 ? 7 : 1)); if (s) ctx.lineTo(pt[0], pt[1]); else ctx.moveTo(pt[0], pt[1]); }
          ctx.stroke();
        }
      }
      if (o.kind === 'rs') { // palang merah
        var c0 = F(0.5, Hh - 14);
        ctx.fillStyle = '#d62f3a'; ctx.fillRect(c0[0] - 2.5, c0[1] - 8, 5, 14); ctx.fillRect(c0[0] - 7, c0[1] - 3, 14, 5);
      }
    }

    // atap
    var roof = o.roof;
    if (o.roofType === 'flat') {
      poly([At, Bt, Ct, Dt], shade(roof, 0.05));
      var e = 0.35;
      poly([P(x + e, y + e, Hh), P(x + w - e, y + e, Hh), P(x + w - e, y + h - e, Hh), P(x + e, y + h - e, Hh)], shade(roof, -0.12));
      if (o.kind === 'fakultas' || o.kind === 'perpus') { // AC/tangki di atap
        var ac = P(x + w * 0.7, y + h * 0.4, Hh);
        poly([[ac[0] - 6, ac[1]], [ac[0], ac[1] + 3], [ac[0] + 6, ac[1]], [ac[0] + 6, ac[1] - 6], [ac[0], ac[1] - 9], [ac[0] - 6, ac[1] - 6]], '#c9ced3', '#9aa1a8');
      }
      if (o.kind === 'stage') {
        ctx.strokeStyle = '#555'; ctx.lineWidth = 2;
        [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].forEach(function (c) { var a = P(c[0], c[1], Hh), b = P(c[0], c[1], Hh + 30); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); });
        var t1 = P(x, y + h, Hh + 30), t2 = P(x + w, y + h, Hh + 30), t3 = P(x + w, y, Hh + 30);
        ctx.beginPath(); ctx.moveTo(t1[0], t1[1]); ctx.lineTo(t2[0], t2[1]); ctx.lineTo(t3[0], t3[1]); ctx.stroke();
        var hue = (performance.now() / 20) % 360;
        ctx.fillStyle = 'hsla(' + hue + ',100%,60%,.85)'; ctx.beginPath(); ctx.arc(t1[0] + (t2[0] - t1[0]) * 0.3, t1[1] + (t2[1] - t1[1]) * 0.3 + 4, 3, 0, 7); ctx.fill();
        ctx.fillStyle = 'hsla(' + ((hue + 180) % 360) + ',100%,60%,.85)'; ctx.beginPath(); ctx.arc(t1[0] + (t2[0] - t1[0]) * 0.7, t1[1] + (t2[1] - t1[1]) * 0.7 + 4, 3, 0, 7); ctx.fill();
      }
    } else {
      var ee = 0.25, rh = Math.min(w, h) * (o.kind === 'stall' ? 5 : 8);
      var A2 = P(x - ee, y - ee, Hh), B2 = P(x + w + ee, y - ee, Hh), C2 = P(x + w + ee, y + h + ee, Hh), D2 = P(x - ee, y + h + ee, Hh);
      var rDark = shade(roof, -0.22), rBack = shade(roof, -0.1);
      if (w >= h) {
        var P1 = P(x + h / 2, y + h / 2, Hh + rh), P2 = P(x + w - h / 2, y + h / 2, Hh + rh);
        poly([A2, B2, P2, P1], rBack); poly([A2, D2, P1], rBack);
        poly([D2, C2, P2, P1], roof, rDark); poly([B2, C2, P2], rDark);
      } else {
        var Q1 = P(x + w / 2, y + w / 2, Hh + rh), Q2 = P(x + w / 2, y + h - w / 2, Hh + rh);
        poly([A2, D2, Q2, Q1], rBack); poly([A2, B2, Q1], rBack);
        poly([B2, C2, Q2, Q1], rDark); poly([D2, C2, Q2], roof, rDark);
      }
      if (o.kind === 'masjid') {
        var top = P(x + w / 2, y + h / 2, Hh + rh);
        ctx.fillStyle = '#d4af37'; ctx.beginPath(); ctx.arc(top[0], top[1] - 4, 9, Math.PI, 0); ctx.fill();
        ctx.strokeStyle = '#8a6d1d'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(top[0], top[1] - 13); ctx.lineTo(top[0], top[1] - 22); ctx.stroke();
      }
      if (o.kind === 'rektorat') {
        var tp = P(x + w / 2, y + h / 2, Hh + rh);
        ctx.strokeStyle = '#ddd'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(tp[0], tp[1]); ctx.lineTo(tp[0], tp[1] - 28); ctx.stroke();
        ctx.fillStyle = '#e02b2b'; ctx.fillRect(tp[0] + 1, tp[1] - 28, 14, 5); ctx.fillStyle = '#fff'; ctx.fillRect(tp[0] + 1, tp[1] - 23, 14, 5);
      }
    }
  }

  function drawTree(o) {
    var s = P(o.x, o.y), x = s[0], y = s[1], k = o.s || 1;
    ctx.fillStyle = 'rgba(0,0,0,.15)'; ctx.beginPath(); ctx.ellipse(x + 3, y, 10 * k, 4 * k, 0, 0, Math.PI * 2); ctx.fill();
    if (o.kind === 'pine') {
      ctx.fillStyle = '#6b4a2b'; ctx.fillRect(x - 1.5 * k, y - 8 * k, 3 * k, 8 * k);
      for (var i = 0; i < 3; i++) { var by = y - 6 * k - i * 9 * k, bw = (13 - i * 3) * k; poly([[x - bw, by], [x + bw, by], [x, by - 15 * k]], i % 2 ? '#2f6b3a' : '#367a42'); }
    } else if (o.kind === 'palm') {
      ctx.strokeStyle = '#8a6a43'; ctx.lineWidth = 2.5 * k; ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 4 * k, y - 14 * k, x + 2 * k, y - 28 * k); ctx.stroke();
      ctx.strokeStyle = '#3e9a4a'; ctx.lineCap = 'round';
      var tx = x + 2 * k, ty = y - 28 * k;
      [[-14, 4], [14, 4], [-10, -6], [10, -6], [0, -10], [-4, 8], [6, 8]].forEach(function (d) { ctx.beginPath(); ctx.moveTo(tx, ty); ctx.quadraticCurveTo(tx + d[0] * k * 0.6, ty + d[1] * k * 0.3 - 6 * k, tx + d[0] * k, ty + d[1] * k); ctx.stroke(); });
      ctx.lineCap = 'butt';
    } else {
      ctx.fillStyle = '#7a5434'; ctx.fillRect(x - 2 * k, y - 12 * k, 4 * k, 12 * k);
      ctx.fillStyle = '#3f8f3a'; ctx.beginPath(); ctx.arc(x, y - 20 * k, 11 * k, 0, 7); ctx.fill();
      ctx.fillStyle = '#56a84a'; ctx.beginPath(); ctx.arc(x - 3 * k, y - 23 * k, 7 * k, 0, 7); ctx.fill();
    }
  }

  function drawProp(o, now) {
    var s = P(o.x, o.y), x = s[0], y = s[1];
    switch (o.type) {
      case 'flag': {
        ctx.strokeStyle = '#ddd'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 54); ctx.stroke();
        var wv = Math.sin(now / 300) * 1.5;
        ctx.fillStyle = '#e02b2b'; ctx.fillRect(x + 1, y - 54, 20, 6 + wv * 0.2); ctx.fillStyle = '#fff'; ctx.fillRect(x + 1, y - 48 + wv * 0.2, 20, 6);
        break;
      }
      case 'fountain': {
        ctx.fillStyle = '#9fb3c2'; ctx.beginPath(); ctx.ellipse(x, y, 40, 20, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#5fa8dc'; ctx.beginPath(); ctx.ellipse(x, y - 2, 34, 16, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#c8d3db'; ctx.fillRect(x - 3, y - 22, 6, 20);
        ctx.strokeStyle = 'rgba(220,240,255,.9)'; ctx.lineWidth = 2;
        for (var i = 0; i < 6; i++) { var a = i / 6 * Math.PI * 2 + now / 900, ex = x + Math.cos(a) * 20, ey = y - 2 + Math.sin(a) * 9; ctx.beginPath(); ctx.moveTo(x, y - 22); ctx.quadraticCurveTo((x + ex) / 2, y - 40, ex, ey); ctx.stroke(); }
        break;
      }
      case 'dish': {
        ctx.fillStyle = '#888'; ctx.fillRect(x - 1.5, y - 22, 3, 22);
        ctx.fillStyle = '#eef1f4'; ctx.beginPath(); ctx.ellipse(x, y - 26, 11, 7, -0.5, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#9aa'; ctx.stroke();
        break;
      }
      case 'antenna': {
        ctx.strokeStyle = '#b33'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 6, y); ctx.lineTo(x, y - 60); ctx.lineTo(x + 6, y); ctx.stroke();
        ctx.strokeStyle = '#ddd'; ctx.lineWidth = 1; for (var j = 1; j < 6; j++) { ctx.beginPath(); ctx.moveTo(x - 6 + j, y - j * 10); ctx.lineTo(x + 6 - j, y - j * 10); ctx.stroke(); }
        if (Math.floor(now / 600) % 2) { ctx.fillStyle = '#ff3b3b'; ctx.beginPath(); ctx.arc(x, y - 61, 3, 0, 7); ctx.fill(); }
        break;
      }
      case 'cross': {
        ctx.fillStyle = '#666'; ctx.fillRect(x - 1.5, y - 20, 3, 20);
        ctx.fillStyle = '#fff'; ctx.fillRect(x - 10, y - 38, 20, 20);
        ctx.fillStyle = o.color || '#d62f3a'; ctx.fillRect(x - 2.5, y - 35, 5, 14); ctx.fillRect(x - 7, y - 30.5, 14, 5);
        break;
      }
      case 'ambulance': {
        poly([[x - 14, y - 2], [x + 4, y + 7], [x + 14, y + 2], [x - 4, y - 7]], 'rgba(0,0,0,.15)');
        poly([[x - 14, y - 4], [x + 4, y + 5], [x + 4, y - 9], [x - 14, y - 18]], '#fff', '#bbb');
        poly([[x + 4, y + 5], [x + 14, y], [x + 14, y - 14], [x + 4, y - 9]], '#e6e6e6', '#bbb');
        poly([[x - 14, y - 18], [x + 4, y - 9], [x + 14, y - 14], [x - 4, y - 23]], '#f4f4f4', '#bbb');
        ctx.fillStyle = '#d62f3a'; ctx.fillRect(x - 7, y - 12, 6, 2); ctx.fillRect(x - 5, y - 14, 2, 6);
        ctx.fillStyle = Math.floor(now / 300) % 2 ? '#ff3b3b' : '#3b7bff'; ctx.fillRect(x - 6, y - 25, 5, 3);
        break;
      }
      case 'speaker': {
        poly([[x - 6, y], [x + 6, y], [x + 6, y - 18], [x - 6, y - 18]], '#222', '#111');
        ctx.fillStyle = '#555'; ctx.beginPath(); ctx.arc(x, y - 6, 3.5, 0, 7); ctx.arc(x, y - 14, 2.5, 0, 7); ctx.fill();
        break;
      }
      case 'table': {
        ctx.fillStyle = '#8b5a2b'; ctx.beginPath(); ctx.ellipse(x, y - 8, 9, 4.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillRect(x - 1, y - 8, 2, 8);
        ctx.strokeStyle = '#666'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y - 8); ctx.lineTo(x, y - 28); ctx.stroke();
        ctx.fillStyle = o.color; ctx.beginPath(); ctx.moveTo(x - 15, y - 22); ctx.quadraticCurveTo(x, y - 36, x + 15, y - 22); ctx.closePath(); ctx.fill();
        break;
      }
      case 'bench': {
        poly([[x - 12, y - 6], [x + 4, y + 2], [x + 4, y - 2], [x - 12, y - 10]], '#a0703c', '#6d4c2f');
        break;
      }
      case 'goal': {
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
        var a1 = P(o.x, o.y - 1.5), b1 = P(o.x, o.y + 1.5);
        ctx.beginPath(); ctx.moveTo(a1[0], a1[1]); ctx.lineTo(a1[0], a1[1] - 16); ctx.lineTo(b1[0], b1[1] - 16); ctx.lineTo(b1[0], b1[1]); ctx.stroke();
        break;
      }
      case 'motor': {
        ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(x - 5, y - 3, 3, 0, 7); ctx.arc(x + 5, y + 1, 3, 0, 7); ctx.fill();
        poly([[x - 6, y - 6], [x + 5, y - 1], [x + 5, y - 7], [x - 3, y - 11]], o.color);
        break;
      }
      case 'lamp': {
        ctx.strokeStyle = '#555'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 34); ctx.stroke();
        var on = darkness(hourWIB()) > 0.15;
        ctx.fillStyle = on ? '#ffe9a0' : '#ddd'; ctx.beginPath(); ctx.arc(x, y - 36, 4, 0, 7); ctx.fill();
        if (on) lampGlows.push([x, y - 36]);
        break;
      }
      case 'gate': {
        var g1 = P(o.x, o.y), g2 = P(o.x2, o.y), gh = 46;
        [g1, g2].forEach(function (g) { poly([[g[0] - 5, g[1]], [g[0] + 5, g[1] + 3], [g[0] + 5, g[1] + 3 - gh], [g[0] - 5, g[1] - gh]], '#2f4a3a', '#1d3026'); });
        var b1x = P(o.x - 0.6, o.y, gh + 14), b2x = P(o.x2 + 0.6, o.y, gh + 14), b3x = P(o.x2 + 0.6, o.y, gh - 4), b4x = P(o.x - 0.6, o.y, gh - 4);
        poly([b1x, b2x, b3x, b4x], '#2f4a3a', '#ffd76a', 1.5);
        ctx.save();
        ctx.translate(b4x[0], b4x[1]);
        ctx.transform(1, 0.5, 0, 1, 0, 0);
        ctx.fillStyle = '#ffd76a'; ctx.font = '900 9px ' + fontFamily; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText('KAMPUS NETIZEN', 6, -9);
        ctx.restore();
        break;
      }
      case 'sign': {
        ctx.fillStyle = '#6d4c2f'; ctx.fillRect(x - 1.5, y - 16, 3, 16);
        poly([[x - 12, y - 26], [x + 12, y - 26], [x + 12, y - 15], [x - 12, y - 15]], '#2f63b8', '#1b3d75');
        break;
      }
    }
  }

  function drawPlayer(p, now, raining) {
    var s = P(p.x, p.y), x = s[0], y = s[1], L = p.look;
    var t = now / 90 + L.phase, bob = p.moving ? Math.abs(Math.sin(t)) * 2 : 0, step = p.moving ? Math.sin(t) * 2.5 : 0;
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(x, y, 7, 3.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2c3e50';
    ctx.fillRect(x - 3.5, y - 7 + Math.max(0, step), 3, 7 - Math.max(0, step));
    ctx.fillRect(x + 0.5, y - 7 + Math.max(0, -step), 3, 7 - Math.max(0, -step));
    ctx.fillStyle = L.shirt; roundRect(x - 5.5, y - 18 - bob, 11, 12, 3); ctx.fill();
    if (L.tie || L.toga) { ctx.fillStyle = L.toga ? '#c9a227' : '#fff'; ctx.fillRect(x - 0.8, y - 17 - bob, 1.6, 7); }
    ctx.fillStyle = L.skin; ctx.beginPath(); ctx.arc(x, y - 23 - bob, 5, 0, 7); ctx.fill();
    ctx.fillStyle = '#2b1d14'; ctx.beginPath(); ctx.arc(x, y - 24.5 - bob, 5, Math.PI * 1.05, Math.PI * 1.95); ctx.fill();
    ctx.fillStyle = '#222'; ctx.fillRect(x + p.dir * 2 - 0.6, y - 23.5 - bob, 1.3, 1.6);
    if (L.toga && !raining) { // topi toga Rektor
      poly([[x - 8, y - 28.5 - bob], [x, y - 25 - bob], [x + 8, y - 28.5 - bob], [x, y - 32 - bob]], '#111');
      ctx.strokeStyle = '#c9a227'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y - 28.5 - bob); ctx.lineTo(x + 6, y - 24 - bob); ctx.stroke();
    }
    if (raining) {
      var ux = x + p.dir * 3, uy = y - 33 - bob;
      ctx.strokeStyle = '#333'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(ux, uy); ctx.lineTo(ux, uy + 14); ctx.stroke();
      ctx.fillStyle = L.umb; ctx.beginPath(); ctx.arc(ux, uy + 1, 11, Math.PI, 0); ctx.closePath(); ctx.fill();
    }
    if (p.isMe) { ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(x, y, 9, 4.2, 0, 0, Math.PI * 2); ctx.stroke(); }
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }

  function cmp(a, b) {
    if (a.isPlayer && b.isBox) return playerVsBox(a, b);
    if (b.isPlayer && a.isBox) return -playerVsBox(b, a);
    return a.depth - b.depth;
  }
  function playerVsBox(p, o) {
    var nx = clamp(p.x, o.x, o.x + o.w), ny = clamp(p.y, o.y, o.y + o.h);
    return (p.x + p.y) - (nx + ny) || 1;
  }
  function darkness(h) {
    if (h >= 6.5 && h < 17) return 0;
    if (h >= 17 && h < 19) return (h - 17) / 2 * 0.5;
    if (h >= 5 && h < 6.5) return (6.5 - h) / 1.5 * 0.5;
    return 0.5;
  }

  var drops = [];
  for (var di = 0; di < 160; di++) drops.push({ x: Math.random(), y: Math.random(), l: 8 + Math.random() * 10, v: 0.8 + Math.random() * 0.6 });
  var lampGlows = [];
  var camX = 0, camY = 0, weather = 'CERAH', fontFamily = 'system-ui';

  function allPlayers() {
    var arr = [me];
    peers.forEach(function (p) { if (p.hasPos) arr.push(p); });
    bots.forEach(function (b) { arr.push(b); });
    if (!realRektorOnline()) arr.push(rektor);
    return arr;
  }

  function render(now, dt) {
    weather = World.weatherAt(Date.now());
    var raining = weather === 'HUJAN';
    var dk = darkness(hourWIB()), night = dk > 0.22;
    var tgt = P(me.x, me.y); camX = tgt[0] + camOff.x; camY = tgt[1] - 20 + camOff.y;
    var z = zoom;
    function worldTf() { ctx.setTransform(DPR * z, 0, 0, DPR * z, DPR * (W / 2 - camX * z), DPR * (H / 2 - camY * z)); }

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#68a054'; ctx.fillRect(0, 0, W, H);
    worldTf();
    var vl = camX - W / 2 / z - 40, vr = camX + W / 2 / z + 40, vt = camY - H / 2 / z - 40, vb = camY + H / 2 / z + 80;
    drawTiles(vl, vr, vt, vb, now);

    var list = [], objs = world.objects;
    for (var i = 0; i < objs.length; i++) {
      var o = objs[i];
      if (o.sx < vl - 260 || o.sx > vr + 260 || o.sy < vt - 40 || o.sy > vb + 160) continue;
      list.push(o);
    }
    var vis = [];
    allPlayers().forEach(function (p) {
      var s = P(p.x, p.y);
      if (s[0] < vl || s[0] > vr || s[1] < vt || s[1] > vb + 60) return;
      p.isPlayer = true; p.depth = p.x + p.y; list.push(p); vis.push(p);
    });
    list.sort(cmp);
    nightWindows.length = 0; lampGlows.length = 0;
    for (var j = 0; j < list.length; j++) {
      var d = list[j];
      if (d.isPlayer) drawPlayer(d, now, raining);
      else if (d.isBox) drawBuilding(d, night);
      else if (d.type === 'tree') drawTree(d);
      else drawProp(d, now);
    }

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    var h = hourWIB();
    if (h >= 16.5 && h < 18.5) { ctx.fillStyle = 'rgba(255,140,60,' + (0.12 * (1 - Math.abs(h - 17.5))) + ')'; ctx.fillRect(0, 0, W, H); }
    if (dk > 0) { ctx.fillStyle = 'rgba(14,22,58,' + dk + ')'; ctx.fillRect(0, 0, W, H); }
    if (weather !== 'CERAH') { ctx.fillStyle = raining ? 'rgba(60,70,85,.22)' : 'rgba(90,100,110,.1)'; ctx.fillRect(0, 0, W, H); }
    if (night) {
      worldTf();
      ctx.globalAlpha = 0.85; nightWindows.forEach(function (q) { poly(q, '#ffd76a'); }); ctx.globalAlpha = 1;
      lampGlows.forEach(function (g) {
        var gr = ctx.createRadialGradient(g[0], g[1], 0, g[0], g[1], 40);
        gr.addColorStop(0, 'rgba(255,225,140,.45)'); gr.addColorStop(1, 'rgba(255,225,140,0)');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(g[0], g[1], 40, 0, 7); ctx.fill();
      });
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
    if (raining) {
      ctx.strokeStyle = 'rgba(210,225,255,.55)'; ctx.lineWidth = 1.2; ctx.beginPath();
      for (var r = 0; r < drops.length; r++) {
        var dr = drops[r]; dr.y += dr.v * dt * 1.4; dr.x -= dr.v * dt * 0.25;
        if (dr.y > 1) { dr.y -= 1; dr.x = Math.random() * 1.1; }
        if (dr.x < 0) dr.x += 1.1;
        var px = dr.x * W, py = dr.y * H; ctx.moveTo(px, py); ctx.lineTo(px - dr.l * 0.25, py + dr.l);
      }
      ctx.stroke();
    }
    if (audio) audio.gain.gain.value = soundOn ? (raining ? 0.12 : 0.025) : 0;

    drawSigns(list, z);
    for (var n = 0; n < vis.length; n++) drawLabels(vis[n], z);
  }

  function toScreen(wx, wy) { return [(wx - camX) * zoom + W / 2, (wy - camY) * zoom + H / 2]; }
  function pill(text, cx, cy, opt) {
    ctx.font = '800 ' + (opt.size || 13) + 'px ' + fontFamily;
    var dot = opt.dot ? 12 : 0;
    var w = ctx.measureText(text).width + (opt.padX || 9) * 2 + dot, h = opt.h || 22;
    roundRect(cx - w / 2, cy - h / 2, w, h, h / 2);
    ctx.fillStyle = opt.bg; ctx.fill();
    ctx.lineWidth = opt.lw || 1.5; ctx.strokeStyle = opt.border; ctx.stroke();
    if (dot) { ctx.fillStyle = opt.dot; ctx.beginPath(); ctx.arc(cx - w / 2 + (opt.padX || 9) + 4, cy, 4.5, 0, 7); ctx.fill(); }
    ctx.fillStyle = opt.color || '#1f2a24'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, cx + dot / 2, cy + 0.5);
  }
  function drawSigns(list, z) {
    if (z < 0.5) return;
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (!o.name || o.isPlayer) continue;
      var top = o.isBox ? P(o.cx, o.cy, (o.height || 16) + (o.roofType === 'hip' ? Math.min(o.w, o.h) * 8 : 0) + (o.kind === 'stage' ? 34 : 12)) : P(o.x, o.y, 34);
      var s = toScreen(top[0], top[1]);
      var jc = o.jurusan ? JMAP[o.jurusan].color : (o.kind === 'rektorat' ? '#c9a227' : '#8a6240');
      pill(o.name, s[0], s[1], { bg: '#fff8e6', border: jc, size: o.kind === 'fakultas' || o.kind === 'rektorat' ? 12 : 11, h: 21, lw: 2.5, padX: 8 });
    }
  }
  function wrap(text, max) {
    var words = text.split(' '), lines = [], cur = '';
    for (var i = 0; i < words.length; i++) {
      var t = cur ? cur + ' ' + words[i] : words[i];
      if (t.length > max && cur) { lines.push(cur); cur = words[i]; } else cur = t;
    }
    if (cur) lines.push(cur);
    if (lines.length > 2) { lines = lines.slice(0, 2); lines[1] = lines[1].slice(0, max - 1) + '…'; }
    return lines.map(function (l) { return l.length > max + 6 ? l.slice(0, max + 5) + '…' : l; });
  }
  function labelStyle(p) {
    var m = p.meta;
    if (m && m.role === 'rektor') return { bg: '#2d1b5e', border: '#ffd76a', color: '#ffd76a', size: 13, lw: 2 };
    var j = m && JMAP[m.jurusan];
    if (m && (m.is_dekan || m.role === 'dekan')) return { bg: shade(j.color, 0.78), border: j.color, color: shade(j.color, -0.55), size: 12, lw: 2 };
    if (j) return { bg: '#fff', border: p.isMe ? '#2f4a3a' : '#5a5a5a', lw: p.isMe ? 2.5 : 1.5, size: 13, dot: j.color };
    return { bg: '#fff', border: p.isMe ? '#2f4a3a' : '#8a8a8a', lw: p.isMe ? 2.5 : 1.5, size: 13, color: '#444' };
  }
  function drawLabels(p, z) {
    var lift = weather === 'HUJAN' ? 48 : (p.look.toga ? 40 : 34);
    var s = P(p.x, p.y, lift), sc = toScreen(s[0], s[1]), x = sc[0], y = sc[1] - 6;
    if (z >= 0.45 || p.isMe) pill(p.label || '…', x, y, labelStyle(p));
    if (p.chat && p.chat.until > Date.now()) {
      var lines = wrap(p.chat.text, 24);
      ctx.font = '700 13px ' + fontFamily;
      var w = 0; lines.forEach(function (l) { w = Math.max(w, ctx.measureText(l).width); });
      w += 20; var h = lines.length * 17 + 12, bx = x - w / 2, by = y - 16 - h;
      roundRect(bx, by, w, h, 12); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#2b2b2b'; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 6, by + h - 1); ctx.lineTo(x, by + h + 7); ctx.lineTo(x + 6, by + h - 1); ctx.closePath(); ctx.fillStyle = '#fff'; ctx.fill();
      ctx.beginPath(); ctx.moveTo(x - 6, by + h); ctx.lineTo(x, by + h + 7); ctx.lineTo(x + 6, by + h); ctx.stroke();
      ctx.fillStyle = '#1f2a24'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      lines.forEach(function (l, i) { ctx.fillText(l, x, by + 14 + i * 17); });
    }
  }

  // ---------- HUD ----------
  function phaseName(h) { return h >= 4 && h < 10 ? 'PAGI' : h >= 10 && h < 15 ? 'SIANG' : h >= 15 && h < 18 ? 'SORE' : 'MALAM'; }
  var WX_ICON = { CERAH: '☀️', BERAWAN: '⛅', HUJAN: '🌧️' };
  function hud() {
    var fd = fmtDate(); if (W < 430) fd = fd.replace(/ \d{4}$/, '');
    $('datetime').textContent = fd + ' · ' + fmtTime();
    var w = World.weatherAt(Date.now());
    var ph = phaseName(hourWIB()); $('phase').textContent = ph + ' · ' + (ph === 'MALAM' && w === 'CERAH' ? '🌙' : WX_ICON[w]) + ' ' + w;
    $('onlineTxt').textContent = stats.online + (W < 430 ? ' online' : ' mahasiswa online');
    $('wargaNum').textContent = Number(stats.mahasiswa).toLocaleString('id-ID');
    $('wargaUpd').textContent = 'diperbarui ' + fmtDate(stats.updated).slice(5) + ' · ' + fmtTime(stats.updated);
  }
  setInterval(hud, 1000);
  var toastTimer = null;
  function toast(t) {
    var e = $('toast'); e.textContent = t; e.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { e.classList.remove('show'); }, 3600);
  }

  // ---------- panel ----------
  var currentTab = null, sheet = $('sheet'), body = $('sheetBody');
  var TITLES = { info: 'Info Kampus', ktm: 'Kartu Tanda Mahasiswa', jurusan: 'Jurusan', kantin: 'Kantin Kampus', akun: 'Akun', chat: 'Obrolan Kampus', dekat: 'Mahasiswa di Dekatmu' };
  function openPanel(tab) {
    currentTab = tab;
    $('sheetTitle').textContent = TITLES[tab] || '';
    sheet.classList.add('open');
    document.querySelectorAll('#nav button').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === tab); });
    if (!document.querySelector('#nav button.active')) document.querySelector('#nav button[data-tab="peta"]').classList.add('active');
    if (tab === 'info') $('infoDot').style.display = 'none';
    refreshPanel();
    if (tab === 'chat') setTimeout(function () { var i = $('chatInput'); if (i) i.focus(); }, 260);
  }
  function closePanel() {
    currentTab = null; sheet.classList.remove('open');
    document.querySelectorAll('#nav button').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === 'peta'); });
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }
  $('sheetClose').onclick = closePanel;
  document.querySelectorAll('#nav button').forEach(function (b) {
    b.onclick = function () { if (b.dataset.tab === 'peta') closePanel(); else openPanel(b.dataset.tab); };
  });
  var keepForm = null; // simpan isian form KTM saat panel di-refresh
  function refreshPanel() {
    if (!currentTab) return;
    if (currentTab === 'chat' && $('chatLog')) { renderChatLog(); return; }
    body.innerHTML = '';
    var f = PANELS[currentTab]; if (f) f(body);
  }
  function renderChatLog() {
    var log = $('chatLog'); if (!log) return;
    log.innerHTML = '';
    if (!chatLog.length) log.appendChild(el('p', { cls: 'muted', text: 'Belum ada obrolan. Sapa yang lain duluan!' }));
    chatLog.forEach(function (c) {
      var j = c.jurusan && JMAP[c.jurusan];
      log.appendChild(el('div', { cls: 'msg' }, [j ? el('span', { cls: 'jdot', style: 'background:' + j.color }) : null, el('b', { text: c.name }), c.text, el('span', { cls: 'meta', text: '  ' + fmtTime(c.at) })]));
    });
    log.scrollTop = log.scrollHeight;
  }
  function busy(btn, on, text) { btn.disabled = on; if (text) btn.textContent = text; btn.style.opacity = on ? 0.6 : 1; }
  var GOOGLE_SVG = '<svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
  function googleBtn(text, onclick) { var b = el('button', { cls: 'btn google', onclick: onclick }); b.innerHTML = GOOGLE_SVG; b.appendChild(document.createTextNode(text)); return b; }
  function needGoogle() { return net.mode === 'online' && CFG.WAJIB_GOOGLE_UNTUK_KTM && me.isAnon; }
  function googleOn() { return net.mode === 'online' && CFG.LOGIN_GOOGLE !== false && me.isAnon; }

  var PANELS = {
    info: function (b) {
      if (me.profile && me.profile.role === 'rektor') {
        var ju = el('input', { type: 'text', maxlength: '80', placeholder: 'Judul pengumuman' });
        var isi = el('textarea', { maxlength: '500', placeholder: 'Isi pengumuman untuk seluruh kampus…' });
        var bt = el('button', { cls: 'btn', text: 'Umumkan 📣' });
        bt.onclick = function () {
          if (!ju.value.trim() || !isi.value.trim()) { toast('Isi judul dan isinya'); return; }
          busy(bt, true); net.postPengumuman(ju.value.trim(), isi.value.trim()).then(function () { toast('Pengumuman terkirim'); }).catch(function (e) { toast(Net.errMsg(e)); }).then(function () { busy(bt, false); });
        };
        b.appendChild(el('div', { cls: 'item' }, [el('h3', { text: '👑 Pengumuman Rektor' }), el('div', { style: 'display:grid;gap:8px;margin-top:6px' }, [ju, isi, bt])]));
      }
      pengumuman.forEach(function (a) { b.appendChild(el('div', { cls: 'item' }, [el('h3', { text: a.judul }), el('p', { text: a.isi }), el('div', { cls: 'meta', text: fmtDate(a.at) })])); });
      b.appendChild(el('div', { cls: 'item' }, [el('h3', { text: 'Cara main' }),
        el('p', { text: 'Geser joystick "Gerak" (atau panah/WASD) untuk jalan. Seret peta untuk melihat-lihat. Tekan CHAT untuk ngobrol. Bikin KTM untuk masuk jurusan — mahasiswa pertama tiap jurusan jadi Dekan.' })]));
    },
    ktm: function (b) {
      if (!me.profile) {
        var form = keepForm || (keepForm = { nama: '', jurusan: null });
        b.appendChild(el('p', { cls: 'muted', text: 'Pilih jurusanmu. Mahasiswa pertama di sebuah jurusan otomatis jadi Dekan.' }));
        var inp = el('input', { type: 'text', maxlength: '20', placeholder: 'Nama panggilan', autocomplete: 'off', value: form.nama });
        inp.addEventListener('input', function () { form.nama = inp.value; });
        b.appendChild(inp);
        var grid = el('div', { cls: 'jgrid' });
        World.JURUSAN.forEach(function (j) {
          var btn = el('button', { cls: 'jbtn' + (form.jurusan === j.id ? ' sel' : ''), style: '--jc:' + j.color, type: 'button' }, [el('span', { cls: 'e', text: j.emoji }), el('span', {}, [j.nama, el('small', { text: j.fak })])]);
          btn.onclick = function () { form.jurusan = j.id; grid.querySelectorAll('.jbtn').forEach(function (x) { x.classList.remove('sel'); }); btn.classList.add('sel'); };
          grid.appendChild(btn);
        });
        b.appendChild(grid);
        function submit(btn) {
          if (form.nama.trim().length < 2) { toast('Nama minimal 2 huruf'); return; }
          if (!form.jurusan) { toast('Pilih jurusan dulu'); return; }
          busy(btn, true);
          net.daftarKTM(form.nama.trim(), form.jurusan).then(function (p) { if (p) keepForm = null; })
            .catch(function (e) { toast(Net.errMsg(e)); }).then(function () { busy(btn, false); });
        }
        var go = needGoogle() ? googleBtn('Bikin KTM dengan Google', function () { submit(go); }) : el('button', { cls: 'btn wide', text: 'Bikin KTM 🎓', onclick: function () { submit(go); } });
        b.appendChild(go);
        if (needGoogle()) b.appendChild(el('p', { cls: 'muted', style: 'margin-top:8px', text: 'Akun Google menjaga KTM-mu tetap aman walau ganti HP. Sebelum itu kamu tetap bisa jalan-jalan sebagai tamu.' }));
        if (net.mode === 'online' && !googleOn()) b.appendChild(el('p', { cls: 'muted', style: 'margin-top:8px', text: 'KTM tersimpan di browser ini. Jangan hapus data browser supaya KTM-mu tidak hilang.' }));
        if (googleOn()) {
          b.appendChild(el('div', { cls: 'divider', text: '— sudah punya KTM? —' }));
          b.appendChild(googleBtn('Masuk dengan Google', function () { net.loginGoogle().catch(function (e) { toast(Net.errMsg(e)); }); }));
        }
        if (net.mode === 'demo') b.appendChild(el('p', { cls: 'muted', style: 'margin-top:8px', text: 'Mode demo: KTM disimpan di browser ini saja. Login Google aktif setelah Supabase dipasang.' }));
        return;
      }
      var p = me.profile, j = JMAP[p.jurusan];
      var status = p.role === 'rektor' ? '👑 Rektor' : (p.is_dekan ? 'Dekan ' + j.nama : 'Mahasiswa aktif');
      b.appendChild(el('div', { cls: 'ktm', style: '--jc:' + (p.role === 'rektor' ? '#3b2a7a' : j.color) }, [
        el('div', { cls: 'bar' }),
        el('div', { cls: 't', text: 'KARTU TANDA MAHASISWA' }),
        el('div', { cls: 'u', text: '🎓 KAMPUS NETIZEN' }),
        el('div', { cls: 'photo', text: j.emoji }),
        el('table', {}, [tr('NIM', p.nim), tr('Nama', p.nama), tr('Jurusan', j.nama), tr('Fakultas', j.fak), tr('Angkatan', p.angkatan || new Date(p.created_at).getFullYear()), tr('Status', status)])
      ]));
      b.appendChild(el('div', { cls: 'row', style: 'margin-top:12px' }, [el('button', { cls: 'btn', text: j.emoji + ' Ke fakultas', onclick: function () { goFakultas(); closePanel(); } })]));
      function tr(k, v) { return el('tr', {}, [el('td', { text: k }), el('td', { text: String(v) })]); }
    },
    jurusan: function (b) {
      var holder = el('div', {}, [el('p', { cls: 'muted', text: 'Memuat data jurusan…' })]);
      if (me.profile) {
        var j = JMAP[me.profile.jurusan], teman = [];
        peers.forEach(function (p) { if (p.hasPos && p.jurusan === j.id) teman.push(p); });
        bots.forEach(function (p) { if (p.jurusan === j.id) teman.push(p); });
        b.appendChild(el('div', { cls: 'item' }, [el('h3', {}, [el('span', { cls: 'jdot', style: 'background:' + j.color }), j.emoji + ' ' + j.nama]),
          el('p', { text: j.fak + ' · ' + teman.length + ' teman sejurusan sedang di kampus.' })]));
        teman.slice(0, 20).forEach(function (o) {
          b.appendChild(el('div', { cls: 'item row' }, [el('div', {}, [el('h3', { text: o.label }), el('div', { cls: 'meta', text: jarak(o) })]),
            el('button', { cls: 'btn small alt', text: 'Sapa', onclick: function () { sendChat('Halo ' + o.name + ' 👋'); closePanel(); } })]));
        });
      } else {
        b.appendChild(el('div', { cls: 'item' }, [el('h3', { text: 'Belum punya jurusan' }), el('p', { text: 'Bikin KTM untuk masuk jurusan.' })]));
        b.appendChild(el('button', { cls: 'btn wide', text: 'Bikin KTM', onclick: function () { openPanel('ktm'); } }));
      }
      b.appendChild(el('h3', { text: 'Semua jurusan', style: 'margin:16px 0 6px;font-size:15px' }));
      b.appendChild(holder);
      net.statJurusan().then(function (rows) {
        var map = {}; (rows || []).forEach(function (r) { map[r.jurusan] = r; });
        holder.innerHTML = '';
        World.JURUSAN.forEach(function (jj) {
          var r = map[jj.id] || { jumlah: 0, dekan: null };
          holder.appendChild(el('div', { cls: 'item' }, [el('h3', {}, [el('span', { cls: 'jdot', style: 'background:' + jj.color }), jj.emoji + ' ' + jj.nama]),
            el('div', { cls: 'meta', text: Number(r.jumlah).toLocaleString('id-ID') + ' mahasiswa · Dekan: ' + (r.dekan || 'belum ada — daftar sekarang!') })]));
        });
      }).catch(function (e) { holder.innerHTML = ''; holder.appendChild(el('p', { cls: 'muted', text: Net.errMsg(e) })); });
    },
    kantin: function (b) {
      if (me.profile) {
        var it = el('input', { type: 'text', maxlength: '60', placeholder: 'Mau jual apa?' });
        var pr = el('input', { type: 'number', min: '0', placeholder: 'Harga (Rp)', inputmode: 'numeric' });
        var bt = el('button', { cls: 'btn', text: 'Pajang' });
        bt.onclick = function () {
          var barang = it.value.trim(), harga = Math.max(0, Math.min(1e9, parseInt(pr.value, 10) || 0));
          if (!barang) { toast('Isi nama barangnya'); return; }
          busy(bt, true);
          net.jual(barang, harga).then(function () { toast('Barang dipajang di Kantin 🍜'); }).catch(function (e) { toast(Net.errMsg(e)); }).then(function () { busy(bt, false); });
        };
        b.appendChild(el('div', { cls: 'item' }, [el('h3', { text: 'Jualan' }), el('div', { style: 'display:grid;gap:8px;margin-top:6px' }, [it, el('div', { cls: 'row' }, [pr, bt])])]));
      } else b.appendChild(el('p', { cls: 'muted', text: 'Bikin KTM dulu untuk bisa jualan. Lihat-lihat boleh kok.' }));
      if (!kantin.length) b.appendChild(el('p', { cls: 'muted', text: 'Belum ada jualan. Jadilah yang pertama!' }));
      kantin.forEach(function (m) {
        var j = m.jurusan && JMAP[m.jurusan];
        var act = m.mine
          ? el('button', { cls: 'btn small alt', text: 'Hapus', onclick: function () { net.hapusJualan(m.id).catch(function (e) { toast(Net.errMsg(e)); }); } })
          : el('button', { cls: 'btn small alt', text: 'Tanya', onclick: function () { sendChat('@' + m.seller + ' ' + m.barang + ' masih ada?'); closePanel(); } });
        b.appendChild(el('div', { cls: 'item row' }, [
          el('div', {}, [el('h3', { text: m.barang }), el('div', { cls: 'meta' }, [j ? el('span', { cls: 'jdot', style: 'background:' + j.color }) : null, rupiah(m.harga) + ' · ' + m.seller + ' · ' + fmtDate(m.at)])]),
          act
        ]));
      });
    },
    akun: function (b) {
      var status = net.mode === 'demo' ? 'Mode demo (offline) — mahasiswa lain adalah bot' : (me.isAnon ? 'Terhubung ke kampus' : 'Masuk dengan Google' + (me.email ? ' (' + me.email + ')' : ''));
      b.appendChild(el('div', { cls: 'item' }, [el('h3', { text: me.label }), el('p', { text: me.profile ? (JMAP[me.profile.jurusan].nama + ' · NIM ' + me.profile.nim) : 'Belum punya KTM' }), el('div', { cls: 'meta', text: status })]));
      if (googleOn()) b.appendChild(googleBtn('Masuk dengan Google', function () { net.loginGoogle().catch(function (e) { toast(Net.errMsg(e)); }); }));
      b.appendChild(el('div', { cls: 'row', style: 'margin:10px 0' }, [el('button', { cls: 'btn alt', text: soundOn ? '🔊 Suara: nyala' : '🔇 Suara: mati', onclick: function () { $('soundBtn').click(); refreshPanel(); } })]));
      if (net.mode === 'online' && me.isAnon && me.profile) b.appendChild(el('p', { cls: 'muted', text: 'KTM-mu tersimpan di browser ini. Kalau data browser dihapus atau ganti HP, KTM tidak bisa dikembalikan.' }));
      if ((me.profile || !me.isAnon) && !(net.mode === 'online' && me.isAnon)) {
        var out = el('button', { cls: 'btn alt wide', text: 'Keluar' });
        var armed = 0;
        out.onclick = function () {
          if (Date.now() - armed > 4000) { armed = Date.now(); toast(net.mode === 'demo' ? 'Tekan lagi: KTM demo di browser ini akan dihapus' : 'Tekan sekali lagi untuk keluar'); return; }
          net.logout();
        };
        b.appendChild(out);
      }
      b.appendChild(el('p', { cls: 'muted', style: 'margin-top:14px' }, ['Kampus Netizen · kampus virtual. ', el('a', { href: 'privasi.html', target: '_blank', text: 'Kebijakan Privasi' })]));
    },
    chat: function (b) {
      b.appendChild(el('div', { id: 'chatLog' }));
      var inp = el('input', { type: 'text', id: 'chatInput', maxlength: '120', placeholder: 'Ketik pesan…', autocomplete: 'off', enterkeyhint: 'send' });
      function go() { sendChat(inp.value); inp.value = ''; }
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); go(); } });
      b.appendChild(el('div', { cls: 'row', style: 'margin-top:10px' }, [inp, el('button', { cls: 'btn small', text: 'Kirim', onclick: go })]));
      renderChatLog();
    },
    dekat: function (b) {
      var arr = [];
      allPlayers().forEach(function (p) { if (p === me) return; var d = Math.hypot(p.x - me.x, p.y - me.y); if (d < 20) arr.push([d, p]); });
      arr.sort(function (a, c) { return a[0] - c[0]; });
      if (!arr.length) b.appendChild(el('p', { cls: 'muted', text: 'Sepi… belum ada yang di sekitarmu.' }));
      arr.slice(0, 30).forEach(function (a) {
        var p = a[1], j = p.jurusan && JMAP[p.jurusan];
        b.appendChild(el('div', { cls: 'item row' }, [el('div', {}, [el('h3', {}, [j ? el('span', { cls: 'jdot', style: 'background:' + j.color }) : null, p.label]), el('div', { cls: 'meta', text: (j ? j.nama + ' · ' : '') + jarak(p) })]),
          el('button', { cls: 'btn small alt', text: 'Sapa', onclick: function () { sendChat('Halo ' + p.name + ' 👋'); closePanel(); } })]));
      });
    }
  };
  function jarak(p) { return '± ' + Math.round(Math.hypot(p.x - me.x, p.y - me.y) * 5) + ' m dari kamu'; }

  // ---------- mulai ----------
  var last = performance.now();
  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000); last = now;
    update(dt, now);
    render(now, dt);
    requestAnimationFrame(frame);
  }
  fontFamily = getComputedStyle(document.body).fontFamily;
  hud();
  net.start().catch(function (e) { console.error(e); toast('Gagal terhubung: ' + Net.errMsg(e)); });
  requestAnimationFrame(frame);

  window.KN = { world: world, me: me, peers: peers, bots: bots, openPanel: openPanel, setZoom: setZoom, net: net, sendChat: sendChat };
})();
