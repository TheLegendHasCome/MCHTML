/* MCHTML v2.0 — ui.js
   Screens (title / worlds / create / pause / settings / how-to / mp / death),
   HUD (hearts, air, hotbar, debug, toasts), inventory + crafting + furnace
   overlays with cursor-stack logic, touch controls, worlds management. */
window.MCH = window.MCH || {};
(function(){
const M = MCH;
const $ = (id) => document.getElementById(id);

/* ---------- state ---------- */
let cursor = null;                 // held stack {id, count}
let invOpen = false, craftOpen = false, furnOpen = null, furnInterval = null;
const invCraft = [null, null, null, null];      // 2×2 (inventory)
const tableCraft = [null, null, null, null, null, null, null, null, null]; // 3×3
let touchMode = 'mine';
let lastMX = 0, lastMY = 0;

/* ---------- icon cache ---------- */
const iconCache = new Map();
function iconURL(id){
  let u = iconCache.get(id);
  if (u) return u;
  let c;
  if (typeof id === 'number'){
    const inf = M.BINFO[id];
    c = document.createElement('canvas'); c.width = 16; c.height = 16;
    const g = c.getContext('2d');
    const atlas = M.buildAtlas();
    const tname = (inf && inf.t) || 'stone';
    const i = M.TILE_INDEX[tname] || 0;
    g.drawImage(atlas, (i % 16)*16, ((i/16)|0)*16, 16, 16, 0, 0, 16, 16);
  } else {
    c = M.itemIconCanvas(id);
  }
  u = c.toDataURL();
  iconCache.set(id, u);
  return u;
}
const slotHTML = (s) => (!s) ? '' :
  `<img src="${iconURL(s.id)}" draggable="false" alt="">` +
  `<span class="cnt">${s.count > 1 ? s.count : ''}</span>`;

/* ---------- slot primitives ---------- */
function mkSlot(cls){
  const d = document.createElement('div');
  d.className = 'slot' + (cls ? ' ' + cls : '');
  d.addEventListener('contextmenu', e => e.preventDefault());
  return d;
}
function renderSlots(container, get, count, onPick){
  container.innerHTML = '';
  for (let i=0;i<count;i++){
    const d = mkSlot();
    const s = get(i);
    d.innerHTML = slotHTML(s);
    if (s) d.title = M.itemName(s.id);
    d.addEventListener('mousedown', (e) => { e.preventDefault(); onPick(i, e); });
    container.appendChild(d);
  }
}
function decCursor(){ cursor.count--; if (cursor.count <= 0) cursor = null; }

/* generic array slot click (inventory, craft grids) */
function arrSlotClick(arr, i, ev){
  const s = arr[i];
  if (ev.button === 2){
    if (cursor){
      if (!s){ arr[i] = { id: cursor.id, count: 1 }; decCursor(); }
      else if (s.id === cursor.id && s.count < M.stackMax(s.id)){ s.count++; decCursor(); }
    } else if (s){
      const half = Math.ceil(s.count / 2);
      cursor = { id: s.id, count: half };
      s.count -= half;
      if (s.count <= 0) arr[i] = null;
    }
  } else {
    if (cursor && s && s.id === cursor.id){
      const max = M.stackMax(s.id);
      const mv = Math.min(cursor.count, max - s.count);
      if (mv > 0){ s.count += mv; cursor.count -= mv; if (cursor.count <= 0) cursor = null; }
      else { arr[i] = cursor; cursor = s; }
    } else { arr[i] = cursor || null; cursor = s || null; }
  }
  M.game.sfx('click');
  afterInvChange();
}
/* take-only slots were folded into furnOutClick */
/* furnace input/fuel slots with fuel validation on the fuel slot */
function furnSlotClick(st, field, ev, mustFuel){
  const cur = st[field];
  const ok = (s) => !mustFuel || M.game.fuelValue(s.id) > 0;
  if (ev.button === 2){
    if (cursor && ok(cursor)){
      if (!cur){ st[field] = { id: cursor.id, count: 1 }; decCursor(); }
      else if (cur.id === cursor.id && cur.count < M.stackMax(cur.id)){ cur.count++; decCursor(); }
    } else if (cur){
      const half = Math.ceil(cur.count / 2);
      cursor = { id: cur.id, count: half };
      cur.count -= half;
      if (cur.count <= 0) st[field] = null;
    }
  } else {
    if (cursor && ok(cursor) && cur && cur.id === cursor.id){
      const max = M.stackMax(cur.id);
      const mv = Math.min(cursor.count, max - cur.count);
      if (mv > 0){ cur.count += mv; cursor.count -= mv; if (cursor.count <= 0) cursor = null; }
    } else if ((!cursor || ok(cursor)) && cur){
      st[field] = cursor; cursor = cur;
    } else if (!cursor || ok(cursor)){
      st[field] = cursor; cursor = cur || null;
    }
  }
  M.game.sfx('click');
  afterInvChange();
}
/* craft result: take the output, consume 1 from each filled cell */
function takeCraftResult(cells, size){
  const out = M.matchRecipe(cells, size);
  if (!out) return;
  const [id, n] = out;
  if (cursor && (cursor.id !== id || cursor.count + n > M.stackMax(id))) return;
  if (cursor) cursor.count += n; else cursor = { id, count: n };
  for (let i=0;i<cells.length;i++){
    const s = cells[i];
    if (s){ s.count--; if (s.count <= 0) cells[i] = null; }
  }
  M.game.sfx('craft');
  afterInvChange();
}

/* ---------- cursor stack ---------- */
function renderCursor(x, y){
  const c = $('cursorItem');
  if (!cursor){ c.classList.add('hidden'); return; }
  c.classList.remove('hidden');
  c.innerHTML = slotHTML(cursor);
  if (x != null){ c.style.left = (x - 22) + 'px'; c.style.top = (y - 22) + 'px'; }
}
document.addEventListener('mousemove', (e) => {
  lastMX = e.clientX; lastMY = e.clientY;
  if (cursor) renderCursor(e.clientX, e.clientY);
});
function afterInvChange(){
  renderCursor(lastMX, lastMY);
  hudHotbar();
  if (invOpen) renderInv();
  if (craftOpen) renderCraft();
  if (furnOpen) renderFurnace();
}

/* ---------- overlay: inventory ---------- */
function renderInv(){
  const inv = M.game.inv;
  const creative = M.game.worldMeta && M.game.worldMeta.mode === 'creative';
  const top = $('invTop');
  top.innerHTML = '';
  if (creative){
    const pal = document.createElement('div');
    pal.className = 'palGrid';
    M.CREATIVE_PALETTE.forEach((id) => {
      const d = mkSlot('pal');
      d.innerHTML = slotHTML({ id, count: 1 });
      d.title = M.itemName(id);
      d.addEventListener('mousedown', (e) => {
        e.preventDefault();
        cursor = { id, count: M.stackMax(id) };
        M.game.sfx('click');
        afterInvChange();
      });
      pal.appendChild(d);
    });
    const clear = mkSlot('pal void');
    clear.innerHTML = '<span class="xmark">✕</span>';
    clear.title = 'clear held stack';
    clear.addEventListener('mousedown', (e) => { e.preventDefault(); cursor = null; afterInvChange(); });
    pal.appendChild(clear);
    top.appendChild(pal);
  } else {
    const wrap = document.createElement('div');
    wrap.className = 'craftRow';
    const grid = document.createElement('div');
    grid.className = 'grid2';
    renderSlots(grid, (i) => invCraft[i], 4, (i, ev) => arrSlotClick(invCraft, i, ev));
    const arrow = document.createElement('div');
    arrow.className = 'arrow'; arrow.textContent = '➜';
    const res = mkSlot('result');
    const out = M.matchRecipe(invCraft, 2);
    res.innerHTML = out ? slotHTML({ id: out[0], count: out[1] }) : '';
    if (out) res.title = M.itemName(out[0]);
    res.addEventListener('mousedown', (e) => { e.preventDefault(); takeCraftResult(invCraft, 2); });
    wrap.append(grid, arrow, res);
    top.appendChild(wrap);
  }
  renderSlots($('invGrid'), (i) => inv[i + 9], 27, (i, ev) => arrSlotClick(inv, i + 9, ev));
  renderSlots($('invHotbar'), (i) => inv[i], 9, (i, ev) => arrSlotClick(inv, i, ev));
  renderCursor();
}

/* ---------- overlay: 3×3 crafting table ---------- */
function renderCraft(){
  const inv = M.game.inv;
  const grid = $('craftGrid3');
  renderSlots(grid, (i) => tableCraft[i], 9, (i, ev) => arrSlotClick(tableCraft, i, ev));
  const res = $('craftResult3');
  const out = M.matchRecipe(tableCraft, 3);
  res.innerHTML = out ? slotHTML({ id: out[0], count: out[1] }) : '';
  if (out) res.title = M.itemName(out[0]);
  renderSlots($('craftInvGrid'), (i) => inv[i + 9], 27, (i, ev) => arrSlotClick(inv, i + 9, ev));
  renderSlots($('craftHotbar'), (i) => inv[i], 9, (i, ev) => arrSlotClick(inv, i, ev));
  $('craftResult3').onmousedown = (e) => { e.preventDefault(); takeCraftResult(tableCraft, 3); };
  renderCursor();
}

/* ---------- overlay: furnace ---------- */
function renderFurnace(){
  if (!furnOpen) return;
  const inv = M.game.inv;
  const st = M.game.furnaces.get(furnOpen.k);
  if (!st){ closeOverlays(); return; }
  renderSlots($('furnIn'),  () => [st.i], 1, (i, ev) => furnSlotClick(st, 'i', ev, false));
  renderSlots($('furnFuel'),() => [st.f], 1, (i, ev) => furnSlotClick(st, 'f', ev, true));
  renderSlots($('furnOut'), () => [st.o], 1, (i, ev) => furnOutClick(st, ev));
  renderSlots($('furnInvGrid'), (i) => inv[i + 9], 27, (i, ev) => arrSlotClick(inv, i + 9, ev));
  renderSlots($('furnHotbar'), (i) => inv[i], 9, (i, ev) => arrSlotClick(inv, i, ev));
  updateFurnGauges(st);
  renderCursor();
}
/* furnace output is take-only */
function furnOutClick(st, ev){
  const s = st.o;
  if (!s) return;
  if (!cursor){ cursor = s; st.o = null; }
  else if (cursor.id === s.id){
    const mv = Math.min(s.count, M.stackMax(s.id) - cursor.count);
    cursor.count += mv; s.count -= mv;
    if (s.count <= 0) st.o = null;
  }
  M.game.sfx('pop');
  afterInvChange();
}
function updateFurnGauges(st){
  const flame = $('furnFlame'), arrow = $('furnArrowFill');
  if (st.maxBurn > 0) flame.style.height = Math.max(0, Math.min(100, st.burn / st.maxBurn * 100)) + '%';
  else flame.style.height = '0%';
  arrow.style.width = Math.max(0, Math.min(100, st.prog / 5 * 100)) + '%';
}
function furnPulse(){
  if (!furnOpen){ if (furnInterval){ clearInterval(furnInterval); furnInterval = null; } return; }
  const st = M.game.furnaces.get(furnOpen.k);
  if (!st){ closeOverlays(); return; }
  const o = $('furnOut');
  o.innerHTML = slotHTML(st.o);
  updateFurnGauges(st);
}

/* ---------- overlay open / close ---------- */
const overlayOpen = () => invOpen || craftOpen || !!furnOpen;
function closeOverlays(){
  if (!overlayOpen()) return;
  for (const cells of [invCraft, tableCraft]){
    for (let i=0;i<cells.length;i++){
      const s = cells[i];
      if (s){ M.game.addInv(s.id, s.count); cells[i] = null; }
    }
  }
  if (cursor){ M.game.addInv(cursor.id, cursor.count); cursor = null; }
  invOpen = craftOpen = false; furnOpen = null;
  if (furnInterval){ clearInterval(furnInterval); furnInterval = null; }
  $('invOverlay').classList.add('hidden');
  $('craftOverlay').classList.add('hidden');
  $('furnaceOverlay').classList.add('hidden');
  renderCursor();
  if (M.game.started && !M.game.paused && !M.game.isTouchActive()) M.game.lock();
}
function toggleInventory(){
  if (!M.game.started || M.game.player.dead) return;
  if (craftOpen || furnOpen){ closeOverlays(); return; }
  if (invOpen){ closeOverlays(); return; }
  invOpen = true;
  document.exitPointerLock && document.exitPointerLock();
  renderInv();
  $('invOverlay').classList.remove('hidden');
}
function openCraft(size){
  if (!M.game.started || M.game.player.dead) return;
  if (size === 2){ if (!invOpen) toggleInventory(); return; }
  if (invOpen){ closeOverlays(); }
  craftOpen = true;
  document.exitPointerLock && document.exitPointerLock();
  renderCraft();
  $('craftOverlay').classList.remove('hidden');
}
function openFurnace(d, x, y, z){
  if (!M.game.started || M.game.player.dead) return;
  if (invOpen || craftOpen){ closeOverlays(); }
  furnOpen = { k: d + ':' + x + ',' + y + ',' + z, d, x, y, z };
  M.game.furnaceState(d, x, y, z);
  document.exitPointerLock && document.exitPointerLock();
  renderFurnace();
  $('furnaceOverlay').classList.remove('hidden');
  if (!furnInterval) furnInterval = setInterval(furnPulse, 200);
}

/* ---------- HUD ---------- */
let lastHeartsHp = -1, lastAirN = -1, lastHotKey = '';
function hudHearts(){
  const p = M.game.player;
  const box = $('hearts');
  if (M.game.worldMeta && M.game.worldMeta.mode === 'creative'){ box.innerHTML = ''; lastHeartsHp = -1; return; }
  if (p.hp === lastHeartsHp) return;
  lastHeartsHp = p.hp;
  let html = '';
  for (let i=0;i<10;i++){
    const v = p.hp - i*2;
    html += `<span class="${v >= 2 ? '' : (v === 1 ? 'half' : 'empty')}">❤</span>`;
  }
  box.innerHTML = html;
}
function hudAir(){
  const p = M.game.player;
  const box = $('air');
  if (M.game.worldMeta && M.game.worldMeta.mode === 'creative'){ box.innerHTML = ''; lastAirN = -1; return; }
  const n = Math.ceil(Math.max(0, p.air));
  if (n === lastAirN) return;
  lastAirN = n;
  box.innerHTML = n < 10 ? '<span>●</span>'.repeat(n) : '';
}
function hudHotbar(){
  const inv = M.game.inv, sel = M.game.selected;
  let key = sel + '|';
  for (let i=0;i<9;i++){ const s = inv[i]; key += s ? s.id + ':' + s.count + ';' : '-;'; }
  if (key === lastHotKey) return;
  lastHotKey = key;
  const box = $('hotbar');
  let html = '';
  for (let i=0;i<9;i++){
    const s = inv[i];
    html += `<div class="hslot${i === sel ? ' sel' : ''}" data-i="${i}">${s ? slotHTML(s) : ''}</div>`;
  }
  box.innerHTML = html;
  box.querySelectorAll('.hslot').forEach(el => {
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); M.game.setSel(+el.dataset.i); });
  });
}
function hudAll(){ hudHearts(); hudAir(); hudHotbar(); }
function hudFps(fps){
  const p = M.game.player, d = M.DIM;
  $('debug').textContent =
    `MCHTML v2.0 · ${fps.toFixed(0)} fps · ` +
    `${Math.floor(p.pos.x)}, ${Math.floor(p.pos.y)}, ${Math.floor(p.pos.z)} · ` +
    `${M.DIM_NAME[d.cur]}${M.game.worldMeta ? ' · ' + M.game.worldMeta.mode : ''}`;
}
function toast(msg){
  const box = $('toasts');
  const d = document.createElement('div');
  d.className = 'toast';
  d.textContent = msg;
  box.appendChild(d);
  while (box.children.length > 4) box.removeChild(box.firstChild);
  setTimeout(() => d.classList.add('fade'), 2000);
  setTimeout(() => d.remove(), 2600);
}
function hurtFlash(){
  const f = $('hurtFlash');
  f.classList.remove('on');
  void f.offsetWidth;
  f.classList.add('on');
  setTimeout(() => f.classList.remove('on'), 280);
}
function showDeath(){
  document.exitPointerLock && document.exitPointerLock();
  showScreen('death');
}
function hideDeath(){ showScreen(null); }
function hideLoading(){ $('loading').classList.add('hidden'); }
function showLoading(){ $('loading').classList.remove('hidden'); $('loadBar').style.width = '0%'; }
function loadingBar(){
  if (!M.game.started) return;
  let total = 0, ready = 0;
  for (const [, c] of M.chunks){
    if (c.dim !== M.DIM.cur) continue;
    total++;
    if (!c.dirty) ready++;
  }
  const target = (2 * M.game.settings.dist + 3) ** 2;
  const pct = Math.min(100, Math.round(ready / target * 100));
  $('loadBar').style.width = pct + '%';
  $('loadText').textContent = pct < 100 ? `generating terrain… ${pct}%` : 'entering world…';
}

/* ---------- screens ---------- */
const SCREENS = ['title','worlds','create','loading','pause','settings','howto','mp','death'];
function showScreen(name){
  for (const s of SCREENS) $(s).classList.toggle('hidden', s !== name);
}
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ---------- worlds management ---------- */
function refreshWorlds(){
  const list = M.game.listWorlds().slice().sort((a, b) => b.ts - a.ts);
  const box = $('worldsList');
  box.innerHTML = '';
  if (!list.length) box.innerHTML = '<div class="empty">no worlds yet — create one!</div>';
  for (const w of list){
    const row = document.createElement('div');
    row.className = 'wrow';
    row.innerHTML = `<div class="winfo"><b>${escapeHtml(w.name)}</b><span>${w.mode} · seed ${w.seed}</span></div>`;
    const play = document.createElement('button');
    play.className = 'btn small'; play.textContent = 'Play';
    play.addEventListener('click', () => {
      w.ts = Date.now();
      M.game.saveWorldsIndex(list);
      enterWorld({ name: w.name, seed: w.seed, mode: w.mode });
    });
    const del = document.createElement('button');
    del.className = 'btn small danger'; del.textContent = '✕';
    del.addEventListener('click', () => {
      if (confirm(`Delete "${w.name}" forever?`)){ M.game.deleteWorld(w.name); refreshWorlds(); }
    });
    row.append(play, del);
    box.appendChild(row);
  }
}
function strHash(s){
  let h = 2166136261;
  for (let i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h | 0;
}
function uniqueName(base){
  const have = new Set(M.game.listWorlds().map(w => w.name));
  if (!have.has(base)) return base;
  for (let k=2;;k++) if (!have.has(`${base} ${k}`)) return `${base} ${k}`;
}
function createGo(){
  const base = $('cName').value.trim() || 'New World';
  const name = uniqueName(base);
  const raw = $('cSeed').value.trim();
  const seed = raw === '' ? ((Math.random() * 2147483647) | 0)
    : (/^-?\d+$/.test(raw) ? (parseInt(raw, 10) | 0) : strHash(raw));
  const mode = $('cModeSurvival').checked ? 'survival' : 'creative';
  const list = M.game.listWorlds();
  list.push({ name, seed, mode, ts: Date.now() });
  M.game.saveWorldsIndex(list);
  enterWorld({ name, seed, mode });
}

/* ---------- enter / leave world ---------- */
function enterWorld(meta){
  closeOverlays();
  if (M.mp && M.mp.leave) M.mp.leave();
  M.game.setStarted(true);
  M.game.setRunning(true);
  M.game.setPaused(false);
  M.game.startWorld(meta);
  M.game.primed = false;
  showScreen('loading');
  $('loading').classList.remove('hidden');
  $('hud').classList.remove('hidden');
  lastHeartsHp = -1; lastAirN = -1; lastHotKey = '';
  hudAll();
  updateTouchVis();
}
function leaveWorld(){
  M.game.saveNow();
  if (M.mp && M.mp.leave) M.mp.leave();
  M.game.setRunning(false);
  M.game.setPaused(true);
  M.game.setStarted(false);
  closeOverlays();
  $('hud').classList.add('hidden');
  hideTouch();
  showScreen('title');
  refreshWorlds();
}

/* ---------- pause ---------- */
function togglePause(){
  if (!M.game.started || M.game.player.dead) return;
  if (overlayOpen()){ closeOverlays(); return; }
  if (M.game.paused){
    $('pause').classList.add('hidden');
    showScreen(null);
    M.game.setPaused(false);
    if (!M.game.isTouchActive()) M.game.lock();
  } else {
    M.game.setPaused(true);
    document.exitPointerLock && document.exitPointerLock();
    $('pauseSeed').textContent = 'seed: ' + (M.game.worldMeta ? M.game.worldMeta.seed : '?');
    showScreen('pause');
    if (M.mp) updateMpStatus();
  }
}
function copyText(t){
  if (navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(t).then(() => toast('copied to clipboard'), () => fallbackCopy(t));
  } else fallbackCopy(t);
}
function fallbackCopy(t){
  const ta = document.createElement('textarea');
  ta.value = t;
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); toast('copied to clipboard'); } catch(e){ toast('copy failed'); }
  ta.remove();
}

/* ---------- settings ---------- */
function applySettingsUI(){
  const st = M.game.settings;
  $('sensRange').value = st.sens;
  $('sensVal').textContent = st.sens.toFixed(1);
  $('invertY').checked = !!st.invertY;
  $('distSel').value = String(st.dist);
}

/* ---------- multiplayer panes ---------- */
function updateMpStatus(){
  const el = $('mpStatus');
  if (!el || !M.mp) return;
  const n = M.mp.chans ? M.mp.chans.filter(c => c.readyState === 'open').length : 0;
  el.textContent = M.mp.active ? `connected · ${n} peer${n === 1 ? '' : 's'}` : 'offline';
}
function wireMpPane(){
  if (!M.mp || !M.mp.host) return;
  $('btnMpHost').addEventListener('click', async () => {
    try {
      $('mpOffer').value = 'making code…';
      await M.mp.host((code) => { $('mpOffer').value = code; toast('invite code ready — send it to your friend'); });
    } catch(err){ $('mpOffer').value = ''; toast('host failed: ' + err.message); }
  });
  $('btnMpCopyOffer').addEventListener('click', () => copyText($('mpOffer').value));
  $('btnMpReply').addEventListener('click', async () => {
    try { await M.mp.acceptReply($('mpAnswerIn').value); toast('connecting…'); }
    catch(err){ toast('bad reply code: ' + err.message); }
  });
  $('btnMpJoin').addEventListener('click', async () => {
    try {
      $('mpAnswerOut').value = 'making reply…';
      await M.mp.join($('mpJoinCode').value, (code) => { $('mpAnswerOut').value = code; toast('reply code ready — send it back'); });
    } catch(err){ $('mpAnswerOut').value = ''; toast('join failed: ' + err.message); }
  });
  $('btnMpCopyAnswer').addEventListener('click', () => copyText($('mpAnswerOut').value));
  $('btnMpLeave').addEventListener('click', () => { M.mp.leave(); updateMpStatus(); });
}
function mpStatus(txt){
  const el = $('mpStatus');
  if (el) el.textContent = txt;
}

/* ---------- touch controls ---------- */
const isTouchEnv = () => M.game.isTouchActive();
function updateTouchVis(){
  const on = isTouchEnv() && M.game.started;
  $('touchRoot').classList.toggle('hidden', !on);
  if (on){
    const creative = M.game.worldMeta && M.game.worldMeta.mode === 'creative';
    $('btnFly').classList.toggle('hidden', !creative);
    $('btnMode').textContent = touchMode.toUpperCase();
  }
}
function hideTouch(){ $('touchRoot').classList.add('hidden'); }
function setupTouch(){
  // joystick
  const zone = $('stickZone'), knob = $('stickKnob');
  let sid = null;
  const upd = (e) => {
    const r = zone.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const R = r.width / 2, d = Math.hypot(dx, dy);
    if (d > R){ dx = dx / d * R; dy = dy / d * R; }
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    const sv = M.stickVec;
    sv.active = true; sv.x = dx / R; sv.y = dy / R;
  };
  zone.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    sid = e.pointerId;
    zone.setPointerCapture(sid);
    upd(e);
  });
  zone.addEventListener('pointermove', (e) => { if (e.pointerId === sid) upd(e); });
  const zend = (e) => {
    if (e.pointerId !== sid) return;
    sid = null;
    knob.style.transform = 'translate(-50%, -50%)';
    const sv = M.stickVec;
    sv.active = false; sv.x = 0; sv.y = 0;
  };
  zone.addEventListener('pointerup', zend);
  zone.addEventListener('pointercancel', zend);
  zone.addEventListener('contextmenu', e => e.preventDefault());

  // look + tap-to-act zone (right side)
  const look = $('lookZone');
  let lid = null, lx = 0, ly = 0, repInterval = null;
  const stopRep = () => { if (repInterval){ clearInterval(repInterval); repInterval = null; } };
  look.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (lid !== null) return;
    lid = e.pointerId;
    look.setPointerCapture(lid);
    lx = e.clientX; ly = e.clientY;
    if (touchMode === 'mine'){
      if (M.game.worldMeta && M.game.worldMeta.mode === 'creative'){
        M.game.breakBlock();
        stopRep();
        repInterval = setInterval(() => M.game.breakBlock(), 260);
      } else {
        M.game.setMineHold(true);      // hold-to-mine with progress
      }
    } else {
      M.game.placeBlock();
      stopRep();
      repInterval = setInterval(() => M.game.placeBlock(), 300);
    }
  });
  look.addEventListener('pointermove', (e) => {
    if (e.pointerId !== lid) return;
    const st = M.game.settings;
    const dx = e.clientX - lx, dy = e.clientY - ly;
    M.game.player.yaw -= dx * .0045 * st.sens;
    M.game.player.pitch -= dy * .0045 * st.sens * (st.invertY ? -1 : 1);
    M.game.player.pitch = Math.max(-1.55, Math.min(1.55, M.game.player.pitch));
    lx = e.clientX; ly = e.clientY;
  });
  const lend = (e) => {
    if (e.pointerId !== lid) return;
    lid = null;
    stopRep();
    M.game.setMineHold(false);
  };
  look.addEventListener('pointerup', lend);
  look.addEventListener('pointercancel', lend);
  look.addEventListener('contextmenu', e => e.preventDefault());

  // buttons
  const hold = (id, code) => {
    const b = $(id);
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); M.game.setKey(code, true); });
    const up = (e) => { M.game.setKey(code, false); };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('pointerleave', up);
    b.addEventListener('contextmenu', e => e.preventDefault());
  };
  hold('btnJump', 'Space');
  hold('btnDown', 'ShiftLeft');
  $('btnFly').addEventListener('click', (e) => {
    e.preventDefault();
    const p = M.game.player;
    p.flying = !p.flying;
    if (p.vel) p.vel.y = 0;
    toast(p.flying ? 'flight on' : 'flight off');
  });
  $('btnMenu').addEventListener('click', (e) => { e.preventDefault(); togglePause(); });
  $('btnMode').addEventListener('click', (e) => {
    e.preventDefault();
    touchMode = touchMode === 'mine' ? 'build' : 'mine';
    $('btnMode').textContent = touchMode.toUpperCase();
    toast(touchMode === 'mine' ? 'tap = mine' : 'tap = place block');
  });
}

let howtoBack = 'title';
function showHowto(back){
  howtoBack = back || 'title';
  showScreen('howto');
}
/* ---------- how-to ---------- */
const HOWTO_HTML = `
<h2>Controls</h2>
<p><b>Desktop:</b> WASD move · mouse look · Space jump (double-tap = fly, creative) · Ctrl sprint ·
LMB mine (hold in survival) · RMB place / use · 1-9 or wheel hotbar · E inventory · Esc pause.</p>
<p><b>Touch:</b> left stick move · drag right side to look · MINE mode: hold to dig, quick tap in creative
instant-breaks · BUILD mode: tap to place · JUMP / DOWN / FLY / MENU buttons · tap hotbar to select.</p>
<h2>Survival progression</h2>
<p>Punch a tree → planks → crafting table → wooden pickaxe → dig stone → stone tools +
furnace → find iron (below y≈52) → iron pickaxe → gold/redstone/diamond (deep, below y≈30).
Diamond pickaxe mines obsidian.</p>
<h2>Redstone</h2>
<p>Craft a lever (stick+cobble), redstone dust drops from redstone ore, lamps from glowstone dust +
redstone. Lever powers dust up to 15 blocks; dust lights adjacent lamps. Lamps and torches glow at night.</p>
<h2>The Nether</h2>
<p>Build an obsidian frame (4×5 minimum), light the inside with a portal igniter (coal + stick).
Stand in the purple glow for a second. Nether coordinates are overworld ÷ 8.</p>
<h2>The End</h2>
<p>Craft end frames (obsidian + glowstone dust ×2 + stone), place 12 in a ring around a 3×3 gap,
fill each with an eye of ender (redstone + 2 glowstone dust). Step into the portal. Kill the void
below the island? No — the exit portal spawns with you; step in it to go home.</p>
<h2>Furnace recipes</h2>
<p>iron ore → ingot · gold ore → ingot · sand → glass · cobblestone → stone · log → coal.
Fuel: coal 8 items, planks/logs 1.5, sticks 0.5.</p>`;

/* ---------- boot ---------- */
let booted = false;
function boot(){
  if (booted) return;
  booted = true;
  // version strings
  $('titleFooter').textContent = 'MCHTML v2.0 · Built by [REDACTED]';
  // navigation
  $('btnPlay').addEventListener('click', () => { refreshWorlds(); showScreen('worlds'); });
  $('btnHow').addEventListener('click', () => showHowto('title'));
  $('btnHowBack').addEventListener('click', () => showScreen(howtoBack));
  $('btnWorldsBack').addEventListener('click', () => showScreen('title'));
  $('btnWorldCreate').addEventListener('click', () => {
    $('cName').value = 'New World';
    $('cSeed').value = '';
    $('cModeCreative').checked = true;
    showScreen('create');
  });
  $('btnCreateBack').addEventListener('click', () => showScreen('worlds'));
  $('btnCreateGo').addEventListener('click', createGo);
  // pause
  $('btnResume').addEventListener('click', togglePause);
  $('btnSave').addEventListener('click', () => { M.game.saveNow(); toast('world saved'); });
  $('btnSeed').addEventListener('click', () => { if (M.game.worldMeta) copyText(String(M.game.worldMeta.seed)); });
  $('btnSettings').addEventListener('click', () => { applySettingsUI(); showScreen('settings'); });
  $('btnMp').addEventListener('click', () => { showScreen('mp'); updateMpStatus(); });
  $('btnMpBack').addEventListener('click', () => showScreen('pause'));
  $('btnHow2').addEventListener('click', () => showHowto('pause'));
  $('btnMainMenu').addEventListener('click', leaveWorld);
  // settings
  $('sensRange').addEventListener('input', (e) => {
    M.game.settings.sens = parseFloat(e.target.value);
    $('sensVal').textContent = M.game.settings.sens.toFixed(1);
  });
  $('invertY').addEventListener('change', (e) => { M.game.settings.invertY = e.target.checked; });
  $('distSel').addEventListener('change', (e) => { M.game.settings.dist = parseInt(e.target.value, 10); });
  $('btnSettingsBack').addEventListener('click', () => showScreen('pause'));
  // death
  $('btnRespawn').addEventListener('click', () => { M.game.respawn(); showScreen(null); });
  $('btnDeathMenu').addEventListener('click', leaveWorld);
  // how-to content
  $('howtoBody').innerHTML = HOWTO_HTML;
  // overlay backdrops: clicking the dark area closes
  for (const id of ['invOverlay', 'craftOverlay', 'furnaceOverlay']){
    $(id).addEventListener('mousedown', (e) => { if (e.target === $(id)) closeOverlays(); });
  }
  // keep global contextmenu off the game
  document.addEventListener('contextmenu', (e) => { if (M.game.started) e.preventDefault(); });
  // multiplayer
  wireMpPane();
  // touch
  if (isTouchEnv()) setupTouch();
  // go
  showScreen('title');
  refreshWorlds();
}

/* ---------- export ---------- */
M.ui = {
  boot, toast, togglePause, toggleInventory,
  openCraft, openFurnace, furnaceTick: furnPulse,
  hudHearts, hudHotbar, hudAir, hudAll, hudFps,
  hurtFlash, showDeath, hideDeath, hideLoading, showLoading, loadingBar,
  mpStatus,
};
})();
