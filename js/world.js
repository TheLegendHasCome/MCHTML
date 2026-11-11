/* MCHTML v2.0 — world.js
   Noise, dimension generators (overworld / nether / end), chunk store,
   mesher with baked AO + sky/block lighting, falling sand, redstone power. */
window.MCH = window.MCH || {};
(function(){
const { B, BINFO, OPAQUE, SOLID, LIGHT_EMIT, RS_KIND, buildAtlas } = MCH;

/* ---------- constants ---------- */
const CH = 16, HGT = 96, SEA = 40, SNOW = 72;
const WORLD_BORDER = 30000000;              // Minecraft-grade border, ±30M blocks
const cIdx = (x,y,z) => (y*CH + z)*CH + x;

/* ---------- noise ---------- */
/* Math.imul keeps every multiply exact in 32 bits, so the noise stays
   deterministic all the way out to the world border (plain * overflows
   double precision past ~2^53) */
let SEED = 1;
function hash2(x, y, salt){
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(salt, 974711) ^ Math.imul(SEED, 144665);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function hash3(x, y, z, salt){
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647) ^ Math.imul(salt, 974711) ^ Math.imul(SEED, 144665);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/* seed setter: worlds can differ at runtime; must reset the height cache */
function setSeed(s){
  SEED = (s | 0) || 1;
  MCH.SEED = SEED;
  hCache.clear();
}
const sm = t => t*t*(3-2*t);
function vnoise2(x, z, salt){
  const xi = Math.floor(x), zi = Math.floor(z), xf = x-xi, zf = z-zi;
  const a = hash2(xi,zi,salt), b = hash2(xi+1,zi,salt), c = hash2(xi,zi+1,salt), d = hash2(xi+1,zi+1,salt);
  const u = sm(xf), v = sm(zf);
  return a + (b-a)*u + (c-a)*v + (a-b-c+d)*u*v;
}
function vnoise3(x, y, z, salt){
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x-xi, yf = y-yi, zf = z-zi, u = sm(xf), v = sm(yf), w = sm(zf);
  const n000 = hash3(xi,yi,zi,salt),     n100 = hash3(xi+1,yi,zi,salt);
  const n010 = hash3(xi,yi+1,zi,salt),   n110 = hash3(xi+1,yi+1,zi,salt);
  const n001 = hash3(xi,yi,zi+1,salt),   n101 = hash3(xi+1,yi,zi+1,salt);
  const n011 = hash3(xi,yi+1,zi+1,salt), n111 = hash3(xi+1,yi+1,zi+1,salt);
  const x00 = n000+(n100-n000)*u, x10 = n010+(n110-n010)*u;
  const x01 = n001+(n101-n001)*u, x11 = n011+(n111-n011)*u;
  const y0 = x00+(x10-x00)*v, y1 = x01+(x11-x01)*v;
  return y0 + (y1-y0)*w;
}
function fbm2(x, z, oct, salt, lac=2, gain=.5){
  let a = 0, amp = 1, tot = 0;
  for (let i=0;i<oct;i++){ a += vnoise2(x, z, salt+i*77)*amp; tot += amp; x*=lac; z*=lac; amp*=gain; }
  return a/tot;
}
function fbm3(x, y, z, oct, salt, lac=2, gain=.5){
  let a = 0, amp = 1, tot = 0;
  for (let i=0;i<oct;i++){ a += vnoise3(x, y, z, salt+i*77)*amp; tot += amp; x*=lac; y*=lac; z*=lac; amp*=gain; }
  return a/tot;
}
function ridged2(x, z, oct, salt){
  let a = 0, amp = 1, tot = 0;
  for (let i=0;i<oct;i++){ const n = vnoise2(x, z, salt+i*77); a += (1 - Math.abs(n*2-1))*amp; tot += amp; x*=2.03; z*=2.03; amp*=.5; }
  return a/tot;
}

/* ---------- overworld terrain ---------- */
const hCache = new Map();
function heightAt(x, z){
  const k = x+','+z;
  let v = hCache.get(k);
  if (v !== undefined) return v;
  const cont = fbm2(x*.0032, z*.0032, 4, 11);                 // continents
  const rid  = ridged2(x*.0042+7.3, z*.0042-3.1, 4, 29);      // mountain ridges
  const mask = Math.max(0, fbm2(x*.0016+41.7, z*.0016+13.9, 2, 47) - .52) * 2.6; // where ranges live
  let h = 34 + (cont-.5)*34;                                  // rolling base 17..51
  h += Math.pow(rid, 2.1) * mask * 52;                        // ridged peaks on the mask
  h |= 0;
  if (h < 6) h = 6;
  if (h >= HGT-4) h = HGT-4;
  if (hCache.size > 60000) hCache.clear();
  hCache.set(k, v = h);
  return v;
}
const surfaceBlock = (h) => h <= SEA+1 ? B.SAND : (h >= SNOW ? B.SNOW : B.GRASS);

/* caves: cheese caverns + spaghetti tunnels; keep ocean floors intact */
function carved(x, y, z, h){
  if (h <= SEA+1) return false;                    // no carving under water columns
  if (y < 7 || y > h) return false;
  const cheese = fbm3(x*.017, y*.028, z*.017, 3, 61);
  if (cheese > .635) return true;
  const t1 = vnoise3(x*.014, y*.02, z*.014, 83), t2 = vnoise3(x*.014+9.1, y*.02, z*.014+4.7, 97);
  const band = Math.abs(t1-.5) + Math.abs(t2-.5);
  if (band < .085) return true;
  return false;
}
/* ore sprinkle: vein-ish 2×2×2 clusters */
function oreAt(x, y, z){
  const cl = (salt) => hash3(x>>1, y>>1, z>>1, salt);
  const fine = (salt) => hash3(x, y, z, salt);
  if (y < 14 && cl(201) < .020 && fine(202) < .75) return B.DIAMOND;
  if (y < 24 && cl(211) < .028 && fine(212) < .7)  return B.REDSTONE;
  if (y < 30 && cl(221) < .024 && fine(222) < .7)  return B.GOLD;
  if (y < 52 && cl(231) < .040 && fine(232) < .75) return B.IRON;
  if (y < 78 && cl(241) < .055 && fine(242) < .8)  return B.COAL;
  return B.STONE;
}
/* deterministic oak placement: local-max hash grid, only on dry grass */
function isTreeAt(x, z){
  const h0 = hash2(x, z, 301);
  if (h0 < .985) return 0;
  for (let dx=-2; dx<=2; dx++) for (let dz=-2; dz<=2; dz++){
    if (!dx && !dz) continue;
    if (hash2(x+dx, z+dz, 301) > h0) return 0;
  }
  const h = heightAt(x, z);
  if (h <= SEA+2 || h >= SNOW-4) return 0;
  if (carved(x, h, z, h)) return 0;
  return 4 + ((hash2(x, z, 307)*3)|0);
}

/* ---------- structures ---------- */
/* every structure is a pure function of (region hash, seed) so chunks stay
   independent; stamping happens per chunk with margin scanning */
function flatEnough(x, z, r){
  const h0 = heightAt(x, z);
  for (const [dx, dz] of [[r,0],[-r,0],[0,r],[0,-r],[r,r],[-r,-r],[r,-r],[-r,r]]){
    const h = heightAt(x+dx, z+dz);
    if (Math.abs(h - h0) > 2) return 0;
  }
  if (h0 <= SEA+2 || h0 >= SNOW-8) return 0;
  if (carved(x, h0, z, h0)) return 0;
  return h0;
}
/* one hut: 7×7 cobble floor, plank walls 3 high with log corners, plank roof,
   south door gap, glass windows, torch inside */
function hutCells(hx, hz, h){
  const cells = [];
  const put = (x, y, z, id) => cells.push([x, y, z, id]);
  for (let dx=-3; dx<=3; dx++) for (let dz=-3; dz<=3; dz++){
    put(hx+dx, h, hz+dz, B.COBBLE);
    put(hx+dx, h+4, hz+dz, B.PLANK);                       // roof
  }
  for (let dy=1; dy<=3; dy++) for (let dx=-3; dx<=3; dx++) for (let dz=-3; dz<=3; dz++){
    const edge = Math.max(Math.abs(dx), Math.abs(dz)) === 3;
    if (!edge) { put(hx+dx, h+dy, hz+dz, B.AIR); continue; }
    const corner = Math.abs(dx) === 3 && Math.abs(dz) === 3;
    const isDoor = dz === 3 && dx === 0 && dy <= 2;        // south doorway
    const isWindow = dy === 2 && ((dx === 3 || dx === -3) && dz === 0 || (dz === -3) && Math.abs(dx) === 0);
    if (isDoor) continue;
    put(hx+dx, h+dy, hz+dz, corner ? B.LOG : (isWindow ? B.GLASS : B.PLANK));
  }
  put(hx, h+1, hz, B.TORCH);
  return cells;
}
function villageCells(rx, rz){
  if (hash2(rx, rz, 601) > .38) return null;
  const cells = [];
  const n = 2 + ((hash2(rx, rz, 607)*2)|0);                // 2-3 huts
  for (let k=0; k<n; k++){
    const hx = rx*96 + 24 + ((hash2(rx, rz, 611+k*3)*48)|0);
    const hz = rz*96 + 24 + ((hash2(rx, rz, 613+k*3)*48)|0);
    const h = flatEnough(hx, hz, 5);
    if (!h) continue;
    cells.push(...hutCells(hx, hz, h));
  }
  return cells.length ? cells : null;
}
/* nether: ruined nether-brick towers on cavern floors */
function towerCells(rx, rz){
  if (hash2(rx, rz, 701) > .30) return null;
  const tx = rx*128 + 30 + ((hash2(rx, rz, 703)*68)|0);
  const tz = rz*128 + 30 + ((hash2(rx, rz, 705)*68)|0);
  let fy = -1;
  for (let y=14; y<86; y++){
    const here = cellAt(1, tx, y, tz);
    const up1 = cellAt(1, tx, y+1, tz), up2 = cellAt(1, tx, y+2, tz), up3 = cellAt(1, tx, y+3, tz);
    if ((here === B.NETHERRACK || here === B.SOUL) && up1 === B.AIR && up2 === B.AIR && up3 === B.AIR){ fy = y+1; break; }
  }
  if (fy < 0 || fy > 74) return null;
  const cells = [];
  for (let dx=-3; dx<=3; dx++) for (let dz=-3; dz<=3; dz++) cells.push([tx+dx, fy, tz+dz, B.NBRICK]);
  for (let dy=1; dy<=6; dy++) for (let dx=-3; dx<=3; dx++) for (let dz=-3; dz<=3; dz++){
    if (Math.max(Math.abs(dx), Math.abs(dz)) !== 3) continue;
    if (hash3(tx+dx, fy+dy, tz+dz, 707) < .28) continue;    // ruins
    if (dz === 3 && dx === 0 && dy <= 2) continue;          // doorway
    cells.push([tx+dx, fy+dy, tz+dz, B.NBRICK]);
  }
  for (const [dx, dz] of [[-3,-3],[3,-3],[-3,3],[3,3]]) cells.push([tx+dx, fy+7, tz+dz, B.GLOWSTONE]);
  return cells;
}
function stampStructures(data, cx, cz, d){
  const bx = cx*CH, bz = cz*CH;
  const margin = 10;
  const structFns = (d === 0) ? [(rx, rz) => villageCells(rx, rz)]
              : (d === 1) ? [(rx, rz) => towerCells(rx, rz)]
              : [];
  for (const fn of structFns){
    const span = d === 0 ? 96 : 128;
    const r0x = Math.floor((bx - margin) / span), r1x = Math.floor((bx + CH + margin) / span);
    const r0z = Math.floor((bz - margin) / span), r1z = Math.floor((bz + CH + margin) / span);
    for (let rx=r0x; rx<=r1x; rx++) for (let rz=r0z; rz<=r1z; rz++){
      const cells = fn(rx, rz);
      if (!cells) continue;
      for (const [x, y, z, id] of cells){
        const lx = x - bx, lz = z - bz;
        if (lx < 0 || lx >= CH || lz < 0 || lz >= CH || y < 0 || y >= HGT) continue;
        data[cIdx(lx, y, lz)] = id;
      }
    }
  }
}

/* ---------- dimension generators (pure: cell → block) ---------- */
function overCell(x, y, z){
  const h = heightAt(x, z);
  if (y === 0) return B.BEDROCK;
  if (y > h) return (y <= SEA) ? B.WATER : B.AIR;
  if (carved(x, y, z, h)) return (y <= 10) ? B.LAVA : B.AIR;
  if (y === h) return surfaceBlock(h);
  if (y >= h-3) return (surfaceBlock(h)===B.SAND ? B.SAND : surfaceBlock(h)===B.SNOW ? B.STONE : B.DIRT);
  return oreAt(x, y, z);
}
function netherCell(x, y, z){
  if (y <= 1 || y >= HGT-2) return B.BEDROCK;
  const d = fbm3(x*.021, y*.031, z*.021, 3, 401);
  const open = d > .52 - Math.abs(y - 44)*.004;    // big mid caverns, denser shell
  if (!open){
    if (vnoise3(x*.05, y*.05, z*.05, 407) > .72) return B.SOUL;
    return B.NETHERRACK;
  }
  if (y <= 36) return B.LAVA;
  // glowstone hangs from ceilings
  const above = netherCell(x, y+1, z);
  if (above !== B.AIR && above !== B.LAVA && hash3(x, y, z, 411) < .05) return B.GLOWSTONE;
  return B.AIR;
}
function endCell(x, y, z){
  const r = Math.hypot(x, z);
  if (r > 92) return B.AIR;
  const top = 58 + fbm2(x*.021+5, z*.021-3, 3, 501)*9 - Math.pow(r/92, 2)*30;
  const bot = top - 15 - fbm2(x*.03, z*.03, 2, 507)*8 - Math.pow(r/92,2)*10;
  if (y > top || y < bot || y < 8) return B.AIR;
  // purpur pillars on a ring
  const ang = Math.atan2(z, x) + Math.PI;
  for (let k=0;k<8;k++){
    let d = Math.abs(ang - k*(Math.PI/4)); if (d > Math.PI) d = 2*Math.PI - d;
    if (r > 34 && r < 37 && d < .07 && y < top + 22) return B.PURPUR;
  }
  return B.ENDSTONE;
}
const DIM_CELL = [ overCell, netherCell, endCell ];
const cellAt = (d, x, y, z) => {
  if (y <= 0) return B.BEDROCK;
  if (y >= HGT) return B.AIR;
  return DIM_CELL[d](x, y, z);
};
/* gen content used by falling sand: generator without trees */
function genBlockAt(x, y, z){
  return cellAt(DIM.cur, x, y, z);
}
const genBlockAtDim = (d, x, y, z) => cellAt(d, x, y, z);

/* spawn helper: true when decor or a structure occupies the standing column
   at (x, z) — the spawn spiral rejects these instead of embedding the player */
function spawnBlockedAt(x, z){
  for (let dx=-2; dx<=2; dx++) for (let dz=-2; dz<=2; dz++)
    if (isTreeAt(x+dx, z+dz)) return true;               // trunk column or canopy ring (canopy can dip to surface+2)
  if (carved(x, heightAt(x, z), z, heightAt(x, z))) return true;   // cave mouth at the surface
  const cells = villageCells(Math.floor(x/96), Math.floor(z/96));
  if (cells) for (const [cx, cy, cz] of cells) if (cx === x && cz === z) return true;
  return false;
}

/* ---------- chunks ---------- */
const chunks = new Map();                 // "dim:cx,cz" → chunk
const key = (d, cx, cz) => d + ':' + cx + ',' + cz;
function chunkAt(cx, cz){ return chunks.get(key(DIM.cur, cx, cz)); }
const DIM = { cur: 0 };                    // mutable dimension handle
const edits = new Map();                   // "d:x,y,z" → block id (persisted)
const editKey = (d, x, y, z) => d + ':' + x + ',' + y + ',' + z;
const DIM_NAME = ['Overworld', 'Nether', 'The End'];
const DIM_SKY = [
  { day: 0x87b5e5, night: 0x0b1026, fogD: 0x9db8dd, fogN: 0x0b1026 },
  { day: 0x1c0a0a, night: 0x1c0a0a, fogD: 0x401414, fogN: 0x401414 },
  { day: 0x0c0a14, night: 0x0c0a14, fogD: 0x1a1430, fogN: 0x1a1430 },
];

function buildChunkData(cx, cz){
  const data = new Uint8Array(CH*HGT*CH);
  const bx = cx*CH, bz = cz*CH, d = DIM.cur;
  for (let x=0;x<CH;x++) for (let z=0;z<CH;z++){
    const wx = bx+x, wz = bz+z;
    const h = (d === 0) ? heightAt(wx, wz) : 0;
    for (let y=0;y<HGT;y++){
      let id = cellAt(d, wx, y, wz);
      // overworld ore pass folded into overCell via oreAt; lava lakes carve to LAVA already
      data[cIdx(x,y,z)] = id;
    }
  }
  // trees with margin so canopies cross chunk seams
  if (d === 0){
    for (let x=-3; x<CH+3; x++) for (let z=-3; z<CH+3; z++){
      const th = isTreeAt(bx+x, bz+z);
      if (!th) continue;
      const hh = heightAt(bx+x, bz+z);
      const top = hh + th;
      for (let lx=x-2; lx<=x+2; lx++) for (let lz=z-2; lz<=z+2; lz++) for (let ly=top-2; ly<=top+1; ly++){
        if (lx<0||lx>=CH||lz<0||lz>=CH||ly<1||ly>=HGT) continue;
        const dist = Math.abs(lx-x) + Math.abs(lz-z) + Math.abs(ly-(top-1));
        const keep = dist <= 2 || (dist === 3 && hash3(bx+lx, ly, bz+lz, 321) < .4);
        if (!keep) continue;
        const ii = cIdx(lx, ly, lz);
        if (data[ii] === B.AIR) data[ii] = (lx===x && lz===z && ly <= top) ? B.LOG : B.LEAF;
      }
    }
  }
  // structures: villages (overworld), nether-brick towers (nether)
  stampStructures(data, cx, cz, d);
  // edits overlay
  for (let x=0;x<CH;x++) for (let z=0;z<CH;z++) for (let y=0;y<HGT;y++){
    const e = edits.get(editKey(d, bx+x, y, bz+z));
    if (e !== undefined) data[cIdx(x,y,z)] = e;
  }
  return data;
}

/* ---------- lighting ---------- */
/* block-light BFS volume with 1-cell margin, built per chunk */
const LVW = CH+2, LVH = HGT+2;
const lvIdx = (x,y,z) => ((y+1)*LVW + (z+1))*LVW + (x+1);   // x,y,z in -1..CH local
function gatherLight(cx, cz, getBlk, out){
  out.fill(0);
  const queue = [];
  const bx = cx*CH, bz = cz*CH;
  for (const [k, ch] of chunks){
    if (!ch.sources || !ch.sources.length) continue;
    const [cd, ccx, ccz] = k.split(':');
    if (+cd !== DIM.cur) continue;
    if (Math.abs(ccx - cx) > 1 || Math.abs(ccz - cz) > 1) continue;
    for (const s of ch.sources){
      const lx = s.x - bx, lz = s.z - bz;
      if (lx < -1 || lx > CH || lz < -1 || lz > CH || s.y < -1 || s.y > HGT) continue;
      const i = lvIdx(lx, s.y, lz);
      if (out[i] < s.lv){ out[i] = s.lv; queue.push([lx, s.y, lz, s.lv]); }
    }
  }
  let head = 0;
  while (head < queue.length){
    const [x, y, z, lv] = queue[head++];
    if (lv <= 1) continue;
    const nl = lv - 1;
    const nb = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
    for (const [dx,dy,dz] of nb){
      const nx = x+dx, ny = y+dy, nz = z+dz;
      if (nx < -1 || nx > CH || ny < -1 || ny >= HGT || nz < -1 || nz > CH) continue;
      const i = lvIdx(nx, ny, nz);
      if (out[i] >= nl) continue;
      const blk = getBlk(bx+nx, ny, bz+nz);
      if (OPAQUE.has(blk)) continue;
      out[i] = nl;
      queue.push([nx, ny, nz, nl]);
    }
  }
}
/* sky approximation for a cell: daylight fades with depth under the surface */
function skyAt(d, x, y, z, hBuf){
  if (d === 1) return .34;                       // nether: dim ambient
  if (d === 2) return .5;                        // end: pale ambient
  const h = (hBuf && hBuf.v !== undefined) ? hBuf.v : heightAt(x, z);
  const depth = h - y;
  if (depth <= 0) return 1;
  return Math.max(.12, 1 - depth/7);
}

/* ---------- meshing ---------- */
/* face defs: +X,-X,+Y,-Y,+Z,-Z — normals, corners, AO sample axes.
   Canonical per-corner offsets adapted from the classic 0fps AO article. */
const FACES = [
  { n:[1,0,0],  c:[[1,0,0],[1,1,0],[1,1,1],[1,0,1]], shade:.82 },
  { n:[-1,0,0], c:[[0,0,1],[0,1,1],[0,1,0],[0,0,0]], shade:.82 },
  { n:[0,1,0],  c:[[0,1,0],[0,1,1],[1,1,1],[1,1,0]], shade:1.0 },
  { n:[0,-1,0], c:[[0,0,0],[1,0,0],[1,0,1],[0,0,1]], shade:.5 },
  { n:[0,0,1],  c:[[1,0,1],[1,1,1],[0,1,1],[0,0,1]], shade:.78 },
  { n:[0,0,-1], c:[[0,0,0],[0,1,0],[1,1,0],[1,0,0]], shade:.78 },
];
/* AO: corner darkening from the two edge neighbors + diagonal, per face */
function cornerAO(side1, side2, corner){
  if (side1 && side2) return .45;
  if (side1 || side2) return .68;
  if (corner) return .82;
  return 1;
}
function buildMesh(cx, cz, THREE){
  const d = DIM.cur, bx = cx*CH, bz = cz*CH;
  const data = buildChunkData(cx, cz);
  const getW = (x, y, z) => {                     // world sample: loaded chunk → gen
    if (y < 0) return B.BEDROCK;
    if (y >= HGT) return B.AIR;
    const lx = x - bx, lz = z - bz;
    if (lx >= 0 && lx < CH && lz >= 0 && lz < CH) return data[cIdx(lx, y, lz)];
    const c = chunks.get(key(d, x>>4, z>>4));
    if (c && c.data) return c.data[cIdx(x&15, y, z&15)];
    return genBlockAtDim(d, x, y, z);
  };
  // light sources for the BFS: own + 8 neighbors
  const lv = new Uint8Array(LVW*LVW*LVH);
  const getBlk = (x, y, z) => getW(x, y, z);
  gatherLight(cx, cz, getBlk, lv);
  const hBuf = { v: undefined };
  const sky = (x, y, z) => {
    if (d !== 0){ hBuf.v = undefined; return skyAt(d, 0, y, 0); }
    hBuf.v = heightAt(x, z);
    return skyAt(d, x, y, z, hBuf);
  };
  const lit = (x, y, z) => {
    const s = sky(x, y, z);
    const lx = x - bx, lz = z - bz;
    let bl = 0;
    if (lx >= -1 && lx <= CH && lz >= -1 && lz <= CH && y >= -1 && y < HGT) bl = lv[lvIdx(lx, y, lz)];
    return Math.max(s, bl/15);
  };

  const pos = [], col = [], uvs = [], idx = [];
  const wpos = [], wcol = [], wuvs = [], widx = [];
  const tpos = [], tcol = [], tuvs = [], tidx = [];
  const pushQuad = (arrP, arrC, arrU, arrI, verts, colors, uvRow, flipDiag) => {
    const base = arrP.length/3;
    for (let i=0;i<4;i++){ arrP.push(verts[i][0], verts[i][1], verts[i][2]); arrC.push(colors[i][0], colors[i][1], colors[i][2]); }
    const u0 = uvRow[0], v0 = uvRow[1], s = 1/ACOLS;
    const t = 1 - v0 - s;
    arrU.push(u0, t+s, u0+s, t+s, u0+s, t, u0, t);
    if (flipDiag) arrI.push(base, base+1, base+2, base, base+2, base+3);
    else arrI.push(base+1, base+2, base+3, base+1, base+3, base);
  };
  const solidAt = (x, y, z) => SOLID.has(getW(x, y, z));
  for (let x=0;x<CH;x++) for (let z=0;z<CH;z++) for (let y=0;y<HGT;y++){
    const id = data[cIdx(x,y,z)];
    if (id === B.AIR) continue;
    const inf = BINFO[id];
    const wx = bx+x, wz = bz+z;
    if (inf.deco){
      addDeco(inf.deco, id, x, y, z, wx, wz, lit, { pos, col, uvs, idx }, { pos: tpos, col: tcol, uvs: tuvs, idx: tidx });
      continue;
    }
    const isWater = id === B.WATER;
    for (let f=0; f<6; f++){
      const F = FACES[f];
      const nx = wx + F.n[0], ny = y + F.n[1], nz = wz + F.n[2];
      const nid = getW(nx, ny, nz);
      const nInfo = BINFO[nid];
      const hide = isWater
        ? (nid === B.WATER || (nInfo && nInfo.opaque))
        : (nInfo && nInfo.opaque);
      if (hide) continue;
      // AO + light per corner
      const colors = [];
      const lvRow = (id === B.LAVA) ? 1 : lit(nx, ny, nz);
      for (let ci=0; ci<4; ci++){
        const c = F.c[ci];
        // AO sampling axes: the two tangent dirs of this face
        const t1 = c[0] === 1 ? 1 : -1, t2 = c[2] === 1 ? 1 : -1;
        let a = 1;
        if (!isWater){
          let s1 = 0, s2 = 0, co = 0;
          if (f === 0 || f === 1){ s1 = solidAt(nx, ny + (c[1]?1:-1), nz); s2 = solidAt(nx, ny, nz + (c[2]?1:-1)); co = solidAt(nx, ny + (c[1]?1:-1), nz + (c[2]?1:-1)); }
          else if (f === 2 || f === 3){ s1 = solidAt(nx + (c[0]?1:-1), ny, nz); s2 = solidAt(nx, ny, nz + (c[2]?1:-1)); co = solidAt(nx + (c[0]?1:-1), ny, nz + (c[2]?1:-1)); }
          else { s1 = solidAt(nx + (c[0]?1:-1), ny, nz); s2 = solidAt(nx, ny + (c[1]?1:-1), nz); co = solidAt(nx + (c[0]?1:-1), ny + (c[1]?1:-1), nz); }
          a = cornerAO(s1, s2, co);
        }
        const br = Math.max(.04, F.shade * a * lvRow);
        colors.push([br, br, br]);
      }
      const tname = (f === 3) ? inf.b : ((f === 2) ? inf.t : inf.s);
      const uv = MCH.tileUV(tname);
      const verts = F.c.map(c => [wx + c[0], y + c[1], wz + c[2]]);
      if (isWater){
        // drop the top surface slightly
        if (f === 2) for (const v of verts) v[1] -= .12;
        pushQuad(wpos, wcol, wuvs, widx, verts, colors, uv, false);
      } else {
        // quad diagonal flip to kill AO anisotropy
        const flip = (colors[0][0] + colors[2][0]) < (colors[1][0] + colors[3][0]);
        pushQuad(pos, col, uvs, idx, verts, colors, uv, flip);
      }
    }
  }
  return { data, g: { pos, col, uvs, idx }, w: { pos: wpos, col: wcol, uvs: wuvs, idx: widx }, t: { pos: tpos, col: tcol, uvs: tuvs, idx: tidx }, sources: collectSources(data, bx, bz, d) };
}
function collectSources(data, bx, bz, d){
  const out = [];
  for (let x=0;x<CH;x++) for (let z=0;z<CH;z++) for (let y=0;y<HGT;y++){
    const id = data[cIdx(x,y,z)];
    const em = LIGHT_EMIT.get(id);
    if (em) out.push({ x: bx+x, y, z: bz+z, lv: em });
  }
  return out;
}
/* deco geometry: torch / wire / lever / portals */
function addDeco(kind, id, x, y, z, wx, wz, lit, solid, trans){
  const uv = (n) => MCH.tileUV(n);
  const inf = BINFO[id];
  const push = (bucket, verts, uvs4, bright) => {
    const base = bucket.pos.length/3;
    for (const v of verts) bucket.pos.push(v[0], v[1], v[2]);
    for (const b of bright) bucket.col.push(b, b, b);
    const u0 = uvs4[0], v0 = uvs4[1], s = 1/ACOLS, t = 1 - v0 - s;
    bucket.uvs.push(u0, t+s, u0+s, t+s, u0+s, t, u0, t);
    bucket.idx.push(base+1, base+2, base+3, base+1, base+3, base);
  };
  const quad = (a, b, c, dd, u, br) => [a, b, c, dd].map(v => v);
  if (kind === 'torch'){
    const w = .09, h = .62;
    const cx = wx+.5, cz = wz+.5;
    const b = Math.max(lit(wx, y, wz), .55);
    const u = uv(inf.s);
    // two crossed quads so the torch reads from every angle (double-sided material)
    push(trans, [[cx-w, y, cz], [cx-w, y+h, cz], [cx+w, y+h, cz], [cx+w, y, cz]], u, [b, b, b, b]);
    push(trans, [[cx, y, cz-w], [cx, y+h, cz-w], [cx, y+h, cz+w], [cx, y, cz+w]], u, [b, b, b, b]);
  } else if (kind === 'wire'){
    const on = MCH.rsPowered && MCH.rsPowered.has(DIM.cur + ':' + wx + ',' + y + ',' + wz);
    const u = uv(on ? 'wire_on' : 'wire_off');
    const b = on ? 1 : Math.max(lit(wx, y, wz), .5);
    const s = .42, yy = y + .07, cx = wx+.5, cz = wz+.5;
    push(trans, [[cx-s, yy, cz-s],[cx-s, yy, cz+s],[cx+s, yy, cz+s],[cx+s, yy, cz-s]], u, [b,b,b,b]);
  } else if (kind === 'lever'){
    const lm = MCH.rsLevers && MCH.rsLevers.get(DIM.cur);
    const on = lm ? lm.get(wx + ',' + y + ',' + wz) === true : false;
    const u = uv(on ? 'lever_on' : 'lever_off');
    const b = Math.max(lit(wx, y, wz), .6);
    const cx = wx+.5, cz = wz+.5, yy = y;
    push(trans, [[cx-.15, yy, cz-.15],[cx-.15, yy+.4, cz-.15],[cx+.15, yy+.4, cz+.15],[cx+.15, yy, cz+.15]], u, [b,b,b,b]);
  } else if (kind === 'cross'){
    const u = uv(inf.s);
    const b = Math.max(lit(wx, y, wz), .5);
    const cx = wx+.5, cz = wz+.5, r = .5;
    push(trans, [[cx-r, y, cz-r],[cx-r, y+1, cz-r],[cx+r, y+1, cz+r],[cx+r, y, cz+r]], u, [b,b,b,b]);
    push(trans, [[cx-r, y, cz+r],[cx-r, y+1, cz+r],[cx+r, y+1, cz-r],[cx+r, y, cz-r]], u, [b,b,b,b]);
  } else if (kind === 'flat'){
    const u = uv(inf.s);
    const b = Math.max(lit(wx, y, wz), .6);
    push(trans, [[wx, y+.06, wz],[wx, y+.06, wz+1],[wx+1, y+.06, wz+1],[wx+1, y+.06, wz]], u, [b,b,b,b]);
  }
}

/* ---------- redstone ---------- */
const rsWires = new Map();       // dim → Set("x,y,z")
const rsLevers = new Map();      // dim → Map("x,y,z" → bool on)
const rsLamps = new Map();       // dim → Set
const rsPowered = new Map();     // "d:x,y,z" → level (wires only)
const rsLit = new Set();         // "d:x,y,z" lit lamps
MCH.rsPowered = rsPowered;
MCH.rsLeversOn = rsLit;          // levers read their own map in game.js
function rsBucket(map, d){ let s = map.get(d); if (!s){ s = new Set(); map.set(d, s); } return s; }
function rsRebuildLists(d){
  rsBucket(rsWires, d).clear(); rsBucket(rsLamps, d).clear();
  rsLevers.set(d, new Map());
  for (const [k, id] of edits){
    if (!k.startsWith(d + ':')) continue;
    const pos = k.slice(k.indexOf(':') + 1);
    if (id === B.WIRE) rsBucket(rsWires, d).add(pos);
    else if (id === B.LEVER) rsLevers.get(d).set(pos, false);
    else if (id === B.LAMP) rsBucket(rsLamps, d).add(pos);
  }
}
function rsToggleLever(d, x, y, z){
  const m = rsLevers.get(d); if (!m) return false;
  const k = x + ',' + y + ',' + z;
  if (!m.has(k)) return false;
  m.set(k, !m.get(k));
  rsRecompute(d);
  return true;
}
function rsRecompute(d){
  const wires = rsWires.get(d) || new Set();
  const levers = rsLevers.get(d) || new Map();
  const lamps = rsLamps.get(d) || new Set();
  const changed = new Set();
  for (const k of [...rsPowered.keys()]) if (k.startsWith(d + ':')) { rsPowered.delete(k); changed.add(k.slice(k.indexOf(':')+1)); }
  for (const k of [...rsLit]) if (k.startsWith(d + ':')) { rsLit.delete(k); changed.add(k.slice(k.indexOf(':')+1)); }
  const nb = (k) => {
    const [x, y, z] = k.split(',').map(Number);
    const out = [];
    const dirs = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
    for (const [dx,dy,dz] of dirs) out.push((x+dx) + ',' + (y+dy) + ',' + (z+dz));
    return out;
  };
  // BFS from ON levers through wires
  const q = [];
  for (const [k, on] of levers) if (on){
    changed.add(k);
    for (const n of nb(k)) if (wires.has(n)){ if (!rsPowered.has(d + ':' + n)){ rsPowered.set(d + ':' + n, 15); q.push([n, 15]); changed.add(n); } }
  }
  while (q.length){
    const [k, lv] = q.shift();
    if (lv <= 1) continue;
    for (const n of nb(k)) if (wires.has(n) && !rsPowered.has(d + ':' + n)){
      rsPowered.set(d + ':' + n, lv - 1); q.push([n, lv - 1]); changed.add(n);
    }
  }
  // lamps light next to powered wire or ON lever
  for (const k of lamps){
    let on = false;
    for (const n of nb(k)) if (rsPowered.has(d + ':' + n) || (levers.get(n) === true)) { on = true; break; }
    if (on){ rsLit.add(d + ':' + k); changed.add(k); }
  }
  // light-emitting lamp cells: dirty chunks that contain changed rs cells
  return changed;
}

/* ---------- world API ---------- */
function getBlock(x, y, z){
  if (y <= 0) return B.BEDROCK;
  if (y >= HGT) return B.AIR;
  const c = chunkAt(x>>4, z>>4);
  if (c && c.data) return c.data[cIdx(x&15, y, z&15)];
  return B.AIR;
}
function setBlock(x, y, z, id, record = true, net = true, dim = DIM.cur){
  if (y <= 0 || y >= HGT) return false;
  if (record){ edits.set(editKey(dim, x, y, z), id); if (net && MCH.netBroadcastEdit) MCH.netBroadcastEdit(dim, x, y, z, id); }
  const c = chunks.get(key(dim, x>>4, z>>4));
  if (!c || !c.data) return true;              // logged; chunk build applies it
  const lx = x&15, lz = z&15;
  c.data[cIdx(lx, y, lz)] = id;
  c.dirty = true;
  if (lx === 0)  { const n = chunks.get(key(dim, (x>>4)-1, z>>4)); if (n) n.dirty = true; }
  if (lx === 15) { const n = chunks.get(key(dim, (x>>4)+1, z>>4)); if (n) n.dirty = true; }
  if (lz === 0)  { const n = chunks.get(key(dim, x>>4, (z>>4)-1)); if (n) n.dirty = true; }
  if (lz === 15) { const n = chunks.get(key(dim, x>>4, (z>>4)+1)); if (n) n.dirty = true; }
  // redstone membership
  if (RS_KIND.has(id) || dim !== DIM.cur){ /* rebuilt lazily via rsRebuildLists on load */ }
  if (dim === DIM.cur && (RS_KIND.has(id) || rsAffects(id, x, y, z, dim))) rsRecompute(dim);
  return true;
}
function rsAffects(id, x, y, z, d){
  // breaking/placing anything adjacent to a wire network can change power
  const wires = rsWires.get(d);
  if (!wires || !wires.size) return false;
  for (const dx of [-1,0,1]) for (const dy of [-1,0,1]) for (const dz of [-1,0,1]){
    if (wires.has((x+dx) + ',' + (y+dy) + ',' + (z+dz))) return true;
  }
  return false;
}

/* falling sand (event-driven) */
function settleFrom(x, y, z){
  const d = DIM.cur;
  if (y <= 0 || y >= HGT) return;
  if (getBlock(x, y, z) !== B.SAND) return;
  if (!chunkAt(x>>4, z>>4)) return;
  let ny = y;
  while (ny-1 >= 1){
    const below = getBlock(x, ny-1, z);
    if (below !== B.AIR && below !== B.WATER) break;
    ny--;
  }
  if (ny === y) return;
  setBlock(x, y, z, genBlockAt(x, y, z), true, true);
  setBlock(x, ny, z, B.SAND, true, true);
  if (MCH.puff) MCH.puff(x, ny, z, B.SAND);
  if (getBlock(x, y+1, z) === B.SAND) settleFrom(x, y+1, z);
}
function gravelSettle(x, y, z){
  const d = DIM.cur;
  if (getBlock(x, y, z) !== B.GRAVEL) return;
  if (!chunkAt(x>>4, z>>4)) return;
  let ny = y;
  while (ny-1 >= 1){
    const below = getBlock(x, ny-1, z);
    if (below !== B.AIR && below !== B.WATER) break;
    ny--;
  }
  if (ny === y) return;
  setBlock(x, y, z, genBlockAt(x, y, z), true, true);
  setBlock(x, ny, z, B.GRAVEL, true, true);
  if (MCH.puff) MCH.puff(x, ny, z, B.GRAVEL);
  if (getBlock(x, y+1, z) === B.GRAVEL) gravelSettle(x, y+1, z);
}
const isSolidId = (id) => SOLID.has(id);

/* ---------- streaming ---------- */
function pumpChunks(buildOne, meshOne, player, dist, THREE){
  const pcx = Math.floor(player.pos.x/CH), pcz = Math.floor(player.pos.z/CH);
  const d = DIM.cur;
  let made = 0, meshed = 0, budgetG = 3, budgetM = 2;
  const R = dist;
  // spiral by ring so nearest chunks generate first
  for (let r = 0; r <= R && (budgetG > 0 || budgetM > 0); r++){
    for (let dx=-r; dx<=r; dx++) for (let dz=-r; dz<=r; dz++){
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const k = key(d, pcx+dx, pcz+dz);
      let c = chunks.get(k);
      if (!c && budgetG > 0){ c = { cx: pcx+dx, cz: pcz+dz, dim: d, data: null, mesh: null, meshW: null, meshT: null, dirty: true, sources: [] }; chunks.set(k, c); budgetG--; made++; }
      if (c && c.dirty && budgetM > 0){ buildOne(c, THREE); budgetM--; meshed++; }
    }
  }
  // hide meshes of far chunks (keep data)
  for (const [k, c] of chunks){
    if (c.dim !== d) continue;
    const far = Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz)) > R + 1;
    if (far && c.mesh){ c.mesh.visible = false; if (c.meshW) c.meshW.visible = false; if (c.meshT) c.meshT.visible = false; }
    else if (!far && c.mesh){ c.mesh.visible = true; if (c.meshW) c.meshW.visible = true; if (c.meshT) c.meshT.visible = true; }
  }
  return { made, meshed };
}
function chunksReadyForSpawn(){
  const pcx = Math.floor(MCH.playerPos.x/CH), pcz = Math.floor(MCH.playerPos.z/CH);
  for (let dx=-1;dx<=1;dx++) for (let dz=-1;dz<=1;dz++){
    const c = chunks.get(key(DIM.cur, pcx+dx, pcz+dz));
    if (!c || c.dirty) return false;
  }
  return true;
}
function clearChunks(THREE){
  for (const [k, c] of chunks){
    for (const m of [c.mesh, c.meshW, c.meshT]) if (m){ MCH.scene.remove(m); m.geometry.dispose(); }
  }
  chunks.clear();
}

Object.assign(MCH, {
  B, BINFO, NAMES, ITEMS, TOOL, // re-assert
  CH, HGT, SEA, SNOW, cIdx, DIM, DIM_NAME, DIM_SKY, WORLD_BORDER, setSeed,
  hash2, hash3, vnoise2, vnoise3, fbm2, fbm3, ridged2,
  heightAt, surfaceBlock, carved, oreAt, isTreeAt, spawnBlockedAt,
  overCell, netherCell, endCell, cellAt, genBlockAt, genBlockAtDim,
  hutCells, villageCells, towerCells, stampStructures,
  chunks, chunkAt, key, editKey, edits,
  buildChunkData, gatherLight, skyAt, buildMesh, collectSources, addDeco,
  rsWires, rsLevers, rsLamps, rsPowered, rsLit, rsRebuildLists, rsToggleLever, rsRecompute,
  getBlock, setBlock, settleFrom, gravelSettle, isSolidId,
  pumpChunks, chunksReadyForSpawn, clearChunks,
});
})();
