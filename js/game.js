/* MCHTML v2.0 — game.js
   Scene, player physics + survival, mining, interactions, furnaces,
   dimensions & portals, day/night, particles, sfx, save/load, boot loop. */
window.MCH = window.MCH || {};
(function(){
const M = MCH;
const { B, BINFO, ITEMS, TOOL, OPAQUE, SOLID, INTERACT, NAMES,
        CH, HGT, SEA, DIM, DIM_NAME, DIM_SKY, WORLD_BORDER,
        edits, editKey, chunks, chunkAt, key, heightAt } = M;

/* ---------- globals ---------- */
let scene, camera, renderer, atlasTex;
let matSolid, matWater, matTrans, crackMats = [];
let hiBox, crackMesh, sunSpr, moonSpr, stars, cloudGrp;
let running = false, paused = false, started = false;
let worldMeta = null;                      // { name, seed, mode }
let worldTime = 0;                         // 0..1 day fraction (day = 600s)
const keys = new Set();
let lastSpace = 0, selected = 0;

const player = {
  pos: new THREE.Vector3(), vel: new THREE.Vector3(),
  yaw: 0, pitch: 0, onGround: false, flying: false,
  inWater: false, inLava: false, dead: false,
  w: .30, h: 1.8, eye: 1.62, hp: 20, air: 10, regenT: 0, hurtT: 0, fallY: null,
};
const settings = { sens: 1, invertY: false, touch: null, dist: 4 };
let saveTimer = null;

M.playerPos = player.pos;

/* ---------- sfx (tiny synth) ---------- */
let AC = null;
function audioCtx(){ if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === 'suspended') AC.resume(); return AC; }
function sfx(kind){
  try {
    const ac = audioCtx(), t = ac.currentTime;
    const o = ac.createOscillator(), g = ac.createGain();
    o.connect(g); g.connect(ac.destination);
    const cfg = {
      break:  [220, 90, .08, .12], place: [340, 70, .07, .10], jump: [500, 40, .05, .06],
      click:  [700, 30, .04, .06], hurt:  [140, 180, .12, .22], pop:  [520, 60, .05, .08],
      portal: [110, 700, .5, .18], craft: [430, 80, .09, .10], eat:  [260, 120, .1, .1],
      lever:  [600, 40, .03, .07],
    }[kind] || [300, 60, .06, .1];
    o.frequency.setValueAtTime(cfg[0], t);
    o.frequency.exponentialRampToValueAtTime(Math.max(30, cfg[0] - cfg[1]), t + cfg[2]);
    g.gain.setValueAtTime(cfg[3], t);
    g.gain.exponentialRampToValueAtTime(.001, t + cfg[2]);
    o.start(t); o.stop(t + cfg[2] + .02);
  } catch(e){}
}

/* ---------- scene ---------- */
function setupScene(){
  const canvas = document.getElementById('view');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(72, innerWidth/innerHeight, .08, 900);
  addEventListener('resize', () => {
    camera.aspect = innerWidth/innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  const atlas = M.buildAtlas();
  atlasTex = new THREE.CanvasTexture(atlas);
  atlasTex.magFilter = THREE.NearestFilter;
  atlasTex.minFilter = THREE.NearestFilter;
  matSolid = new THREE.MeshBasicMaterial({ map: atlasTex, vertexColors: true });
  matWater = new THREE.MeshBasicMaterial({ map: atlasTex, vertexColors: true, transparent: true, opacity: .68, depthWrite: false });
  matTrans = new THREE.MeshBasicMaterial({ map: atlasTex, vertexColors: true, transparent: true, opacity: .85, side: THREE.DoubleSide, depthWrite: false });

  // crack overlay stages
  for (let s=0; s<4; s++){
    const c = document.createElement('canvas'); c.width = 16; c.height = 16;
    c.getContext('2d').drawImage(atlas, (M.TILE_INDEX['crack'+s] % 16)*16, ((M.TILE_INDEX['crack'+s]/16)|0)*16, 16, 16, 0, 0, 16, 16);
    const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
    crackMats.push(new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
  }
  crackMesh = new THREE.Mesh(new THREE.BoxGeometry(1.004, 1.004, 1.004), crackMats[0]);
  crackMesh.visible = false;
  scene.add(crackMesh);

  hiBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
    new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: .5 }));
  hiBox.visible = false;
  scene.add(hiBox);

  // sun / moon sprites
  const disc = (color, glow) => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const rg = g.createRadialGradient(32, 32, 4, 32, 32, 30);
    rg.addColorStop(0, color); rg.addColorStop(.55, color); rg.addColorStop(1, glow);
    g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    return new THREE.Sprite(new THREE.SpriteMaterial({ map: t, fog: false, transparent: true, depthWrite: false }));
  };
  sunSpr = disc('#fff7d0', 'rgba(255,247,208,0)');  sunSpr.scale.set(60, 60, 1); scene.add(sunSpr);
  moonSpr = disc('#dfe6f0', 'rgba(223,230,240,0)'); moonSpr.scale.set(38, 38, 1); scene.add(moonSpr);

  // stars
  const sg = new THREE.BufferGeometry();
  const sp = [];
  for (let i=0; i<420; i++){
    const a = Math.random()*Math.PI*2, b = Math.acos(Math.random()*2-1), r = 400;
    sp.push(r*Math.sin(b)*Math.cos(a), Math.abs(r*Math.cos(b)), r*Math.sin(b)*Math.sin(a));
  }
  sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xcfd8ff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false }));
  scene.add(stars);

  // clouds
  cloudGrp = new THREE.Group();
  const cmat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .34, fog: false });
  for (let i=0; i<26; i++){
    const m = new THREE.Mesh(new THREE.BoxGeometry(10 + Math.random()*22, 1.4, 8 + Math.random()*16), cmat);
    m.position.set((Math.random()-.5)*400, HGT - 6 + Math.random()*8, (Math.random()-.5)*400);
    cloudGrp.add(m);
  }
  scene.add(cloudGrp);

  M.scene = scene;
  M.camera = camera;
}

/* ---------- particles ---------- */
const particles = [];
let pGeo = null;
function puffColor(id){
  const inf = BINFO[id];
  if (!inf) return 0x888888;
  const atlas = M.buildAtlas();
  const g = atlas.getContext('2d');
  const i = M.TILE_INDEX[inf.t] || 0;
  const px = g.getImageData((i % 16)*16 + 8, ((i/16)|0)*16 + 8, 1, 1).data;
  return (px[0] << 16) | (px[1] << 8) | px[2];
}
function spawnBreakParticles(x, y, z, id){
  const col = puffColor(id);
  if (!pGeo) pGeo = new THREE.BoxGeometry(.12, .12, .12);
  for (let i=0; i<12; i++){
    const m = new THREE.Mesh(pGeo, new THREE.MeshBasicMaterial({ color: col }));
    m.position.set(x + .2 + Math.random()*.6, y + .2 + Math.random()*.6, z + .2 + Math.random()*.6);
    m.userData = {
      vx: (Math.random()-.5)*3.4, vy: 2 + Math.random()*3, vz: (Math.random()-.5)*3.4, life: .55 + Math.random()*.4,
    };
    scene.add(m); particles.push(m);
  }
}
M.puff = spawnBreakParticles;
function updateParticles(dt){
  for (let i=particles.length-1; i>=0; i--){
    const p = particles[i], u = p.userData;
    u.vy -= 14*dt;
    p.position.x += u.vx*dt; p.position.y += u.vy*dt; p.position.z += u.vz*dt;
    if (u.vy < 0 && M.isSolidId(M.getBlock(Math.floor(p.position.x), Math.floor(p.position.y - .08), Math.floor(p.position.z)))){
      u.vy *= -.3; u.vx *= .6; u.vz *= .6; p.position.y = Math.floor(p.position.y) + .07;
    }
    u.life -= dt;
    const s = Math.max(.05, Math.min(1, u.life*2.2));
    p.scale.set(s, s, s);
    if (u.life <= 0){ scene.remove(p); particles.splice(i, 1); }
  }
}

/* ---------- voxel raycast ---------- */
const REACH = 5;
function raycastVoxel(origin, dir){
  let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
  const stepX = dir.x > 0 ? 1 : -1, stepY = dir.y > 0 ? 1 : -1, stepZ = dir.z > 0 ? 1 : -1;
  const tDX = Math.abs(1/dir.x), tDY = Math.abs(1/dir.y), tDZ = Math.abs(1/dir.z);
  let tMaxX = ((stepX > 0 ? x+1-origin.x : origin.x-x)) * tDX;
  let tMaxY = ((stepY > 0 ? y+1-origin.y : origin.y-y)) * tDY;
  let tMaxZ = ((stepZ > 0 ? z+1-origin.z : origin.z-z)) * tDZ;
  let face = [0, 0, 0], t = 0;
  for (let i=0; i<160; i++){
    const id = M.getBlock(x, y, z);
    if (id !== B.AIR && id !== B.WATER && id !== B.LAVA) return { x, y, z, id, face };
    if (tMaxX < tMaxY && tMaxX < tMaxZ){ x += stepX; t = tMaxX; tMaxX += tDX; face = [-stepX, 0, 0]; }
    else if (tMaxY < tMaxZ){ y += stepY; t = tMaxY; tMaxY += tDY; face = [0, -stepY, 0]; }
    else { z += stepZ; t = tMaxZ; tMaxZ += tDZ; face = [0, 0, -stepZ]; }
    if (t > REACH) return null;
  }
  return null;
}
function camDir(){ const v = new THREE.Vector3(0, 0, -1); v.applyEuler(camera.rotation); return v; }
const targetVoxel = () => raycastVoxel(camera.position, camDir());
M.aimFn = () => targetVoxel();

/* ---------- inventory ---------- */
const inv = new Array(36).fill(null);      // {id, count}; 0..8 = hotbar
function addInv(id, n){
  const max = M.stackMax(id);
  for (let i=0; i<36 && n>0; i++){
    const s = inv[i];
    if (s && s.id === id && s.count < max){ const take = Math.min(n, max - s.count); s.count += take; n -= take; }
  }
  for (let i=0; i<36 && n>0; i++){
    if (!inv[i]){ const take = Math.min(n, max); inv[i] = { id, count: take }; n -= take; }
  }
  M.ui && M.ui.hudHotbar();
  return n;                                  // leftover (dropped)
}
function countInv(id){ let n = 0; for (const s of inv) if (s && s.id === id) n += s.count; return n; }
function takeInv(id, n){
  for (let i=0; i<36 && n>0; i++){
    const s = inv[i];
    if (s && s.id === id){ const take = Math.min(n, s.count); s.count -= take; n -= take; if (!s.count) inv[i] = null; }
  }
  M.ui && M.ui.hudHotbar();
  return n === 0;
}
function selStack(){ return inv[selected]; }
function consumeSel(){
  if (worldMeta.mode === 'creative') return true;
  const s = inv[selected];
  if (!s) return false;
  s.count--; if (!s.count) inv[selected] = null;
  M.ui && M.ui.hudHotbar();
  return true;
}
function setSel(i){ selected = i; M.ui && M.ui.hudHotbar(); }

/* mining speed of the held tool for a block */
function breakInfo(id){
  const inf = BINFO[id];
  if (!inf || inf.unbreak) return null;
  const s = selStack();
  const tool = s && TOOL[s.id];
  const need = inf.tier || 0;
  if (need > 0){
    if (!tool || tool.kind !== (inf.tool || 'pick') || tool.tier < need) return { blocked: true, need };
  }
  let mult = 1;
  if (tool && tool.kind === inf.tool) mult = tool.mult;
  else if (tool && tool.kind === 'sword' && (id === B.LEAF)) mult = tool.mult;
  return { seconds: Math.max(.05, inf.hard / mult) };
}

/* ---------- editing ---------- */
function blockDrops(id){
  const inf = BINFO[id];
  const out = [];
  let d = inf.drop || { id, n: 1 };
  if (d.id != null) out.push({ id: d.id, n: d.n });
  if (inf.bonus && Math.random() < inf.bonus.p) out.push({ id: inf.bonus.id, n: inf.bonus.n });
  return out;
}
function doBreak(t){
  M.setBlock(t.x, t.y, t.z, B.AIR);
  spawnBreakParticles(t.x, t.y, t.z, t.id);
  sfx('break');
  if (worldMeta.mode === 'survival') for (const d of blockDrops(t.id)) addInv(d.id, d.n);
  // furnace contents spill
  const fk = DIM.cur + ':' + t.x + ',' + t.y + ',' + t.z;
  if (furnaces.has(fk)){
    const f = furnaces.get(fk);
    for (const s of [f.i, f.f, f.o]) if (s) addInv(s.id, s.count);
    furnaces.delete(fk);
  }
  if (M.getBlock(t.x, t.y+1, t.z) === B.SAND) M.settleFrom(t.x, t.y+1, t.z);
  if (M.getBlock(t.x, t.y+1, t.z) === B.GRAVEL) M.gravelSettle(t.x, t.y+1, t.z);
  saveSoon();
}
function breakBlock(){
  const t = targetVoxel();
  if (!t) return;
  const info = breakInfo(t.id);
  if (!info){ toastish('unbreakable'); return; }
  if (worldMeta.mode === 'creative'){ doBreak(t); return; }   // creative ignores tool tiers
  if (info.blocked){ toastish('need a ' + ['','wood','stone','iron','diamond'][info.need] + ' pickaxe'); return; }
  // survival: hold-to-mine handled in the loop via mineTarget
}
function placeAt(px, py, pz){
  const cur = M.getBlock(px, py, pz);
  if (cur !== B.AIR && cur !== B.WATER && cur !== B.LAVA) return false;
  const s = selStack();
  if (!s) return false;
  const id = M.itemPlacesBlock(s.id);
  if (id == null) return false;
  // don't place inside the player
  const inf = BINFO[id];
  if (inf && inf.solid){
    const w = player.w + .02;
    if (px+1 > player.pos.x-w && px < player.pos.x+w &&
        pz+1 > player.pos.z-w && pz < player.pos.z+w &&
        py+1 > player.pos.y && py < player.pos.y+player.h) return false;
  }
  M.setBlock(px, py, pz, id);
  consumeSel();
  sfx('place');
  if (id === B.SAND) M.settleFrom(px, py, pz);
  if (id === B.GRAVEL) M.gravelSettle(px, py, pz);
  saveSoon();
  return true;
}
function placeBlock(){
  const t = targetVoxel();
  if (!t) return;
  const inf = BINFO[t.id];
  // interactables take the click first (sneak places over them on desktop)
  if (inf && inf.interact && !keys.has('ShiftLeft') && !keys.has('ControlLeft')){ interactWith(t); return; }
  const px = t.x + t.face[0], py = t.y + t.face[1], pz = t.z + t.face[2];
  // dust needs solid ground under the cell
  if (selStack() && M.itemPlacesBlock(selStack().id) === B.WIRE && !M.isSolidId(M.getBlock(px, py-1, pz))) return;
  placeAt(px, py, pz);
}
function interactWith(t){
  const kind = BINFO[t.id] && BINFO[t.id].interact;
  if (kind === 'craft'){ M.ui.openCraft(3); return; }
  if (kind === 'furnace'){ M.ui.openFurnace(DIM.cur, t.x, t.y, t.z); return; }
  if (kind === 'lever'){
    M.rsToggleLever(DIM.cur, t.x, t.y, t.z);
    sfx('lever');
    saveSoon();
    return;
  }
  if (kind === 'frame'){
    const s = selStack();
    if (s && s.id === 'eye' && t.id === B.EFRAME){
      takeInv('eye', 1);
      M.setBlock(t.x, t.y, t.z, B.EFRAME_EYE);
      sfx('pop');
      checkEndPortal(t.x, t.y, t.z);
      saveSoon();
    }
    return;
  }
}
/* end portal: 12 filled frames ring a 5×5 → interior 3×3 becomes EPORTAL */
function checkEndPortal(fx, fy, fz){
  for (const [cdx, cdz] of [[2,0],[-2,0],[0,2],[0,-2]]){
    const cx = fx + cdx, cz = fz + cdz;
    let ok = true;
    const ring = [];
    for (let i=-2; i<=2; i++) for (let j=-2; j<=2; j++){
      if (Math.max(Math.abs(i), Math.abs(j)) !== 2) continue;
      ring.push([cx+i, cz+j]);
    }
    for (const [x, z] of ring) if (M.getBlock(x, fy, z) !== B.EFRAME_EYE){ ok = false; break; }
    if (!ok) continue;
    for (let i=-1; i<=1; i++) for (let j=-1; j<=1; j++) M.setBlock(cx+i, fy, cz+j, B.EPORTAL);
    sfx('portal');
    toastish('the end opens…');
    return;
  }
}

/* ---------- furnace ---------- */
const furnaces = new Map();                  // "d:x,y,z" → {i,f,o,burn,maxBurn,prog}
function furnaceState(d, x, y, z){
  const k = d + ':' + x + ',' + y + ',' + z;
  if (!furnaces.has(k)) furnaces.set(k, { i: null, f: null, o: null, burn: 0, maxBurn: 1, prog: 0 });
  return furnaces.get(k);
}
const SMELT = { [B.IRON]: 'iron_ingot', [B.GOLD]: 'gold_ingot', [B.SAND]: B.GLASS, [B.COBBLE]: B.STONE, [B.LOG]: 'coal' };
function fuelValue(id){
  if (id === 'coal') return 8;
  if (id === B.PLANK || id === B.LOG || id === B.CRAFT) return 1.5;
  if (id === 'stick') return .5;
  return 0;
}
function tickFurnaces(dt){
  for (const [k, f] of furnaces){
    const canSmelt = f.i && SMELT[f.i.id] != null && (!f.o || (f.o.id === SMELT[f.i.id] && f.o.count < 64));
    if (f.burn <= 0 && canSmelt && f.f && fuelValue(f.f.id) > 0){
      f.maxBurn = fuelValue(f.f.id) * 5;     // fuel units → seconds (1 unit = 5s)
      f.burn = f.maxBurn;
      f.f.count--; if (!f.f.count) f.f = null;
    }
    if (f.burn > 0){
      f.burn -= dt;
      if (canSmelt){
        f.prog += dt;
        if (f.prog >= 5){
          f.prog = 0;
          const out = SMELT[f.i.id];
          f.i.count--; if (!f.i.count) f.i = null;
          if (f.o && f.o.id === out) f.o.count++; else f.o = { id: out, count: 1 };
          M.ui && M.ui.furnaceTick && M.ui.furnaceTick();
        }
      } else f.prog = 0;
    } else f.prog = Math.max(0, f.prog - dt*2);
  }
}

/* ---------- portals & dimensions ---------- */
const portalLinks = new Map();               // "d|x,y,z" → { d, x, y, z }
function stampArrival(dim, x, z, linkBack, isNether){
  // find/build a safe pocket at (x, z)
  let py = isNether ? 60 : -1;
  if (isNether){
    for (let y=40; y<86; y++){
      const a = M.cellAt(dim, x, y, z), b = M.cellAt(dim, x, y+1, z), c = M.cellAt(dim, x, y+2, z);
      if (a !== B.AIR && a !== B.LAVA && b === B.AIR && c === B.AIR){ py = y+1; break; }
    }
    if (py < 0) py = 60;
  } else py = M.heightAt(x, z) + 1;
  if (py < 2) py = 2;
  // platform
  for (let dx=-2; dx<=2; dx++) for (let dz=-2; dz<=2; dz++){
    M.setBlock(x+dx, py-1, z+dz, isNether ? B.NETHERRACK : B.STONE, true, true, dim);
    for (let dy=0; dy<4; dy++) M.setBlock(x+dx, py+dy, z+dz, B.AIR, true, true, dim);
  }
  // portal frame standing on the platform (X-plane, 4 wide × 5 high incl corners)
  const fy = py, fx = x, fz = z;
  const frame = [];
  for (let dy=0; dy<4; dy++){ frame.push([fx-1, fy+dy, fz], [fx+2, fy+dy, fz]); }
  for (let dx=-1; dx<=2; dx++){ frame.push([fx+dx, fy-1+0, fz], [fx+dx, fy+4, fz]); }
  for (const [ax, ay, az] of frame) M.setBlock(ax, ay, az, B.OBSIDIAN, true, true, dim);
  for (let dx=0; dx<=1; dx++) for (let dy=0; dy<=2; dy++) M.setBlock(fx+dx, fy+dy, fz, B.PORTAL, true, true, dim);
  portalLinks.set(dim + '|' + fx + ',' + fy + ',' + fz, linkBack);
  portalLinks.set(linkBack.dim + '|' + linkBack.x + ',' + linkBack.y + ',' + linkBack.z, { d: dim, x: fx+0.5, y: fy+1, z: fz+0.5 });
  return { x: fx+.5, y: fy+.05, z: fz+.5 };
}
function linkPortal(fromDim, fx, fy, fz){
  // overworld portal → nether (÷8) ; nether portal → overworld (×8)
  const isNether = fromDim === 0;
  const destDim = isNether ? 1 : 0;
  const dx = isNether ? Math.round(fx/8) : Math.round(fx*8);
  const dz = isNether ? Math.round(fz/8) : Math.round(fz*8);
  const back = { d: fromDim, x: fx+.5, y: fy+.05, z: fz+.5 };
  return stampArrival(destDim, dx, dz, back, true);
}
function endArrival(){
  // stamp island-top platform + active exit portal at the end's center
  const d = 2;
  let top = 58;
  for (let y=HGT-10; y>8; y--) if (M.cellAt(d, 0, y, 0) !== B.AIR){ top = y; break; }
  for (let dx=-2; dx<=2; dx++) for (let dz=-2; dz<=2; dz++){
    M.setBlock(dx, top, dz, B.BEDROCK, true, true, d);
    for (let dy=1; dy<=4; dy++) M.setBlock(dx, top+dy, dz, B.AIR, true, true, d);
  }
  for (let dx=-1; dx<=1; dx++) for (let dz=-1; dz<=1; dz++) M.setBlock(dx, top+1, dz, B.EPORTAL, true, true, d);
  return { x: .5, y: top+2.2, z: .5, exit: { x: .5, y: top+1.15, z: .5 } };
}
let exitSpot = null;
let portalT = 0, portalCool = 0;
function checkPortal(dt){
  if (portalCool > 0){ portalCool -= dt; return; }
  const px = Math.floor(player.pos.x), py = Math.floor(player.pos.y + .5), pz = Math.floor(player.pos.z);
  const id = M.getBlock(px, py, pz);
  const inf = BINFO[id];
  if (!inf || !inf.tele){ portalT = 0; return; }
  portalT += dt;
  if (portalT < 1.1) return;
  portalT = 0; portalCool = 3;
  sfx('portal');
  if (inf.tele === 'end' && DIM.cur === 0){
    if (!exitSpot) exitSpot = endArrival();
    switchDim(2, exitSpot.x, exitSpot.y, exitSpot.z);
    return;
  }
  if (inf.tele === 'end' && DIM.cur === 2){
    // exit portal home
    respawnWorldSpawn();
    return;
  }
  // nether portals
  const k = DIM.cur + '|' + px + ',' + py + ',' + pz;
  let link = portalLinks.get(k);
  if (!link){
    link = DIM.cur === 0
      ? linkPortal(0, px, py, pz)
      : stampArrival(0, Math.round(px*8), Math.round(pz*8), { d: DIM.cur, x: px+.5, y: py+.05, z: pz+.5 }, true);
  }
  switchDim(link.d, link.x, link.y, link.z);
}
function switchDim(d, x, y, z){
  if (DIM.cur === d) return;
  DIM.cur = d;
  M.clearChunks();
  player.pos.set(x, y, z); player.vel.set(0, 0, 0);
  player.fallY = null;
  primed = false;                          // re-gate sim until this dim's chunks exist
  M.ui && M.ui.showLoading && M.ui.showLoading();
  applySky();
  hCacheClear();
  saveSoon();
  if (M.mp && M.mp.active) M.netBroadcast({ t: 'dim', d, pid: M.mpPid ? M.mpPid() : 'me' });
}
function hCacheClear(){ /* heightAt cache invalidation is handled by seed change only */ }

/* nether portal frame light: igniter use on obsidian-adjacent air */
function tryIgnite(t){
  const s = selStack();
  if (!s || s.id !== 'igniter') return false;
  // candidate interior cells: the clicked face's neighbor
  const ix = t.x + t.face[0], iy = t.y + t.face[1], iz = t.z + t.face[2];
  if (M.getBlock(ix, iy, iz) !== B.AIR) return false;
  // flood interior (≤ 32 cells) bounded by obsidian in a single plane
  for (const plane of ['x', 'z']){
    const cells = [];
    const seen = new Set();
    const q = [[ix, iy, iz]];
    seen.add(ix + ',' + iy + ',' + iz);
    let ok = true;
    while (q.length && cells.length <= 32){
      const [cx, cy, cz] = q.shift();
      cells.push([cx, cy, cz]);
      const dirs = plane === 'x' ? [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0]] : [[0,0,1],[0,0,-1],[0,1,0],[0,-1,0]];
      for (const [dx, dy, dz] of dirs){
        const nx = cx+dx, ny = cy+dy, nz = cz+dz;
        const nk = nx + ',' + ny + ',' + nz;
        if (seen.has(nk)) continue;
        const nid = M.getBlock(nx, ny, nz);
        if (nid === B.OBSIDIAN){ seen.add(nk); continue; }
        if (nid !== B.AIR){ ok = false; break; }
        seen.add(nk); q.push([nx, ny, nz]);
      }
      if (!ok) break;
    }
    if (!ok || cells.length < 6 || cells.length > 32) continue;
    // bounds must be a filled rectangle
    let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9;
    for (const [cx, cy, cz] of cells){
      x0=Math.min(x0, plane==='x'?cx:cz); x1=Math.max(x1, plane==='x'?cx:cz);
      y0=Math.min(y0, cy); y1=Math.max(y1, cy);
    }
    if ((x1-x0+1) * (y1-y0+1) !== cells.length || (x1-x0+1) < 2 || (y1-y0+1) < 3) continue;
    for (const [cx, cy, cz] of cells) M.setBlock(cx, cy, cz, B.PORTAL);
    sfx('portal');
    toastish('the portal hums…');
    saveSoon();
    return true;
  }
  toastish('frame the portal with obsidian');
  return false;
}

/* ---------- spawn ---------- */
function spawnPlayer(){
  let sx=0, sz=0, h=-1;
  outer:
  for (let r=0; r<=400; r++){
    const steps = Math.max(1, Math.ceil(r*6.28));
    for (let i=0; i<steps; i++){
      const a = i/steps*Math.PI*2;
      const x = Math.round(Math.sin(a)*r), z = Math.round(Math.cos(a)*r);
      const hh = heightAt(x, z);
      if (hh >= SEA+1 && !M.spawnBlockedAt(x, z)){ sx=x; sz=z; h=hh; break outer; }
    }
  }
  if (h < 0){ sx=0; sz=0; h=heightAt(0,0); }
  player.pos.set(sx+.5, h+2.6, sz+.5);
  player.vel.set(0,0,0);
  player.yaw = M.hash2(1, 2, 999)*6.28; player.pitch = -.1;
  player.flying = false; player.fallY = null;
}
function respawnWorldSpawn(){
  switchDimHome();
}
function switchDimHome(){
  if (DIM.cur !== 0){ DIM.cur = 0; M.clearChunks(); applySky(); }
  spawnPlayer();
  player.hp = 20; player.air = 10; player.dead = false;
  primed = false;                          // re-gate sim until chunks exist
  M.ui && M.ui.showLoading && M.ui.showLoading();
  M.ui && M.ui.hudHearts();
}

/* spawn rescue: runs once the 3×3 around the player exist. Fixes embedded
   spawns (stale saves, migrated v1 heights) and fluid spawns, without
   teleporting legit standing positions. */
function rescueSpawn(){
  const px = Math.floor(player.pos.x), pz = Math.floor(player.pos.z);
  const feet = M.getBlock(px, Math.floor(player.pos.y + .05), pz);
  const head = M.getBlock(px, Math.floor(player.pos.y + 1.5), pz);
  const under = M.getBlock(px, Math.floor(player.pos.y - .2), pz);
  const embedded = M.isSolidId(feet) || M.isSolidId(head);
  const inFluid = under === B.WATER || under === B.LAVA;
  if (!embedded && !inFluid){ rescueTries = 0; return; }
  if (DIM.cur === 0){
    if (rescueTries++ < 12){
      spawnPlayer();
      primed = false;                      // the new spot's 3×3 may not exist yet — wait, then re-check
      M.ui && M.ui.showLoading && M.ui.showLoading();
      return;
    }
    // last resort after 12 retries: stand on the real surface from chunk data
    // (heightAt lies under structures/cave mouths — sampling actual blocks can't)
    let ty = -1;
    for (let y = HGT-3; y >= 1; y--){
      if (M.isSolidId(M.getBlock(px, y, pz)) && !M.isSolidId(M.getBlock(px, y+1, pz)) && !M.isSolidId(M.getBlock(px, y+2, pz))){ ty = y; break; }
    }
    player.pos.y = (ty >= 0 ? ty : M.heightAt(px, pz)) + 1.05;
    player.vel.set(0, 0, 0);
    rescueTries = 0;
    stuckT = 0;
    return;
  }
  // other dims: arrival pockets are stamped as edits — nudge up into the nearest free cell
  let ny = Math.floor(player.pos.y);
  for (let i = 0; i < 24; i++){
    const a = M.getBlock(px, ny, pz), b = M.getBlock(px, ny + 1, pz), floorB = M.getBlock(px, ny - 1, pz);
    if (!M.isSolidId(a) && !M.isSolidId(b) && M.isSolidId(floorB)) break;
    ny++;
  }
  player.pos.y = ny + .05;
  player.vel.set(0, 0, 0);
  rescueTries = 0;
}

/* ---------- sky / day-night ---------- */
function applySky(){
  const d = DIM.cur;
  scene.fog = new THREE.Fog(DIM_SKY[d].day, 60, Math.max(120, settings.dist*CH*1.6));
  updateSkyNow();
}
function updateSkyNow(){
  const d = DIM.cur;
  const sk = DIM_SKY[d];
  let dayF = 1, skyC = new THREE.Color(sk.day);
  if (d === 0){
    const ang = worldTime * Math.PI * 2;
    dayF = Math.max(0, Math.sin(ang)) ;             // 0 at midnight, 1 at noon
    const b = .18 + .82 * Math.pow(dayF, .7);
    skyC = new THREE.Color(sk.night).lerp(new THREE.Color(sk.day), Math.pow(dayF, .6));
    scene.fog.color = new THREE.Color(sk.fogN).lerp(new THREE.Color(sk.fogD), Math.pow(dayF, .6));
    scene.background = scene.fog.color;
    matSolid.color.setScalar(b); matWater.color.setScalar(b); matTrans.color.setScalar(b);
    // sun/moon orbit
    const R = 380;
    sunSpr.position.set(camera.position.x + Math.cos(ang - Math.PI/2)*R*.2, camera.position.y + Math.sin(ang)*R*.9, camera.position.z + Math.cos(ang)*R);
    moonSpr.position.set(camera.position.x - Math.cos(ang - Math.PI/2)*R*.2, camera.position.y - Math.sin(ang)*R*.9, camera.position.z - Math.cos(ang)*R);
    sunSpr.visible = dayF > -.15 && Math.sin(ang) > -.3;
    moonSpr.visible = Math.sin(ang) < .25;
    stars.material.opacity = Math.max(0, .9 - dayF*1.4);
    stars.position.copy(camera.position);
    stars.visible = true;
    cloudGrp.visible = true;
  } else {
    scene.fog.color = new THREE.Color(sk.fogD);
    scene.background = new THREE.Color(sk.day);
    matSolid.color.setScalar(1); matWater.color.setScalar(1); matTrans.color.setScalar(1);
    sunSpr.visible = false; moonSpr.visible = false;
    stars.visible = d === 2;
    if (d === 2){ stars.position.copy(camera.position); stars.material.opacity = .8; }
    cloudGrp.visible = d === 0;
  }
}

/* ---------- physics ---------- */
function aabbCollides(px, py, pz){
  const w = player.w;
  const x0 = Math.floor(px-w), x1 = Math.floor(px+w);
  const y0 = Math.floor(py),   y1 = Math.floor(py+player.h-.01);
  const z0 = Math.floor(pz-w), z1 = Math.floor(pz+w);
  for (let x=x0; x<=x1; x++) for (let y=y0; y<=y1; y++) for (let z=z0; z<=z1; z++){
    if (M.isSolidId(M.getBlock(x, y, z))) return true;
  }
  return false;
}
let stickVec = { x:0, y:0, active:false };
M.stickVec = stickVec;
function movePlayer(dt){
  let ix=0, iz=0;
  if (keys.has('KeyW')) iz -= 1;
  if (keys.has('KeyS')) iz += 1;
  if (keys.has('KeyA')) ix -= 1;
  if (keys.has('KeyD')) ix += 1;
  if (stickVec.active){ ix = stickVec.x; iz = stickVec.y; }
  const len = Math.hypot(ix, iz);
  if (len > 1){ ix /= len; iz /= len; }
  const sprint = keys.has('ControlLeft') || keys.has('KeyR');
  const bodyIn = M.getBlock(Math.floor(player.pos.x), Math.floor(player.pos.y+.4), Math.floor(player.pos.z));
  const headIn = M.getBlock(Math.floor(player.pos.x), Math.floor(player.pos.y+player.eye), Math.floor(player.pos.z));
  player.inWater = bodyIn === B.WATER;
  player.inLava = bodyIn === B.LAVA || headIn === B.LAVA;
  const buoy = player.inWater || player.inLava;

  let speed = player.flying ? (sprint?24:11) : (player.inLava ? 1.6 : (player.inWater ? 3.4 : (sprint?7.2:4.6)));
  camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
  const fwd = new THREE.Vector3(0,0,-1).applyEuler(camera.rotation); fwd.y = 0;
  if (fwd.lengthSq() < 1e-8) fwd.set(0,0,-1);
  fwd.normalize();
  const right = new THREE.Vector3(1,0,0).applyEuler(camera.rotation); right.y = 0; right.normalize();
  const dx = (right.x*ix - fwd.x*iz);
  const dz = (right.z*ix - fwd.z*iz);

  const aH = player.onGround||player.flying||buoy ? 14 : 4;
  player.vel.x += (dx*speed - player.vel.x) * Math.min(1, aH*dt);
  player.vel.z += (dz*speed - player.vel.z) * Math.min(1, aH*dt);

  if (player.flying){
    let vy = 0;
    if (keys.has('Space')) vy = speed;
    if (keys.has('ShiftLeft')||keys.has('ShiftRight')) vy = -speed;
    player.vel.y += (vy - player.vel.y) * Math.min(1, 12*dt);
  } else if (player.inLava){
    player.vel.y += (-1.1 - player.vel.y) * Math.min(1, 4*dt);
    if (keys.has('Space')) player.vel.y = Math.min(player.vel.y + 16*dt, 1.4);
  } else if (player.inWater){
    player.vel.y += (-.9 - player.vel.y*1.7) * Math.min(1, 5*dt);
    if (keys.has('Space')) player.vel.y = Math.min(player.vel.y + 22*dt, 2.6);
  } else {
    player.vel.y -= 26*dt;
    if (player.vel.y < -42) player.vel.y = -42;
    if (keys.has('Space') && player.onGround){ player.vel.y = 8.6; player.onGround = false; sfx('jump'); }
  }

  const total = player.vel.clone().multiplyScalar(dt);
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(total.x), Math.abs(total.y), Math.abs(total.z)) / .4));
  const s = total.divideScalar(steps);
  const wasGround = player.onGround;
  player.onGround = false;
  for (let i=0; i<steps; i++){
    player.pos.x += s.x;
    if (aabbCollides(player.pos.x, player.pos.y, player.pos.z)){ player.pos.x -= s.x; player.vel.x = 0; }
    player.pos.z += s.z;
    if (aabbCollides(player.pos.x, player.pos.y, player.pos.z)){ player.pos.z -= s.z; player.vel.z = 0; }
    player.pos.y += s.y;
    if (aabbCollides(player.pos.x, player.pos.y, player.pos.z)){
      if (s.y < 0) player.onGround = true;
      player.pos.y -= s.y;
      player.vel.y = 0;
    }
  }
  // fall damage (survival, not while flying/water)
  if (player.onGround && !wasGround && worldMeta && worldMeta.mode === 'survival' && !player.flying && !buoy){
    if (player.fallY != null){
      const dmg = Math.floor(player.fallY - player.pos.y - 3.2);
      if (dmg > 0) hurt(dmg);
    }
  }
  if (player.onGround || player.flying || buoy) player.fallY = null;
  else if (player.vel.y < 0) player.fallY = Math.max(player.fallY ?? player.pos.y, player.pos.y);

  // world border clamp (±30M like the real thing)
  const bx = M.WORLD_BORDER;
  player.pos.x = Math.max(-bx, Math.min(bx, player.pos.x));
  player.pos.z = Math.max(-bx, Math.min(bx, player.pos.z));
}

/* ---------- survival damage ---------- */
function hurt(n){
  if (worldMeta.mode !== 'survival' || player.dead) return;
  player.hp = Math.max(0, player.hp - n);
  player.regenT = 0; player.hurtT = 4;
  sfx('hurt');
  M.ui && M.ui.hurtFlash();
  M.ui && M.ui.hudHearts();
  if (player.hp <= 0) die();
}
function die(){
  player.dead = true;
  M.ui && M.ui.showDeath();
}
function respawn(){
  switchDimHome();
  M.ui && M.ui.hideDeath();
}
function tickSurvival(dt){
  if (worldMeta.mode !== 'survival') return;
  if (player.dead) return;
  // drowning
  const headIn = M.getBlock(Math.floor(player.pos.x), Math.floor(player.pos.y+player.eye), Math.floor(player.pos.z));
  if (headIn === B.WATER){
    player.air -= dt;
    if (player.air < 0){ player.air = 0; player.drownAcc = (player.drownAcc||0) + dt; if (player.drownAcc > 1){ player.drownAcc = 0; hurt(2); } }
  } else { player.air = 10; player.drownAcc = 0; }
  M.ui && M.ui.hudAir();
  // lava burns
  if (player.inLava){ player.lavaAcc = (player.lavaAcc||0) + dt; if (player.lavaAcc > .5){ player.lavaAcc = 0; hurt(3); } }
  // void
  if (DIM.cur === 2 && player.pos.y < -6){ hurt(50); }
  if (player.pos.y < -20) hurt(50);
  // regen
  player.hurtT = Math.max(0, player.hurtT - dt);
  if (player.hp < 20 && player.hurtT <= 0){
    player.regenT += dt;
    if (player.regenT > 4){ player.regenT = 0; player.hp = Math.min(20, player.hp+1); M.ui && M.ui.hudHearts(); }
  }
}

/* ---------- mining (survival hold) ---------- */
let mineTarget = null, mineProgress = 0, mineHold = false, mineTimer = 0;
function setMineHold(v){
  mineHold = v;
  if (!v){ mineTarget = null; mineProgress = 0; crackMesh.visible = false; }
}
function tickMining(dt){
  if (!mineHold || worldMeta.mode !== 'survival'){ crackMesh.visible = false; return; }
  const t = targetVoxel();
  if (!t){ mineTarget = null; mineProgress = 0; crackMesh.visible = false; return; }
  if (!mineTarget || mineTarget.x !== t.x || mineTarget.y !== t.y || mineTarget.z !== t.z){
    mineTarget = t; mineProgress = 0;
  }
  const info = breakInfo(t.id);
  if (!info || info.blocked){
    crackMesh.visible = false;
    if (info && info.blocked && (mineTimer += dt) > 1){ mineTimer = 0; toastish('need a ' + ['','wood','stone','iron','diamond'][info.need] + ' pickaxe'); }
    return;
  }
  mineProgress += dt / info.seconds;
  const stage = Math.min(3, Math.floor(mineProgress*4));
  crackMesh.visible = true;
  crackMesh.material = crackMats[stage];
  crackMesh.position.set(t.x+.5, t.y+.5, t.z+.5);
  if (mineProgress >= 1){ doBreak(t); mineTarget = null; mineProgress = 0; crackMesh.visible = false; }
}

/* ---------- save / load ---------- */
const worldsKey = 'mchtml.worlds';
const wKey = (name) => 'mchtml.w.' + name;
function listWorlds(){
  try { return JSON.parse(localStorage.getItem(worldsKey) || '[]'); } catch(e){ return []; }
}
function saveWorldsIndex(list){ localStorage.setItem(worldsKey, JSON.stringify(list)); }
function deleteWorld(name){
  try { localStorage.removeItem(wKey(name)); } catch(e){}
  saveWorldsIndex(listWorlds().filter(w => w.name !== name));
}
function saveNow(){
  if (!worldMeta) return;
  const data = {
    v: 2, name: worldMeta.name, seed: M.SEED, mode: worldMeta.mode,
    dim: DIM.cur, time: worldTime,
    player: { x: player.pos.x, y: player.pos.y, z: player.pos.z, yaw: player.yaw, pitch: player.pitch, fly: player.flying, hp: player.hp, sel: selected },
    inv: inv.map(s => s ? [s.id, s.count] : 0),
    edits: Object.fromEntries(edits),
    portals: [...portalLinks.entries()],
    furnaces: [...furnaces.entries()].map(([k, f]) => [k, f.i?[f.i.id,f.i.count]:0, f.f?[f.f.id,f.f.count]:0, f.o?[f.o.id,f.o.count]:0, f.burn, f.maxBurn, f.prog]),
    settings: { sens: settings.sens, invertY: settings.invertY, touch: settings.touch, dist: settings.dist },
  };
  try { localStorage.setItem(wKey(worldMeta.name), JSON.stringify(data)); } catch(e){}
}
function saveSoon(){ clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 2500); }
function loadWorld(name){
  let data;
  try { data = JSON.parse(localStorage.getItem(wKey(name))); } catch(e){}
  if (!data || data.v !== 2) return null;
  return data;
}
function migrateV1(){
  try {
    const v1 = JSON.parse(localStorage.getItem('mchtml.save.v1') || 'null');
    if (!v1 || !Number.isInteger(v1.seed)) return;
    if (listWorlds().some(w => w.name === 'My World')) return;
    const edits2 = {};
    if (v1.edits) for (const k in v1.edits) edits2['0:' + k] = v1.edits[k];
    const data = { v: 2, name: 'My World', seed: v1.seed, mode: 'creative', dim: 0, time: .3,
      player: null,                       // v1 terrain heights don't match v2 — spawn fresh at the surface
      inv: [], edits: edits2, portals: [], furnaces: [], settings: v1.settings || null };
    localStorage.setItem(wKey('My World'), JSON.stringify(data));
    saveWorldsIndex([...listWorlds(), { name: 'My World', seed: v1.seed, mode: 'creative', ts: Date.now() }]);
  } catch(e){}
}

/* ---------- start a world ---------- */
function startWorld(meta){
  worldMeta = meta;
  M.setSeed(meta.seed);
  M.DIM.cur = 0;
  M.clearChunks();                       // dispose old world's meshes — bare chunks.clear() would leave ghost terrain in the scene
  edits.clear(); portalLinks.clear(); furnaces.clear();
  M.rsRebuildLists(0);
  worldTime = .3;
  for (let i=0; i<36; i++) inv[i] = null;
  player.hp = 20; player.air = 10; player.dead = false;
  const save = loadWorld(meta.name);
  if (save){
    worldTime = save.time ?? .3;
    for (const k in save.edits) edits.set(k, save.edits[k]);
    for (const [k, v] of (save.portals || [])) portalLinks.set(k, v);
    for (const [k, i, f, o, burn, maxBurn, prog] of (save.furnaces || []))
      furnaces.set(k, { i: i?[i[0],i[1]]:null, f: f?[f[0],f[1]]:null, o: o?[o[0],o[1]]:null, burn: burn||0, maxBurn: maxBurn||1, prog: prog||0 });
    if (save.inv) save.inv.forEach((s, i) => { inv[i] = s ? { id: s[0], count: s[1] } : null; });
    if (save.settings) Object.assign(settings, save.settings);
    if (save.player){
      player.pos.set(save.player.x, save.player.y, save.player.z);
      player.yaw = save.player.yaw || 0; player.pitch = save.player.pitch || 0;
      player.flying = !!save.player.fly;
      player.hp = save.player.hp ?? 20;
      setSel(save.player.sel ?? 0);
    } else spawnPlayer();
    DIM.cur = save.dim || 0;
  } else {
    spawnPlayer();
    if (meta.mode === 'survival'){ /* empty inventory */ }
    else {
      const palette = [B.GRASS, B.DIRT, B.STONE, B.COBBLE, B.SAND, B.LOG, B.PLANK, B.GLASS, B.LAMP];
      palette.forEach((id, i) => { inv[i] = { id, count: 64 }; });
    }
  }
  if (meta.mode === 'survival' && !save) player.flying = false;
  M.rsRebuildLists(DIM.cur);
  applySky();
  M.ui && M.ui.hudAll();
  primed = false;                          // world entry re-gates sim + spawn rescue, same as a dimension switch
  M.ui && M.ui.showLoading && M.ui.showLoading();
  saveNow();
}

/* ---------- input ---------- */
let mouseDown = 0, repeatPlace = 0;
function setupInput(){
  const canvas = document.getElementById('view');
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('mousedown', e => {
    if (!started){ return; }
    if (paused || player.dead) return;
    if (document.pointerLockElement !== canvas && !isTouchActive()){ pointerLock(); return; }
    if (e.button === 0){
      mouseDown |= 1;
      if (worldMeta.mode === 'creative') breakBlock(); else setMineHold(true);
    }
    if (e.button === 1){ const t = targetVoxel(); if (t && worldMeta.mode === 'creative'){ /* pick */ const idx = M.CREATIVE_PALETTE.indexOf(t.id); } }
    if (e.button === 2){
      mouseDown |= 2;
      const t = targetVoxel();
      if (t && tryIgnite(t)) return;
      placeBlock();
    }
  });
  addEventListener('mouseup', e => {
    if (e.button === 0){ mouseDown &= ~1; setMineHold(false); }
    if (e.button === 2) mouseDown &= ~2;
  });
  addEventListener('mousemove', e => {
    if (document.pointerLockElement !== canvas || paused) return;
    player.yaw -= e.movementX * .0024 * settings.sens;
    player.pitch -= e.movementY * .0024 * settings.sens * (settings.invertY ? -1 : 1);
    player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch));
  });
  addEventListener('wheel', e => {
    if (!started || paused) return;
    setSel((selected + (e.deltaY > 0 ? 1 : -1) + 9) % 9);
  }, { passive: true });
  addEventListener('keydown', e => {
    if (!started) return;
    if (e.code === 'Escape'){ M.ui.togglePause(); return; }
    if (paused) return;
    keys.add(e.code);
    if (e.code === 'Space'){
      e.preventDefault();
      if (worldMeta.mode !== 'creative') return;
      if (e.repeat) return;
      const now = performance.now();
      if (now - lastSpace < 280){ player.flying = !player.flying; player.vel.y = 0; toastish(player.flying ? 'flight on' : 'flight off'); }
      lastSpace = now;
    }
    if (e.code === 'KeyE'){ e.preventDefault(); M.ui.toggleInventory(); }
    const num = e.code.match(/^Digit([0-9])$/);
    if (num){ const i = num[1] === '0' ? 9 : +num[1]-1; if (i < 9) setSel(i); }
  });
  addEventListener('keyup', e => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());
  addEventListener('beforeunload', () => { if (started) saveNow(); });
}
function pointerLock(){
  const canvas = document.getElementById('view');
  try {
    const p = canvas.requestPointerLock && canvas.requestPointerLock();
    if (p && p.catch) p.catch(() => {});
  } catch(e){}
}
/* touch controls press/release virtual keys */
function setKey(code, down){ if (down) keys.add(code); else keys.delete(code); }
function isTouchActive(){ return settings.touch === true || (settings.touch === null && 'ontouchstart' in window && matchMedia('(pointer: coarse)').matches); }

function toastish(msg){ M.ui && M.ui.toast(msg); }

/* ---------- main loop ---------- */
let last = performance.now(), fpsAcc = 0, fpsN = 0, fpsT = 0;
function loop(now){
  requestAnimationFrame(loop);
  let dt = Math.max(0, Math.min(.05, (now - last)/1000)); last = now;
  const { made, meshed } = M.pumpChunks(buildChunkMesh, null, player, settings.dist, THREE);
  if (!primed){
    if (M.chunksReadyForSpawn()){
      primed = true;
      M.ui && M.ui.hideLoading();
      rescueSpawn();
    } else M.ui && M.ui.loadingBar();
  }
  if (running && primed && !paused && !player.dead){
    movePlayer(dt);
    // stuck-in-solid watchdog: catches every way a player can end up embedded
    // (stale saves, carved surfaces, bad portal stamps). Solid at feet or head
    // → run the rescue cycle. Swimmers/diggers never trigger (their cells are air).
    stuckT += dt;
    if (stuckT > 1.5){
      stuckT = 0;
      const bx = Math.floor(player.pos.x), bz = Math.floor(player.pos.z);
      const sf = M.getBlock(bx, Math.floor(player.pos.y + .05), bz);
      const sh = M.getBlock(bx, Math.floor(player.pos.y + 1.5), bz);
      if (M.isSolidId(sf) || M.isSolidId(sh)) rescueSpawn();
    }
    tickSurvival(dt);
    tickMining(dt);
    tickFurnaces(dt);
    checkPortal(dt);
    updateParticles(dt);
    netTick(now);
    const hv = targetVoxel();
    if (hv){ hiBox.visible = true; hiBox.position.set(hv.x+.5, hv.y+.5, hv.z+.5); }
    else hiBox.visible = false;
    // creative: hold LMB breaks repeatedly
    if (mouseDown & 1){ mineTimer += dt; if (mineTimer > .25){ mineTimer = 0; if (worldMeta.mode === 'creative') breakBlock(); } }
    if (mouseDown & 2){ repeatPlace += dt; if (repeatPlace > .25){ repeatPlace = 0; placeBlock(); } }
  }
  // day cycle + sky
  if (DIM.cur === 0) worldTime = (worldTime + dt/600) % 1;
  cloudsDrift(dt);
  if (Math.floor(now/100) !== fpsT){ fpsT = Math.floor(now/100); updateSkyNow(); }
  renderer.render(scene, camera);
  fpsAcc += dt; fpsN++;
  if (fpsN >= 30){ M.ui && M.ui.hudFps(fpsN/fpsAcc); fpsAcc = 0; fpsN = 0; }
}
let primed = false;
let rescueTries = 0;                       // spawn-rescue retry budget (re-spiral can land on another bad column)
let stuckT = 0;                            // embedded-watchdog timer (runs every 1.5s while playing)
function cloudsDrift(dt){
  cloudGrp.children.forEach(c => {
    c.position.x += dt*1.2;
    if (c.position.x - camera.position.x > 260) c.position.x -= 520;
  });
}

/* ---------- multiplayer hooks ---------- */
function netTick(now){
  if (M.mpActive && M.mpActive()) M.netPositionTick(now);
}
function buildChunkMesh(c, THREE){
  const built = M.buildMesh(c.cx, c.cz, THREE);
  c.data = built.data;
  c.sources = built.sources;
  for (const m of [c.mesh, c.meshW, c.meshT]) if (m){ scene.remove(m); m.geometry.dispose(); }
  const mk = (g, mat) => {
    if (!g.idx.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(g.col, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uvs, 2));
    geo.setIndex(g.idx);
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);
    return mesh;
  };
  c.mesh = mk(built.g, matSolid);
  c.meshW = mk(built.w, matWater);
  c.meshT = mk(built.t, matTrans);
  c.dirty = false;
}

/* ---------- net broadcast helpers (mp.js fills the transport) ---------- */
M.netBroadcastEdit = (d, x, y, z, id) => { if (M.mpActive && M.mpActive()) M.netSend({ t: 'e', d, x, y, z, id }); };
M.netBroadcast = (m) => { if (M.mpActive && M.mpActive()) M.netSend(m); };
M.netPositionTick = (now) => {
  if (now - (M._lastPos || 0) < 66) return;
  M._lastPos = now;
  M.netSend({ t: 'p', pid: M.mpPid(), x: +player.pos.x.toFixed(2), y: +player.pos.y.toFixed(2), z: +player.pos.z.toFixed(2), yaw: +player.yaw.toFixed(2), pitch: +player.pitch.toFixed(2), d: DIM.cur });
};

/* ---------- QA surface ---------- */
M.game = {
  get player(){ return player; }, get worldMeta(){ return worldMeta; }, get inv(){ return inv; },
  get selected(){ return selected; }, settings, furnaces, portalLinks, get worldTime(){ return worldTime; },
  startWorld, saveNow, spawnPlayer, switchDim, respawn, setSel, addInv, takeInv, countInv,
  breakInfo, placeAt, tryIgnite, linkPortal, stampArrival, endArrival, buildChunkMesh, loop, setupScene,
  get primed(){ return primed; }, set primed(v){ primed = v; },
  setRunning(v){ running = v; }, get running(){ return running; },
  setPaused(v){ paused = v; }, get paused(){ return paused; },
  setStarted(v){ started = v; }, get started(){ return started; },
  setMineHold, hurt, placeBlock, breakBlock, doBreak,
  listWorlds, saveWorldsIndex, deleteWorld, migrateV1, furnaceState, fuelValue,
  setKey, isTouchActive, sfx, lock: pointerLock, toastish,
};
M.step = (dt = .016) => { running = true; movePlayer(dt); updateParticles(dt); };
M.settleFrom && (M.settleFrom);

/* boot */
addEventListener('load', () => {
  setupScene();
  setupInput();
  migrateV1();
  M.ui && M.ui.boot();
  requestAnimationFrame(loop);
});
})();
