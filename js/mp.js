/* MCHTML v2.0 — mp.js
   Serverless WebRTC multiplayer: manual "MCHTML-…" signaling codes, star
   topology (host relays), dimension-aware peer avatars, idempotent edits.
   QA harness: window.__mpTest (bind / inject / tick / leave / drop / pump). */
window.MCH = window.MCH || {};
(function(){
const M = MCH;
const pid = Math.random().toString(16).slice(2, 8).padEnd(6, '0');
const MP = {
  pid, active: false, isHost: false,
  chans: [], pcs: [], pendingHost: null,
  peers: new Map(),                       // pid → { d, name, avatar }
};
M.mp = MP;
M.mpPid = () => MP.pid;
M.mpActive = () => MP.active && MP.chans.some(c => c.readyState === 'open');
M.netSend = send;

/* ---------- signaling codes ---------- */
const b64u = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const ub64u = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
const enc = (obj) => 'MCHTML-' + b64u(JSON.stringify(obj));
function dec(code){
  code = String(code || '').trim();
  if (!code.startsWith('MCHTML-')) throw new Error('not an MCHTML code');
  return JSON.parse(ub64u(code.slice(7)));
}

const RTC_CFG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
function gatherDone(pc){
  return new Promise((res) => {
    if (pc.iceGatheringState === 'complete') return res();
    const t = setTimeout(res, 3000);       // never hang without STUN
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete'){ clearTimeout(t); res(); }
    });
  });
}
const worldMode = () => (M.game && M.game.worldMeta) ? M.game.worldMeta.mode : 'creative';

/* ---------- connection flow ---------- */
async function host(cb){
  if (typeof RTCPeerConnection === 'undefined') throw new Error('WebRTC unavailable in this browser');
  MP.isHost = true;
  const pc = new RTCPeerConnection(RTC_CFG);
  const ch = pc.createDataChannel('mchtml');
  wireChannel(ch);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await gatherDone(pc);
  MP.pendingHost = pc;                     // becomes live on acceptReply
  cb(enc({ kind: 'offer', sdp: pc.localDescription.sdp }));
}
async function acceptReply(code){
  const msg = dec(code);
  if (msg.kind !== 'answer') throw new Error('that is not a reply code');
  const pc = MP.pendingHost;
  if (!pc) throw new Error('make an invite code first (Host)');
  MP.pendingHost = null;
  await pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
}
async function join(code, cb){
  if (typeof RTCPeerConnection === 'undefined') throw new Error('WebRTC unavailable in this browser');
  const msg = dec(code);
  if (msg.kind !== 'offer') throw new Error('that is not an invite code');
  MP.isHost = false;
  const pc = new RTCPeerConnection(RTC_CFG);
  pc.ondatachannel = (e) => wireChannel(e.channel);
  await pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await gatherDone(pc);
  cb(enc({ kind: 'answer', sdp: pc.localDescription.sdp }));
}

/* ---------- channel wiring ---------- */
function wireChannel(ch){
  MP.chans.push(ch);
  ch.onopen = () => {
    MP.active = true;
    sendOn(ch, { t: 'hello', pid: MP.pid, seed: M.SEED, mode: worldMode(), name: 'Player ' + MP.pid.slice(0, 3) });
    status();
  };
  ch.onclose = () => {
    const peerPid = ch.__pid;
    MP.chans = MP.chans.filter(c => c !== ch);
    if (peerPid && MP.peers.has(peerPid)){
      removeAvatar(peerPid);
      MP.peers.delete(peerPid);
    }
    if (!MP.chans.some(c => c.readyState === 'open')) MP.active = false;
    status();
  };
  ch.onmessage = (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch(err){ return; }
    if (!m || typeof m !== 'object') return;
    handleMsg(m, ch);
  };
}

/* ---------- message pipeline ---------- */
function handleMsg(m, fromCh){
  switch (m.t){
    case 'hello': {
      if (m.pid && m.pid !== MP.pid){
        fromCh.__pid = m.pid;
        ensurePeer(m.pid, m.name);
        if (m.seed !== M.SEED) M.ui && M.ui.toast('⚠ different world seed — terrain may not match');
        if (MP.isHost){
          sendOn(fromCh, { t: 'hello_back', pid: MP.pid, seed: M.SEED, mode: worldMode(), name: 'Host ' + MP.pid.slice(0, 3) });
        }
      }
      break;
    }
    case 'hello_back': {
      if (m.pid && m.pid !== MP.pid){
        fromCh.__pid = m.pid;
        ensurePeer(m.pid, m.name);
        if (m.seed !== M.SEED) M.ui && M.ui.toast('⚠ different world seed — terrain may not match');
      }
      break;
    }
    case 'p': {
      if (!m.pid || m.pid === MP.pid) break;
      fromCh.__pid = m.pid;
      const pr = ensurePeer(m.pid, m.name);
      pr.d = m.d;
      moveAvatar(m.pid, m);
      if (MP.isHost) relay(m, fromCh);
      break;
    }
    case 'e': {
      // idempotent: re-applying the same edit is a no-op; record=true so the
      // change persists in this world's save, net=false so we don't echo it back
      if (typeof m.x === 'number') M.setBlock(m.x, m.y, m.z, m.id, true, false, m.d);
      if (MP.isHost) relay(m, fromCh);
      break;
    }
    case 'dim': {
      if (m.pid && m.pid !== MP.pid){
        const pr = ensurePeer(m.pid, m.name);
        pr.d = m.d;
        const av = pr.avatar;
        if (av) av.visible = (m.d === M.DIM.cur);
        if (MP.isHost) relay(m, fromCh);
      }
      break;
    }
  }
}
function send(msg){
  const s = JSON.stringify(msg);
  for (const ch of MP.chans) if (ch.readyState === 'open') ch.send(s);
}
function sendOn(ch, msg){
  if (ch.readyState === 'open') ch.send(JSON.stringify(msg));
}
function relay(m, fromCh){
  for (const ch of MP.chans){
    if (ch === fromCh) continue;
    if (ch.readyState === 'open') ch.send(JSON.stringify(m));
  }
}

/* ---------- avatars ---------- */
function ensurePeer(p, name){
  let pr = MP.peers.get(p);
  if (!pr){
    pr = { d: 0, name: name || ('Player ' + p.slice(0, 3)), avatar: null };
    MP.peers.set(p, pr);
  }
  if (!pr.avatar && M.scene){
    const hue = parseInt(p, 16) % 360;
    const col = new THREE.Color().setHSL(hue / 360, .55, .5);
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(.5, 1.25, .3), new THREE.MeshBasicMaterial({ color: col }));
    body.position.y = .72;
    const head = new THREE.Mesh(new THREE.BoxGeometry(.45, .45, .45),
      new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(hue / 360, .35, .72) }));
    head.position.y = 1.57;
    g.add(body); g.add(head);
    g.visible = (pr.d === M.DIM.cur);
    M.scene.add(g);
    pr.avatar = g;
  }
  return pr;
}
function moveAvatar(p, m){
  const pr = ensurePeer(p, m.name);
  if (!pr.avatar) return;
  pr.avatar.position.set(m.x, m.y, m.z);
  pr.avatar.rotation.y = -m.yaw;
  pr.avatar.visible = (m.d === M.DIM.cur);
}
function removeAvatar(p){
  const pr = MP.peers.get(p);
  if (pr && pr.avatar && M.scene){
    M.scene.remove(pr.avatar);
    pr.avatar = null;
  }
}
function status(){
  const n = MP.chans.filter(c => c.readyState === 'open').length;
  M.ui && M.ui.mpStatus && M.ui.mpStatus(MP.active ? `connected · ${n} peer${n === 1 ? '' : 's'}` : 'offline');
}

/* ---------- leave / reset ---------- */
function leave(){
  for (const ch of MP.chans){ try { ch.close(); } catch(e){} }
  for (const pc of MP.pcs){ try { pc.close(); } catch(e){} }
  if (MP.pendingHost){ try { MP.pendingHost.close(); } catch(e){} MP.pendingHost = null; }
  for (const p of [...MP.peers.keys()]) removeAvatar(p);
  MP.chans = []; MP.pcs = [];
  MP.peers.clear();
  MP.active = false;
  MP.isHost = false;
  status();
}

/* ---------- QA harness (no real WebRTC needed) ---------- */
let bindN = 0;
window.__mpTest = {
  bind(name){
    const fpid = 'test' + (bindN++);
    const fake = {
      __pid: fpid, readyState: 'open',
      sent: [],
      send: (s) => { fake.sent.push(JSON.parse(s)); },
      close(){ fake.readyState = 'closed'; MP.chans = MP.chans.filter(c => c !== fake); },
    };
    MP.chans.push(fake);
    MP.active = true;
    ensurePeer(fpid, name);
    return fake;
  },
  inject(msg, fromCh){
    const dummy = { __pid: msg.pid, readyState: 'open', send: () => {} };
    handleMsg(msg, fromCh || dummy);
  },
  tick(now){ if (M.netPositionTick) M.netPositionTick(now); },
  leave(pidArg){
    if (pidArg){
      removeAvatar(pidArg);
      MP.peers.delete(pidArg);
      MP.chans = MP.chans.filter(c => c.__pid !== pidArg);
    } else leave();
  },
  drop(){ leave(); },
  pump(){ return { peers: MP.peers.size, chans: MP.chans.length, active: MP.active }; },
};

Object.assign(M, { mpHost: host, mpJoin: join, mpAcceptReply: acceptReply });
MP.host = host; MP.join = join; MP.acceptReply = acceptReply;
})();
