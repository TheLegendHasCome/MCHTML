/* MCHTML v2.0 — data.js
   Block table, item table, recipes, and the texture atlas painter.
   Everything here is pure data + canvas painting; no THREE, no DOM. */
window.MCH = window.MCH || {};

/* ---------- block ids ---------- */
const B = {
  AIR:0, GRASS:1, DIRT:2, STONE:3, SAND:4, WATER:5, LOG:6, LEAF:7, GLASS:8,
  PLANK:9, COBBLE:10, SNOW:11, BEDROCK:12, GRAVEL:13, COAL:14, IRON:15,
  GOLD:16, DIAMOND:17, REDSTONE:18, CRAFT:19, FURNACE:20, OBSIDIAN:21,
  NETHERRACK:22, SOUL:23, GLOWSTONE:24, NBRICK:25, ENDSTONE:26, PURPUR:27,
  TORCH:28, WIRE:29, LEVER:30, LAMP:31, PORTAL:32, EFRAME:33, EFRAME_EYE:34,
  EPORTAL:35, LAVA:36,
};
const NAMES = {
  [B.GRASS]:'Grass', [B.DIRT]:'Dirt', [B.STONE]:'Stone', [B.SAND]:'Sand', [B.WATER]:'Water',
  [B.LOG]:'Log', [B.LEAF]:'Leaves', [B.GLASS]:'Glass', [B.PLANK]:'Planks', [B.COBBLE]:'Cobblestone',
  [B.SNOW]:'Snow', [B.BEDROCK]:'Bedrock', [B.GRAVEL]:'Gravel', [B.COAL]:'Coal Ore', [B.IRON]:'Iron Ore',
  [B.GOLD]:'Gold Ore', [B.DIAMOND]:'Diamond Ore', [B.REDSTONE]:'Redstone Ore', [B.CRAFT]:'Crafting Table',
  [B.FURNACE]:'Furnace', [B.OBSIDIAN]:'Obsidian', [B.NETHERRACK]:'Netherrack', [B.SOUL]:'Soul Sand',
  [B.GLOWSTONE]:'Glowstone', [B.NBRICK]:'Nether Brick', [B.ENDSTONE]:'End Stone', [B.PURPUR]:'Purpur',
  [B.TORCH]:'Torch', [B.WIRE]:'Redstone Dust', [B.LEVER]:'Lever', [B.LAMP]:'Redstone Lamp',
  [B.PORTAL]:'Nether Portal', [B.EFRAME]:'End Frame', [B.EFRAME_EYE]:'End Frame', [B.EPORTAL]:'End Portal',
  [B.LAVA]:'Lava',
};

/* hard: seconds to mine by hand; tool class that speeds it; tier gate
   (0 hand, 1 wood, 2 stone, 3 iron, 4 diamond). drop: {id,n} — id is a
   block number or an item string; default drops itself. */
const BINFO = {
  [B.GRASS]:   { t:'grass_top', s:'grass_side', b:'dirt',  opaque:true, solid:true,  hard:.6,  tool:'shovel', drop:{id:B.DIRT,n:1} },
  [B.DIRT]:    { t:'dirt', s:'dirt', b:'dirt',                  opaque:true, solid:true,  hard:.6,  tool:'shovel' },
  [B.STONE]:   { t:'stone', s:'stone', b:'stone',              opaque:true, solid:true,  hard:7,   tool:'pick', tier:1, drop:{id:B.COBBLE,n:1} },
  [B.SAND]:    { t:'sand', s:'sand', b:'sand',                  opaque:true, solid:true,  hard:.55, tool:'shovel', falls:true },
  [B.WATER]:   { t:'water', s:'water', b:'water',              opaque:false,solid:false, fluid:true },
  [B.LAVA]:    { t:'lava', s:'lava', b:'lava',                  opaque:true, solid:false, fluid:true, light:13, hurt:true },
  [B.LOG]:     { t:'log_top', s:'log', b:'log_top',            opaque:true, solid:true,  hard:2.8, tool:'axe' },
  [B.LEAF]:    { t:'leaf', s:'leaf', b:'leaf',                  opaque:true, solid:true,  hard:.35, drop:{id:null,n:0}, bonus:{id:'stick',n:1,p:.15} },
  [B.GLASS]:   { t:'glass', s:'glass', b:'glass',              opaque:false,solid:true,  hard:.5,  trans:true },
  [B.PLANK]:   { t:'plank', s:'plank', b:'plank',              opaque:true, solid:true,  hard:2.8, tool:'axe' },
  [B.COBBLE]:  { t:'cobble', s:'cobble', b:'cobble',           opaque:true, solid:true,  hard:7,   tool:'pick', tier:1 },
  [B.SNOW]:    { t:'snow', s:'snow', b:'snow',                  opaque:true, solid:true,  hard:.35, tool:'shovel' },
  [B.BEDROCK]: { t:'bedrock', s:'bedrock', b:'bedrock',         opaque:true, solid:true,  unbreak:true },
  [B.GRAVEL]:  { t:'gravel', s:'gravel', b:'gravel',           opaque:true, solid:true,  hard:.7,  tool:'shovel', falls:true, bonus:{id:'coal',n:1,p:.1} },
  [B.COAL]:    { t:'coal', s:'coal', b:'coal',                  opaque:true, solid:true,  hard:9,   tool:'pick', tier:1, drop:{id:'coal',n:1} },
  [B.IRON]:    { t:'iron', s:'iron', b:'iron',                  opaque:true, solid:true,  hard:9,   tool:'pick', tier:2 },
  [B.GOLD]:    { t:'gold', s:'gold', b:'gold',                  opaque:true, solid:true,  hard:9,   tool:'pick', tier:3 },
  [B.DIAMOND]: { t:'diamond', s:'diamond', b:'diamond',         opaque:true, solid:true,  hard:9,   tool:'pick', tier:3, drop:{id:'diamond',n:1} },
  [B.REDSTONE]:{ t:'rs_ore', s:'rs_ore', b:'rs_ore',            opaque:true, solid:true,  hard:9,   tool:'pick', tier:3, drop:{id:'redstone',n:4} },
  [B.CRAFT]:   { t:'craft_top', s:'craft', b:'plank',           opaque:true, solid:true,  hard:2.8, tool:'axe', interact:'craft' },
  [B.FURNACE]: { t:'furn_top', s:'furn', b:'furn_top',          opaque:true, solid:true,  hard:7,   tool:'pick', tier:1, interact:'furnace' },
  [B.OBSIDIAN]:{ t:'obsidian', s:'obsidian', b:'obsidian',      opaque:true, solid:true,  hard:25,  tool:'pick', tier:4 },
  [B.NETHERRACK]:{ t:'netherrack', s:'netherrack', b:'netherrack', opaque:true, solid:true, hard:1.2, tool:'pick', tier:1 },
  [B.SOUL]:    { t:'soul', s:'soul', b:'soul',                  opaque:true, solid:true,  hard:.6,  tool:'shovel' },
  [B.GLOWSTONE]:{ t:'glowstone', s:'glowstone', b:'glowstone',  opaque:true, solid:true,  hard:.8,  tool:'pick', tier:1, light:15, drop:{id:'glowdust',n:3} },
  [B.NBRICK]:  { t:'nbrick', s:'nbrick', b:'nbrick',            opaque:true, solid:true,  hard:7,   tool:'pick', tier:1 },
  [B.ENDSTONE]:{ t:'endstone', s:'endstone', b:'endstone',      opaque:true, solid:true,  hard:7,   tool:'pick', tier:1 },
  [B.PURPUR]:  { t:'purpur', s:'purpur', b:'purpur',            opaque:true, solid:true,  hard:7,   tool:'pick', tier:1 },
  [B.TORCH]:   { t:'torch', s:'torch', b:'torch',              opaque:false,solid:false, hard:.1,  light:14, deco:'torch' },
  [B.WIRE]:    { t:'wire_off', s:'wire_off', b:'wire_off',     opaque:false,solid:false, hard:.1,  deco:'wire', rs:'wire' },
  [B.LEVER]:   { t:'lever_off', s:'lever_off', b:'lever_off',  opaque:false,solid:false, hard:.3,  deco:'lever', rs:'lever', interact:'lever' },
  [B.LAMP]:    { t:'lamp_off', s:'lamp_off', b:'lamp_off',     opaque:true, solid:true,  hard:.6,  tool:'pick', tier:1, rs:'lamp' },
  [B.PORTAL]:  { t:'portal', s:'portal', b:'portal',           opaque:false,solid:false, deco:'cross', tele:'nether' },
  [B.EFRAME]:  { t:'eframe', s:'eframe', b:'eframe',            opaque:true, solid:true,  hard:12,  tool:'pick', tier:3, interact:'frame' },
  [B.EFRAME_EYE]:{ t:'eframe_eye', s:'eframe_eye', b:'eframe_eye', opaque:true, solid:true, hard:12, tool:'pick', tier:3 },
  [B.EPORTAL]: { t:'eportal', s:'eportal', b:'eportal',         opaque:false,solid:false, deco:'flat', tele:'end' },
};
const UNBREAKABLE = new Set([B.BEDROCK, B.PORTAL, B.EPORTAL]);
const OPAQUE = new Set(Object.keys(BINFO).filter(k => BINFO[k].opaque).map(Number));
const SOLID = new Set(Object.keys(BINFO).filter(k => BINFO[k].solid).map(Number));
const LIGHT_EMIT = new Map(Object.keys(BINFO).filter(k => BINFO[k].light).map(k => [Number(k), BINFO[k].light]));
const INTERACT = new Map(Object.keys(BINFO).filter(k => BINFO[k].interact).map(k => [Number(k), BINFO[k].interact]));
const RS_KIND = new Map(Object.keys(BINFO).filter(k => BINFO[k].rs).map(k => [Number(k), BINFO[k].rs]));

/* ---------- item registry ----------
   items are strings; block items are their numeric id. */
const ITEMS = {
  stick:        { name:'Stick', stack:64 },
  coal:         { name:'Coal', stack:64, fuel:8 },
  iron_ingot:   { name:'Iron Ingot', stack:64 },
  gold_ingot:   { name:'Gold Ingot', stack:64 },
  diamond:      { name:'Diamond', stack:64 },
  redstone:     { name:'Redstone Dust', stack:64, places:B.WIRE },
  glowdust:     { name:'Glowstone Dust', stack:64 },
  igniter:      { name:'Portal Igniter', stack:1 },
  eye:          { name:'Eye of Ender', stack:16 },
};
/* tools: tier gates mining, mult speeds pick-class blocks */
const TOOL = {
  wood_pick:    { name:'Wooden Pickaxe', kind:'pick',   tier:1, mult:2, stack:1 },
  stone_pick:   { name:'Stone Pickaxe',  kind:'pick',   tier:2, mult:4, stack:1 },
  iron_pick:    { name:'Iron Pickaxe',   kind:'pick',   tier:3, mult:6, stack:1 },
  dia_pick:     { name:'Diamond Pickaxe',kind:'pick',   tier:4, mult:8, stack:1 },
  wood_axe:     { name:'Wooden Axe',     kind:'axe',    tier:1, mult:2, stack:1 },
  stone_axe:    { name:'Stone Axe',      kind:'axe',    tier:2, mult:4, stack:1 },
  iron_axe:     { name:'Iron Axe',       kind:'axe',    tier:3, mult:6, stack:1 },
  dia_axe:      { name:'Diamond Axe',    kind:'axe',    tier:4, mult:8, stack:1 },
  wood_shovel:  { name:'Wooden Shovel',  kind:'shovel', tier:1, mult:2, stack:1 },
  stone_shovel: { name:'Stone Shovel',   kind:'shovel', tier:2, mult:4, stack:1 },
  iron_shovel:  { name:'Iron Shovel',    kind:'shovel', tier:3, mult:6, stack:1 },
  dia_shovel:   { name:'Diamond Shovel', kind:'shovel', tier:4, mult:8, stack:1 },
  wood_sword:   { name:'Wooden Sword',   kind:'sword',  tier:1, mult:1.5, stack:1 },
  stone_sword:  { name:'Stone Sword',    kind:'sword',  tier:2, mult:1.5, stack:1 },
  iron_sword:   { name:'Iron Sword',     kind:'sword',  tier:3, mult:1.5, stack:1 },
  dia_sword:    { name:'Diamond Sword',  kind:'sword',  tier:4, mult:1.5, stack:1 },
};
const TOOL_TINT = { wood:'#9a6b3f', stone:'#9a9a9a', iron:'#d8d8d8', dia:'#5fe8e0' };
const itemName = (id) => {
  if (typeof id === 'number') return NAMES[id] || ('Block ' + id);
  return (ITEMS[id] && ITEMS[id].name) || (TOOL[id] && TOOL[id].name) || id;
};
const stackMax = (id) => (typeof id === 'number') ? 64 : (ITEMS[id] ? ITEMS[id].stack : (TOOL[id] ? TOOL[id].stack : 64));
const itemPlacesBlock = (id) => (typeof id === 'number') ? id : ((ITEMS[id] && ITEMS[id].places != null) ? ITEMS[id].places : null);

/* ---------- recipes ---------- */
const P = B.PLANK, K = B.COBBLE, ST = 'stick', CO = 'coal', II = 'iron_ingot', DM = 'diamond';
const RECIPES = [
  { sh:[[B.LOG]],                       out:[B.PLANK,4] },
  { sh:[[P],[P]],                       out:[ST,4] },
  { sh:[[P,P],[P,P]],                   out:[B.CRAFT,1] },
  { sh:[[CO],[ST]],                     out:[B.TORCH,4] },
  { sh:[[K,K,K],[K,0,K],[K,K,K]],       out:[B.FURNACE,1] },
  { sh:[[CO,ST]],                       out:['igniter',1] },
  { sh:[['glowdust','glowdust'],['glowdust','glowdust']], out:[B.GLOWSTONE,1] },
  { ls:['redstone','glowdust','glowdust'], out:['eye',1] },
  { ls:[B.OBSIDIAN,'glowdust','glowdust',B.STONE], out:[B.EFRAME,2] },
  { sh:[['redstone',0,'redstone'],[0,'glowdust',0],['redstone',0,'redstone']], out:[B.LAMP,1] },
  { sh:[[ST],[K]],                      out:[B.LEVER,1] },
];
/* tool families × materials */
const TOOL_MATS = [[P,'wood'],[K,'stone'],[II,'iron'],[DM,'dia']];
for (const [mat, pre] of TOOL_MATS) {
  RECIPES.push({ sh:[[mat,mat,mat],[0,ST,0],[0,ST,0]],  out:[pre+'_pick',1] });
  RECIPES.push({ sh:[[mat,mat],[mat,ST],[0,ST]],        out:[pre+'_axe',1],  mirror:true });
  RECIPES.push({ sh:[[mat],[ST],[ST]],                  out:[pre+'_shovel',1] });
  RECIPES.push({ sh:[[mat],[mat],[ST]],                 out:[pre+'_sword',1] });
}
/* grid: array of {id,count}|null, size 2|3. null in patterns = empty cell. */
function matchRecipe(grid, size){
  // bounding box of filled cells
  let x0=size, x1=-1, y0=size, y1=-1;
  for (let y=0;y<size;y++) for (let x=0;x<size;x++) if (grid[y*size+x]){
    x0=Math.min(x0,x); x1=Math.max(x1,x); y0=Math.min(y0,y); y1=Math.max(y1,y);
  }
  if (x1 < 0) return null;
  const w = x1-x0+1, h = y1-y0+1;
  const cells = [];
  for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++){
    const s = grid[y*size+x]; cells.push(s ? s.id : 0);
  }
  const eq = (a, b) => a === b;
  for (const r of RECIPES){
    if (r.ls){
      // shapeless: exact multiset of item ids, count-insensitive
      const have = cells.filter(c => c !== 0);
      if (have.length !== r.ls.length) continue;
      const pool = [...r.ls];
      let ok = true;
      for (const c of have){
        const i = pool.findIndex(p => eq(p, c));
        if (i < 0){ ok = false; break; }
        pool.splice(i,1);
      }
      if (ok) return r.out;
      continue;
    }
    const pw = r.sh[0].length, ph = r.sh.length;
    if (pw !== w || ph !== h) continue;
    for (const mir of (r.mirror ? [false,true] : [false])){
      let ok = true;
      for (let y=0;y<h && ok;y++) for (let x=0;x<w && ok;x++){
        const want = r.sh[y][mir ? pw-1-x : x];
        if (!eq(want||0, cells[y*w+x])) ok = false;
      }
      if (ok) return r.out;
    }
  }
  return null;
}

/* ---------- atlas ----------
   16px tiles on a 16×16 grid (256×256). Every tile painted with layered
   noise so surfaces read as material, not flat color. */
const TS = 16, ACOLS = 16;
const TILE_INDEX = {};
const atlasPainters = {};

/* painter helpers */
function mkRng(seed){ let s = seed|0 || 1; return () => { s ^= s<<13; s ^= s>>>17; s ^= s<<5; return ((s>>>0) % 10000) / 10000; }; }
function shade(hex, f){
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, Math.round(((n>>16)&255) * f)));
  const g = Math.min(255, Math.max(0, Math.round(((n>>8)&255) * f)));
  const b = Math.min(255, Math.max(0, Math.round((n&255) * f)));
  return `rgb(${r},${g},${b})`;
}
/* paint a tile with a per-pixel callback: cb(x,y,rng) → color string */
function tilePixels(g, ox, oy, cb, seed){
  const rng = mkRng(seed);
  for (let y=0;y<TS;y++) for (let x=0;x<TS;x++){
    const c = cb(x, y, rng);
    if (!c) continue;
    g.fillStyle = c; g.fillRect(ox+x, oy+y, 1, 1);
  }
}
const noisy = (base, rng, amp=.14) => shade(base, 1 - amp/2 + rng()*amp);

/* --- per-tile painters (x,y,rng) → color --- */
atlasPainters.grass_top = (x,y,r) => { const v = r(); return shade(v<.5?'#6fae3e':'#7abc46', .85+v*.3); };
atlasPainters.dirt   = (x,y,r) => { const v = r(); return shade(v<.82?'#7c5a3a':'#6b4c30', .85+v*.3); };
atlasPainters.stone  = (x,y,r) => { const v = r(); return shade(v<.75?'#8b8b8b':'#7e7e7e', .88+v*.26); };
atlasPainters.cobble = (x,y,r) => {
  const cx = x%5, cy = (y + (x>7?2:0))%5, edge = cx===0||cy===0;
  return shade(edge ? '#5f5f5f' : (r()<.7?'#8f8f8f':'#7d7d7d'), .88 + r()*.26);
};
atlasPainters.sand   = (x,y,r) => { const v = r(); return shade(v<.85?'#e3d9a4':'#d9cd92', .92+v*.16); };
atlasPainters.gravel = (x,y,r) => { const v = r(); return shade(v<.6?'#8a8078':(v<.85?'#75695f':'#9c948c'), .85+v*.3); };
atlasPainters.snow   = (x,y,r) => { const v = r(); return shade('#eef3f8', .92+v*.12); };
atlasPainters.water  = (x,y,r) => { const v = r(); return shade(v<.8?'#3a63c8':'#4a72d8', .9+v*.2); };
atlasPainters.lava   = (x,y,r) => { const v = r(); return shade(v<.35?'#f6a022':(v<.7?'#e8720f':'#c84a08'), .9+v*.25); };
atlasPainters.log    = (x,y,r) => { const g = ((x*7 + ((x*x)%5))%9)<2; const v=r(); return shade(g?'#4a3520':'#6b4c2c', .85+v*.3); };
atlasPainters.log_top= (x,y,r) => {
  const d = Math.max(Math.abs(x-7.5), Math.abs(y-7.5));
  const ring = (Math.floor(d)%2)===0;
  return shade(d>6.6?'#4a3520':(ring?'#8a6a42':'#75592f'), .88+r()*.24);
};
atlasPainters.leaf   = (x,y,r) => { const v=r(); return v<.12 ? shade('#3d7a24',.9) : shade(v<.6?'#4d9030':'#5aa03c', .85+v*.3); };
atlasPainters.plank  = (x,y,r) => {
  const seam = (y%5===4) || ((x===7)&&y<5) || ((x===3)&&y>=10);
  return shade(seam?'#8a6238':'#b08148', .9+r()*.18);
};
atlasPainters.glass  = (x,y,r) => {
  const border = x===0||y===0||x===TS-1||y===TS-1;
  const glint = (x+y)%9===0;
  if (border) return 'rgba(210,235,245,0.9)';
  return glint ? 'rgba(235,250,255,0.55)' : 'rgba(190,225,240,0.22)';
};
atlasPainters.bedrock= (x,y,r) => { const v=r(); return shade(v<.5?'#3a3a3a':(v<.8?'#555':'#282828'), .9+v*.2); };
const oreTile = (gem, dark, seed) => (x,y,r) => {
  const v = r();
  let c = shade(v<.75?'#8b8b8b':'#7e7e7e', .88+v*.26);
  // gem blobs: two clusters of 2×2-ish pixels
  const blobs = [[4,4],[11,9]];
  for (const [bx,by] of blobs){
    const dx = Math.abs(x-bx), dy = Math.abs(y-by);
    if (dx<=1 && dy<=1 && ((dx+dy)<2 || r()<.4)) c = shade(gem, .8+r()*.4);
  }
  return c;
};
atlasPainters.coal    = oreTile('#2a2a2a', 1, 11);
atlasPainters.iron    = oreTile('#d8a878', 1, 12);
atlasPainters.gold    = oreTile('#f0d040', 1, 13);
atlasPainters.diamond = oreTile('#5fe8e0', 1, 14);
atlasPainters.rs_ore  = oreTile('#e03030', 1, 15);
atlasPainters.obsidian= (x,y,r) => { const v=r(); return shade(v<.78?'#1a1226':(v<.92?'#2a1e3e':'#0d0a14'), .9+v*.2); };
atlasPainters.netherrack = (x,y,r) => { const v=r(); return shade(v<.7?'#6e3232':(v<.9?'#5c2626':'#84403c'), .85+v*.3); };
atlasPainters.soul    = (x,y,r) => { const v=r(); return shade(v<.8?'#5a4a3a':'#6b5844', .88+v*.24); };
atlasPainters.glowstone = (x,y,r) => {
  const cell = ((x>>2)+(y>>2))%2===0;
  return shade(cell?'#f2d67a':'#d9b84e', .9+r()*.2);
};
atlasPainters.nbrick  = (x,y,r) => {
  const seam = (y%4===3) || (x===((y>>2)%2?7:3));
  return shade(seam?'#2e1418':'#4a2126', .88+r()*.22);
};
atlasPainters.endstone= (x,y,r) => { const v=r(); return shade(v<.85?'#dfe6b0':'#d2d8a2', .92+v*.14); };
atlasPainters.purpur  = (x,y,r) => {
  const border = x===0||y===0||x===TS-1||y===TS-1;
  return shade(border?'#8a5f8f':(r()<.75?'#a97eae':'#9a6f9f'), .9+r()*.18);
};
atlasPainters.grass_side = (x,y,r) => {
  const fringe = y<3 + ((x*5)%3);
  if (y < 3) { const v=r(); return shade(v<.6?'#6fae3e':'#7abc46', .85+v*.3); }
  const v = r();
  return shade(v<.82?'#7c5a3a':'#6b4c30', .85+v*.3);
};
atlasPainters.craft_top = (x,y,r) => {
  const grid = x===0||y===0||x===TS-1||y===TS-1||x===5||x===10||y===5||y===10;
  return shade(grid?'#6b4a26':'#c89058', .9+r()*.18);
};
atlasPainters.craft = (x,y,r) => {
  const tool = (x>=3&&x<=6&&y>=2&&y<=6) || (x>=9&&x<=12&&y>=6&&y<=12);
  const v=r();
  return shade(tool?'#8a8a8a':'#b08148', .9+v*.18);
};
atlasPainters.furn = (x,y,r) => {
  const mouth = x>=4&&x<=11&&y>=8&&y<=13;
  return shade(mouth?'#1c1c1c':(r()<.75?'#8b8b8b':'#7e7e7e'), .88+r()*.24);
};
atlasPainters.furn_top = (x,y,r) => { const v=r(); return shade(v<.85?'#7a7a7a':'#6d6d6d', .88+v*.24); };
atlasPainters.torch  = (x,y,r) => {
  if (x>=6&&x<=9&&y>=6) return shade(x>=7&&y<10?'#ffd23e':'#8a6238', .9+r()*.2);
  if (x>=7&&x<=8&&y>=4&&y<6) return '#fff6c8';
  return null;
};
atlasPainters.wire_off = (x,y,r) => {
  const on = Math.abs(((x+y)%8)-4)<2;
  return shade(on?'#5a0e0e':'#7a1414', .9+r()*.18);
};
atlasPainters.wire_on = (x,y,r) => {
  const on = Math.abs(((x+y)%8)-4)<2;
  return shade(on?'#ff4444':'#c82020', .9+r()*.2);
};
atlasPainters.lever_off = (x,y,r) => {
  if (x>=6&&x<=9&&y>=8) return shade('#8f8f8f', .9+r()*.2);
  if (x>=7&&x<=8&&y>=3&&y<8) return shade('#9a6b3f', .9+r()*.2);
  return null;
};
atlasPainters.lever_on = (x,y,r) => {
  if (x>=6&&x<=9&&y>=8) return shade('#8f8f8f', .9+r()*.2);
  if (x>=7&&x<=8&&y>=8&&y<13) return shade('#9a6b3f', .9+r()*.2);
  return null;
};
atlasPainters.lamp_off = (x,y,r) => {
  const border = x<2||y<2||x>13||y>13;
  return shade(border?'#5a4028':(r()<.8?'#6e5636':'#61492e'), .9+r()*.18);
};
atlasPainters.lamp_on = (x,y,r) => {
  const border = x<2||y<2||x>13||y>13;
  return shade(border?'#8a6a30':(r()<.8?'#ffd76e':'#eec254'), .92+r()*.14);
};
atlasPainters.portal = (x,y,r) => {
  const swirl = Math.sin((x+y*1.7)*.9)*.5+.5;
  return `rgba(${60+swirl*60|0},${20+swirl*30|0},${120+swirl*90|0},0.82)`;
};
atlasPainters.eportal = (x,y,r) => {
  const star = ((x*31+y*17)%11)===0;
  return star ? 'rgba(240,240,255,0.95)' : `rgba(8,8,20,0.88)`;
};
atlasPainters.eframe = (x,y,r) => {
  const border = x<2||y<2||x>13||y>13;
  return shade(border?'#4a5e3a':(r()<.8?'#8fa876':'#dfe6b0'), .9+r()*.16);
};
atlasPainters.eframe_eye = (x,y,r) => {
  const d = Math.max(Math.abs(x-7.5), Math.abs(y-7.5));
  if (d<3) return shade('#3fd8c8', .8+r()*.4);
  const border = x<2||y<2||x>13||y>13;
  return shade(border?'#4a5e3a':(r()<.8?'#8fa876':'#dfe6b0'), .9+r()*.16);
};
/* crack overlay stages: black translucent fractures */
function crackPainter(stage){
  const N = 3 + stage*4;
  const lines = [];
  const rng = mkRng(100+stage*7);
  for (let i=0;i<N;i++){
    const cx = 2+rng()*12, cy = 2+rng()*12;
    lines.push([cx, cy, cx + (rng()-.5)*8, cy + (rng()-.5)*8]);
  }
  return (x,y,r) => {
    for (const [ax,ay,bx,by] of lines){
      const dx = bx-ax, dy = by-ay, len = Math.hypot(dx,dy)||1;
      const t = Math.max(0, Math.min(1, ((x-ax)*dx + (y-ay)*dy)/(len*len)));
      const px = ax + dx*t, py = ay + dy*t;
      if (Math.hypot(x-px, y-py) < .7) return 'rgba(10,10,10,0.55)';
    }
    return null;
  };
}
for (let s=0;s<4;s++) atlasPainters['crack'+s] = crackPainter(s);

let ATLAS_CANVAS = null, ATLAS_TEX_HINT = null;
function buildAtlas(){
  if (ATLAS_CANVAS) return ATLAS_CANVAS;
  const c = document.createElement('canvas');
  c.width = ACOLS*TS; c.height = ACOLS*TS;
  const g = c.getContext('2d');
  let i = 0;
  for (const name of Object.keys(atlasPainters)){
    const ox = (i%ACOLS)*TS, oy = ((i/ACOLS)|0)*TS;
    tilePixels(g, ox, oy, atlasPainters[name], 0x9e37 + i*7919);
    TILE_INDEX[name] = i;
    i++;
  }
  ATLAS_CANVAS = c;
  return c;
}
const tileUV = (name) => {
  const i = TILE_INDEX[name];
  if (i == null) return [0,0];
  return [(i%ACOLS)/ACOLS, ((i/ACOLS)|0)/ACOLS];
};

/* ---------- item icons ---------- */
/* pixel-art item shapes, 16×16, two chars: X = body, D = darker body, S = stick */
const ICON_SHAPES = {
  pick: [
    "................", "....XXXXXXX.....", "...X.......XX...", "..X....S.....X..",
    ".X.....S......X.", "......SS......X.", ".....SS.......X.", "....SS........X.",
    "...SS.........X.", "..SS...........X", ".SS.............", "SS..............",
    "................", "................", "................", "................",
  ],
  axe: [
    "................", "....XXXX........", "...XXXXXX.......", "...XX..XXX......",
    "...XX...XX......", "...XX..SXX......", "....XX.S........", ".....XSS........",
    "......SS........", ".....SS.........", "....SS..........", "...SS...........",
    "..SS............", ".SS.............", "................", "................",
  ],
  shovel: [
    "................", "......XXX.......", ".....XXXXX......", ".....XXXXX......",
    ".....XXXXX......", "......XXX.......", "......SS........", "......SS........",
    "......SS........", "......SS........", "......SS........", "......SS........",
    "......SS........", "................", "................", "................",
  ],
  sword: [
    "................", "..........XX....", ".........XXX....", "........XXX.....",
    ".......XXX......", "......XXX.......", ".....XXX........", "....XXX.........",
    "...XXX..........", "..SXX...........", ".SSS............", "SS.S............",
    "S...............", "................", "................", "................",
  ],
  stick: [
    "................", "..........X.....", ".........XX.....", "........XX......",
    ".......XX.......", "......XX........", ".....XX.........", "....XX..........",
    "...XX...........", "..XX............", ".XX.............", "XX..............",
    "................", "................", "................", "................",
  ],
  lump: [
    "................", "................", ".....XXXX.......", "....XXXXXX......",
    "...XXXXXXXX.....", "..XXXXXXXXXX....", "..XXXXXXXXXX....", "..XXXXXXXXXX....",
    "..XXXXXXXXXX....", "..XXXXXXXXXX....", "...XXXXXXXX.....", "....XXXXXX......",
    ".....XXXX.......", "................", "................", "................",
  ],
  gem: [
    "................", "................", "......XXXX......", ".....XXXXXX.....",
    "....XXXXXXXX....", "....XXXXXXXX....", ".....XXXXXX.....", "......XXXX......",
    ".......XXX......", ".......XXX......", "........X.......", "................",
    "................", "................", "................", "................",
  ],
  dust: [
    "................", "................", "................", "...XX...XX......",
    "..XXXX.XXXX.....", "..XXXXXXXXXX....", "...XXXXXXXX.....", "....XXXXXX......",
    "...XX.XXXX......", "..XX...XX.XX....", ".XX.....XX......", "................",
    "................", "................", "................", "................",
  ],
  eye: [
    "................", "................", ".....XXXXXX.....", "...XXXXXXXXXX...",
    "..XXXDDDDDDXX...", "..XXDDDDDDDDXX..", "..XXDDDDDDDDXX..", "..XXDDDXXDDDDX..",
    "..XXDDDXXDDDDX..", "..XXDDDDDDDDXX..", "..XXXDDDDDDXX...", "...XXXXXXXXXX...",
    ".....XXXXXX.....", "................", "................", "................",
  ],
  igniter: [
    "................", "................", "......XX........", ".....XXXX.......",
    "....XXXXXX......", "....XXSSXX......", "....XSS.........", "...SSSS.........",
    "...SS...........", "..SS............", "..S.............", "................",
    "................", "................", "................", "................",
  ],
};
function itemIconCanvas(id){
  const c = document.createElement('canvas'); c.width = 16; c.height = 16;
  const g = c.getContext('2d');
  const draw = (shape, body, dark) => {
    const rows = ICON_SHAPES[shape];
    for (let y=0;y<16;y++) for (let x=0;x<16;x++){
      const ch = rows[y][x];
      if (ch === '.') continue;
      g.fillStyle = ch === 'S' ? '#8a6238' : (ch === 'D' ? dark : body);
      g.fillRect(x, y, 1, 1);
    }
  };
  if (TOOL[id]){
    const pre = id.split('_')[0];
    const shape = { pick:'pick', axe:'axe', shovel:'shovel', sword:'sword' }[TOOL[id].kind];
    draw(shape, TOOL_TINT[pre], shade(TOOL_TINT[pre], .6));
    return c;
  }
  switch (id){
    case 'stick':        draw('stick', '#9a6b3f'); break;
    case 'coal':         draw('lump', '#2e2e2e', '#181818'); break;
    case 'iron_ingot':   draw('lump', '#d8d8d8', '#a8a8a8'); break;
    case 'gold_ingot':   draw('lump', '#f0d040', '#c8a820'); break;
    case 'diamond':      draw('gem', '#5fe8e0', '#38b0a8'); break;
    case 'redstone':     draw('dust', '#e03030', '#a02020'); break;
    case 'glowdust':     draw('dust', '#f2d67a', '#c8a840'); break;
    case 'igniter':      draw('igniter', '#d8d8d8', '#a8a8a8'); break;
    case 'eye':          draw('eye', '#3fd8c8', '#1a8a80'); break;
    default: break;
  }
  return c;
}

/* hotbar shown in creative */
const CREATIVE_PALETTE = [
  B.GRASS, B.DIRT, B.STONE, B.COBBLE, B.SAND, B.GRAVEL, B.LOG, B.PLANK, B.LEAF,
  B.GLASS, B.SNOW, B.SAND, B.CRAFT, B.FURNACE, B.TORCH, B.LAMP, B.WIRE, B.LEVER,
  B.OBSIDIAN, B.NETHERRACK, B.SOUL, B.GLOWSTONE, B.NBRICK, B.ENDSTONE, B.PURPUR,
  B.WATER, B.LAVA, B.EFRAME, B.EPORTAL, B.PORTAL,
];

Object.assign(MCH, {
  B, BINFO, NAMES, ITEMS, TOOL, RECIPES, matchRecipe, itemName, stackMax, itemPlacesBlock,
  UNBREAKABLE, OPAQUE, SOLID, LIGHT_EMIT, INTERACT, RS_KIND,
  buildAtlas, tileUV, TILE_INDEX, TS, ACOLS, itemIconCanvas, CREATIVE_PALETTE,
});
