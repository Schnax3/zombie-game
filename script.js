
(function(){
"use strict";

/* ======================= UTILS ======================= */
const EARTH_R = 6371000;
const toRad = d => d*Math.PI/180;
const toDeg = r => r*180/Math.PI;
function haversine(lat1,lng1,lat2,lng2){
  const dLat=toRad(lat2-lat1), dLng=toRad(lng2-lng1);
  const a=Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
  return 2*EARTH_R*Math.asin(Math.min(1,Math.sqrt(a)));
}
function destPoint(lat,lng,distM,bearingDeg){
  const br=toRad(bearingDeg), lat1=toRad(lat), lng1=toRad(lng), dR=distM/EARTH_R;
  const lat2=Math.asin(Math.sin(lat1)*Math.cos(dR)+Math.cos(lat1)*Math.sin(dR)*Math.cos(br));
  const lng2=lng1+Math.atan2(Math.sin(br)*Math.sin(dR)*Math.cos(lat1), Math.cos(dR)-Math.sin(lat1)*Math.sin(lat2));
  return {lat: toDeg(lat2), lng: ((toDeg(lng2)+540)%360)-180};
}
function bearingBetween(lat1,lng1,lat2,lng2){
  const y=Math.sin(toRad(lng2-lng1))*Math.cos(toRad(lat2));
  const x=Math.cos(toRad(lat1))*Math.sin(toRad(lat2))-Math.sin(toRad(lat1))*Math.cos(toRad(lat2))*Math.cos(toRad(lng2-lng1));
  return (toDeg(Math.atan2(y,x))+360)%360;
}
const randRange = (a,b) => a + Math.random()*(b-a);
const uid = () => Math.random().toString(36).slice(2,9);
function randomPointAround(lat,lng,minR,maxR){
  const angle=randRange(0,360);
  const r=Math.sqrt(randRange(minR*minR, Math.max(minR*minR+1,maxR*maxR)));
  return destPoint(lat,lng,r,angle);
}
function sampleDistinct(arr,n){
  const copy=arr.slice(), out=[];
  while(copy.length && out.length<n){
    const idx=Math.floor(Math.random()*copy.length);
    out.push(copy.splice(idx,1)[0]);
  }
  return out;
}
const el = id => document.getElementById(id);
const DEBUG = {
  enabled:false,
  enable(){ this.enabled=true; console.info('[PZ DEBUG] enabled'); return this.enabled; },
  disable(){ this.enabled=false; console.info('[PZ DEBUG] disabled'); return this.enabled; },
  toggle(){ this.enabled=!this.enabled; console.info('[PZ DEBUG]', this.enabled ? 'enabled' : 'disabled'); return this.enabled; },
  log(...args){ if(this.enabled) console.debug('[PZ DEBUG]', ...args); }
};
window.pzDebug = DEBUG;
window.enablePzDebug = DEBUG.enable.bind(DEBUG);
window.disablePzDebug = DEBUG.disable.bind(DEBUG);
window.togglePzDebug = DEBUG.toggle.bind(DEBUG);
function fmtTime(sec){
  sec=Math.floor(sec);
  const m=Math.floor(sec/60), s=sec%60;
  return String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
}

/* ======================= CONFIG ======================= */
const DEFAULTS = {
  simSpeed:1.4, zombieSpeed:1.0, spawnIntervalSec:14, maxZombies:8,
  lootRequired:5, searchRadius:200, catchRadius:12, collectRadius:15,
  lives:3, pathOnlyLoot:true, endless:false, mode:'sim'
};
const PRESETS = {
  walk:{label:'Gehen', simSpeed:1.4, zombieSpeed:0.9, spawnIntervalSec:14, lootRequired:5,  searchRadius:200, maxZombies:8},
  jog: {label:'Joggen', simSpeed:2.8, zombieSpeed:2.0, spawnIntervalSec:9,  lootRequired:8,  searchRadius:350, maxZombies:12},
  bike:{label:'Radfahren', simSpeed:5.5, zombieSpeed:3.6, spawnIntervalSec:6,  lootRequired:12, searchRadius:600, maxZombies:16}
};
const DIFFICULTY = {
  easy:{spawnMult:0.7, speedMult:0.75, livesBonus:1},
  normal:{spawnMult:1, speedMult:1, livesBonus:0},
  hard:{spawnMult:1.5, speedMult:1.25, livesBonus:0},
  apocalypse:{spawnMult:2.4, speedMult:1.6, livesBonus:-1}
};
const TICK_MS=280;
const LEADERBOARD_CATEGORIES=['walk','jog','bike'];

let settings = {...DEFAULTS, ...PRESETS.walk};
let activePreset='walk', activeDifficulty='normal', presetBase=null;
let bestScore=null;
let bestEndless={};
let mapTheme='dark';
let leaderboardCategory='walk';
let leaderboardEntries=[];
let authUser=null;

/* ======================= STATE ======================= */
let status='menu'; // menu | playing | paused | won | lost
const state = {
  player:{lat:null,lng:null},
  startPoint:null,
  moveTarget:null,
  walkedDistance:0,
  lootCollected:0,
  livesLeft:3,
  invulnerableUntil:0
};
let elapsedSec=0;
let gameTimer=null, spawnTimer=null, gpsWatchId=null;
const zombies=new Map();
const loot=new Map();
let lastFlatPoints=[];

/* ======================= MAP ======================= */
let map, playerMarker, startPreviewMarker, escapeMarker=null, escapeCircle=null, escapeZone=null, tileLayer;
const ESCAPE_RADIUS=25;
const TILE_DARK='https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_LIGHT='https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
const TILE_ATTR='&copy; OpenStreetMap-Mitwirkende &copy; CARTO';

function initMap(){
  DEBUG.log('initMap start');
  map=L.map('map',{zoomControl:false, attributionControl:true, worldCopyJump:true}).setView([52.5219,13.4132],16);
  L.control.zoom({position:'bottomright'}).addTo(map);
  map.on('click', onMapClick);

  const prefersDark = !window.matchMedia || window.matchMedia('(prefers-color-scheme: dark)').matches;
  setMapTheme(prefersDark ? 'dark' : 'light');
  DEBUG.log('initMap theme', {prefersDark, mapTheme});

  if(navigator.geolocation){
    navigator.geolocation.getCurrentPosition(pos=>{
      setStartPoint(pos.coords.latitude, pos.coords.longitude);
      map.flyTo([pos.coords.latitude,pos.coords.longitude],17);
      DEBUG.log('initMap geolocation success', pos.coords);
    }, ()=>{ DEBUG.log('initMap geolocation failed'); }, {timeout:8000, enableHighAccuracy:true});
  }
}
function setMapTheme(theme){
  mapTheme=theme;
  if(tileLayer) map.removeLayer(tileLayer);
  tileLayer=L.tileLayer(theme==='dark'?TILE_DARK:TILE_LIGHT,{subdomains:'abcd',maxZoom:20,attribution:TILE_ATTR}).addTo(map);
  tileLayer.bringToBack();
  el('themeBtn').textContent = theme==='dark' ? '☀️' : '🌙';
  el('themeBtn').title = theme==='dark' ? 'Zu heller, bunter Karte wechseln' : 'Zu dunkler Karte wechseln';
}
function onMapClick(e){
  if(status==='menu'){
    setStartPoint(e.latlng.lat, e.latlng.lng);
  } else if(status==='playing' && settings.mode==='sim'){
    state.moveTarget={lat:e.latlng.lat, lng:e.latlng.lng};
  }
}
function setStartPoint(lat,lng){
  state.startPoint={lat,lng};
  if(startPreviewMarker) map.removeLayer(startPreviewMarker);
  startPreviewMarker=L.marker([lat,lng],{icon:L.divIcon({className:'',html:'<div class="pz-start-pin"></div>',iconSize:[22,22],iconAnchor:[11,20]})}).addTo(map);
}
function removeStartPreview(){
  if(startPreviewMarker){ map.removeLayer(startPreviewMarker); startPreviewMarker=null; }
}
function playerIcon(){
  return L.divIcon({className:'', html:'<div class="pz-player"><div class="pz-player-pulse"></div><div class="pz-player-dot"></div></div>', iconSize:[26,26], iconAnchor:[13,13]});
}
function zombieIcon(){
  return L.divIcon({className:'', html:'<div class="pz-zombie">🧟</div>', iconSize:[26,26], iconAnchor:[13,13]});
}
function lootIcon(){
  return L.divIcon({className:'', html:'<div class="pz-loot">🎒</div>', iconSize:[24,24], iconAnchor:[12,12]});
}
function ensurePlayerMarker(){
  if(playerMarker) map.removeLayer(playerMarker);
  playerMarker=L.marker([state.player.lat,state.player.lng],{icon:playerIcon(), zIndexOffset:1000}).addTo(map);
}

/* ======================= TOASTS / FX ======================= */
function toast(msg,type){
  const t=document.createElement('div');
  t.className='toast '+(type||'');
  t.textContent=msg;
  el('toast-container').appendChild(t);
  setTimeout(()=>t.remove(), 3100);
}
function flashDanger(){
  const f=el('danger-flash');
  f.classList.add('flash');
  setTimeout(()=>f.classList.remove('flash'), 220);
}

/* ======================= OVERPASS (begehbare Wege) ======================= */
async function fetchPathPoints(lat,lng,radius){
  const query='[out:json][timeout:20];way["highway"~"^(footway|path|pedestrian|residential|living_street|cycleway|track|unclassified|service|tertiary|secondary|primary)$"](around:'+radius+','+lat+','+lng+');out geom;';
  const url='https://overpass-api.de/api/interpreter?data='+encodeURIComponent(query);
  try{
    const ctrl=new AbortController();
    const t=setTimeout(()=>ctrl.abort(), 9000);
    const res=await fetch(url,{signal:ctrl.signal});
    clearTimeout(t);
    if(!res.ok) return [];
    const data=await res.json();
    const pts=[];
    (data.elements||[]).forEach(elem=>{
      if(elem.geometry) elem.geometry.forEach(g=>pts.push({lat:g.lat, lng:g.lon}));
    });
    return pts;
  }catch(err){
    return [];
  }
}

/* ======================= LOOT ======================= */
async function setupLoot(){
  loot.forEach(l=>map.removeLayer(l.marker));
  loot.clear();
  const count=Math.max(settings.lootRequired, Math.round(settings.lootRequired*1.6));
  let points=[];
  if(settings.pathOnlyLoot){
    toast('Lade begehbare Wege …','warn');
    lastFlatPoints=await fetchPathPoints(state.startPoint.lat, state.startPoint.lng, settings.searchRadius);
    if(lastFlatPoints.length>0){
      points=sampleDistinct(lastFlatPoints, count);
      if(points.length<count){
        const extra=count-points.length;
        for(let i=0;i<extra;i++) points.push(randomPointAround(state.startPoint.lat,state.startPoint.lng,15,settings.searchRadius));
      }
      toast(points.length+' Loot-Punkte auf echten Wegen platziert','success');
    } else {
      toast('Keine Wege gefunden – Loot wird zufällig platziert','warn');
      for(let i=0;i<count;i++) points.push(randomPointAround(state.startPoint.lat,state.startPoint.lng,15,settings.searchRadius));
    }
  } else {
    lastFlatPoints=[];
    for(let i=0;i<count;i++) points.push(randomPointAround(state.startPoint.lat,state.startPoint.lng,15,settings.searchRadius));
  }
  points.forEach(p=>{
    const id=uid();
    const marker=L.marker([p.lat,p.lng],{icon:lootIcon()}).addTo(map);
    loot.set(id,{lat:p.lat,lng:p.lng,marker});
  });
}
function spawnReplacementLoot(){
  let p;
  if(settings.pathOnlyLoot && lastFlatPoints.length>0){
    p=lastFlatPoints[Math.floor(Math.random()*lastFlatPoints.length)];
  } else {
    p=randomPointAround(state.startPoint.lat,state.startPoint.lng,15,settings.searchRadius);
  }
  const id=uid();
  const marker=L.marker([p.lat,p.lng],{icon:lootIcon()}).addTo(map);
  loot.set(id,{lat:p.lat,lng:p.lng,marker});
}

function setupEscapeZone(){
  DEBUG.log('setupEscapeZone', {startPoint:state.startPoint, searchRadius:settings.searchRadius});
  if(escapeMarker){ map.removeLayer(escapeMarker); escapeMarker=null; }
  if(escapeCircle){ map.removeLayer(escapeCircle); escapeCircle=null; }
  const p=randomPointAround(state.startPoint.lat, state.startPoint.lng, settings.searchRadius*0.8, settings.searchRadius*1.1);
  escapeZone=p;
  escapeCircle=L.circle([p.lat,p.lng],{radius:ESCAPE_RADIUS,color:'#2ecc71',weight:2,fillOpacity:0.15}).addTo(map);
  escapeMarker=L.marker([p.lat,p.lng],{icon:L.divIcon({className:'',html:'<div class="pz-escape">🚪</div>',iconSize:[30,30],iconAnchor:[15,15]})}).addTo(map);
  DEBUG.log('setupEscapeZone created', escapeZone);
}

/* ======================= ZOMBIES ======================= */
function clearAllZombies(){
  zombies.forEach(z=>map.removeLayer(z.marker));
  zombies.clear();
}
function spawnZombie(){
  if(zombies.size<settings.maxZombies){
    const p=randomPointAround(state.player.lat,state.player.lng, settings.searchRadius*0.6, settings.searchRadius*1.1);
    const id=uid();
    const marker=L.marker([p.lat,p.lng],{icon:zombieIcon()}).addTo(map);
    zombies.set(id,{id,lat:p.lat,lng:p.lng,marker,wanderTarget:null});
    DEBUG.log('spawnZombie', {id,p});
  }
  scheduleNextSpawn();
}
function scheduleNextSpawn(){
  clearTimeout(spawnTimer);
  if(status!=='playing') return;
  const base=settings.spawnIntervalSec*1000;
  const delay=Math.max(1200, base + randRange(-base*0.35, base*0.35));
  spawnTimer=setTimeout(spawnZombie, delay);
}
function updateZombie(z,dt){
  const dist=haversine(z.lat,z.lng,state.player.lat,state.player.lng);
  const detectR=settings.searchRadius*0.85;
  let bearing, speed;
  if(dist<detectR){
    bearing=bearingBetween(z.lat,z.lng,state.player.lat,state.player.lng) + randRange(-8,8);
    speed=settings.zombieSpeed;
  } else {
    if(!z.wanderTarget || haversine(z.lat,z.lng,z.wanderTarget.lat,z.wanderTarget.lng)<5){
      z.wanderTarget=randomPointAround(z.lat,z.lng,20,80);
    }
    bearing=bearingBetween(z.lat,z.lng,z.wanderTarget.lat,z.wanderTarget.lng);
    speed=settings.zombieSpeed*0.4;
  }
  const np=destPoint(z.lat,z.lng,speed*dt,bearing);
  z.lat=np.lat; z.lng=np.lng;
  z.marker.setLatLng([z.lat,z.lng]);
  const despawnR=settings.searchRadius*2.4;
  if(haversine(z.lat,z.lng,state.player.lat,state.player.lng)>despawnR){
    map.removeLayer(z.marker);
    zombies.delete(z.id);
  }
}

/* ======================= INPUT: JOYSTICK + KEYS ======================= */
const joystick={pointerDown:false, bearing:0, magnitude:0};
const KEY_BEARING={ArrowUp:0,ArrowDown:180,ArrowLeft:270,ArrowRight:90,w:0,s:180,a:270,d:90,W:0,S:180,A:270,D:90};
const activeKeys=new Set();
function initJoystick(){
  const base=el('joyBase'), knob=el('joyKnob');
  let rect=null;
  function applyPoint(clientX,clientY){
    const cx=rect.left+rect.width/2, cy=rect.top+rect.height/2;
    const dx=clientX-cx, dy=clientY-cy;
    const maxR=rect.width/2;
    const dist=Math.min(Math.hypot(dx,dy), maxR);
    const angle=Math.atan2(dy,dx);
    knob.style.transform='translate('+(Math.cos(angle)*dist)+'px,'+(Math.sin(angle)*dist)+'px)';
    joystick.magnitude=dist/maxR;
    joystick.bearing=(toDeg(Math.atan2(dx,-dy))+360)%360;
  }
  function start(clientX,clientY){ rect=base.getBoundingClientRect(); joystick.pointerDown=true; applyPoint(clientX,clientY); }
  function end(){ joystick.pointerDown=false; joystick.magnitude=0; knob.style.transform='translate(0,0)'; }
  base.addEventListener('mousedown', e=>{
    start(e.clientX,e.clientY);
    const mm=ev=>applyPoint(ev.clientX,ev.clientY);
    const mu=()=>{ end(); window.removeEventListener('mousemove',mm); window.removeEventListener('mouseup',mu); };
    window.addEventListener('mousemove',mm); window.addEventListener('mouseup',mu);
  });
  base.addEventListener('touchstart', e=>{ const t=e.touches[0]; start(t.clientX,t.clientY); }, {passive:true});
  base.addEventListener('touchmove', e=>{ const t=e.touches[0]; applyPoint(t.clientX,t.clientY); e.preventDefault(); }, {passive:false});
  base.addEventListener('touchend', end);
  base.addEventListener('touchcancel', end);

  window.addEventListener('keydown', e=>{ if(KEY_BEARING[e.key]!==undefined){ activeKeys.add(e.key); } });
  window.addEventListener('keyup', e=>{ if(KEY_BEARING[e.key]!==undefined){ activeKeys.delete(e.key); } });
}
function getInputVector(){
  if(joystick.pointerDown && joystick.magnitude>0.15){
    return {bearing:joystick.bearing, magnitude:joystick.magnitude};
  }
  if(activeKeys.size>0){
    let vx=0, vy=0;
    activeKeys.forEach(k=>{ const b=toRad(KEY_BEARING[k]); vx+=Math.sin(b); vy+=-Math.cos(b); });
    if(vx||vy) return {bearing:(toDeg(Math.atan2(vx,-vy))+360)%360, magnitude:1};
  }
  return null;
}

/* ======================= GAME LOOP ======================= */
function moveSimPlayer(dt){
  const input=getInputVector();
  let bearing=null, distStep=settings.simSpeed*dt;
  if(input){
    bearing=input.bearing;
    distStep*=input.magnitude;
  } else if(state.moveTarget){
    const d=haversine(state.player.lat,state.player.lng,state.moveTarget.lat,state.moveTarget.lng);
    if(d<1){ state.moveTarget=null; }
    else {
      bearing=bearingBetween(state.player.lat,state.player.lng,state.moveTarget.lat,state.moveTarget.lng);
      if(d<distStep) distStep=d;
    }
  }
  if(bearing!==null && distStep>0){
    const np=destPoint(state.player.lat,state.player.lng,distStep,bearing);
    state.walkedDistance+=distStep;
    state.player.lat=np.lat; state.player.lng=np.lng;
  }
}
function checkCatch(){
  if(performance.now()<state.invulnerableUntil) return;
  zombies.forEach((z,id)=>{
    if(haversine(z.lat,z.lng,state.player.lat,state.player.lng)<settings.catchRadius){
      state.livesLeft--;
      state.invulnerableUntil=performance.now()+3000;
      map.removeLayer(z.marker); zombies.delete(id);
      flashDanger();
      toast('Ein Zombie hat dich erwischt! Noch '+Math.max(0,state.livesLeft)+' Leben','danger');
    }
  });
}
function checkLoot(){
  loot.forEach((l,id)=>{
    if(haversine(l.lat,l.lng,state.player.lat,state.player.lng)<settings.collectRadius){
      map.removeLayer(l.marker); loot.delete(id);
      state.lootCollected++;
      toast('Loot eingesammelt! ('+state.lootCollected+'/'+(settings.endless?'∞':settings.lootRequired)+')','success');
      if(!settings.endless && state.lootCollected===settings.lootRequired){
        toast('Genug Loot! Lauf zur grünen Extraktionszone 🚪','success');
      }
      if(settings.endless) spawnReplacementLoot();
    }
  });
}
function checkWinLose(){
  if(state.livesLeft<=0){ endGame('lost'); return; }
  if(settings.endless) return;
  if(state.lootCollected>=settings.lootRequired && escapeZone){
    const d=haversine(state.player.lat,state.player.lng,escapeZone.lat,escapeZone.lng);
    if(d<ESCAPE_RADIUS) endGame('won');
  }
}
function updateHUD(){
  el('hudLoot').textContent=state.lootCollected+'/'+(settings.endless?'∞':settings.lootRequired);
  el('hearts').textContent='❤️'.repeat(Math.max(0,state.livesLeft))+'🖤'.repeat(Math.max(0,settings.lives-state.livesLeft));
  el('hudTimer').textContent=fmtTime(elapsedSec);
}
function tick(){
  if(status!=='playing') return;
  const dt=TICK_MS/1000;
  elapsedSec+=dt;
  if(settings.mode==='sim') moveSimPlayer(dt);
  zombies.forEach(z=>updateZombie(z,dt));
  checkCatch();
  checkLoot();
  if(playerMarker) playerMarker.setLatLng([state.player.lat,state.player.lng]);
  map.panTo([state.player.lat,state.player.lng],{animate:true, duration:TICK_MS/1000, easeLinearity:1});
  updateHUD();
  checkWinLose();
}
function startLoops(){
  gameTimer=setInterval(tick, TICK_MS);
  scheduleNextSpawn();
}
function stopLoops(){
  clearInterval(gameTimer); clearTimeout(spawnTimer);
  gameTimer=null; spawnTimer=null;
}

/* ======================= GPS MODE ======================= */
function startGpsWatch(){
  if(!navigator.geolocation){
    toast('GPS nicht verfügbar – wechsle zu Simulation','warn');
    settings.mode='sim'; document.body.dataset.mode='sim';
    return;
  }
  gpsWatchId=navigator.geolocation.watchPosition(pos=>{
    const {latitude,longitude}=pos.coords;
    if(state.player.lat!=null) state.walkedDistance+=haversine(state.player.lat,state.player.lng,latitude,longitude);
    state.player.lat=latitude; state.player.lng=longitude;
  }, ()=>{
    toast('GPS-Zugriff nicht möglich – wechsle zu Simulation','warn');
    settings.mode='sim'; document.body.dataset.mode='sim';
    stopGpsWatch();
  }, {enableHighAccuracy:true, maximumAge:2000, timeout:10000});
}
function stopGpsWatch(){
  if(gpsWatchId!=null){ navigator.geolocation.clearWatch(gpsWatchId); gpsWatchId=null; }
}

/* ======================= GAME FLOW ======================= */
async function startGame(){
  if(!state.startPoint){
    const c=map.getCenter();
    state.startPoint={lat:c.lat, lng:c.lng};
  }
  DEBUG.log('startGame begin', {settings, state});
  state.player.lat=state.startPoint.lat;
  state.player.lng=state.startPoint.lng;
  state.livesLeft=settings.lives;
  state.lootCollected=0;
  state.walkedDistance=0;
  state.moveTarget=null;
  state.invulnerableUntil=0;
  elapsedSec=0;

  removeStartPreview();
  ensurePlayerMarker();
  clearAllZombies();
  el('startBtn').disabled=true; el('startBtn').textContent='LADE …';
  await setupLoot();
  if(!settings.endless) setupEscapeZone();
  el('startBtn').disabled=false; el('startBtn').textContent='▶ SPIEL STARTEN';

  status='playing';
  document.body.dataset.status='playing';
  document.body.dataset.mode=settings.mode;
  if(settings.mode==='gps') startGpsWatch();
  startLoops();
  saveSettings();
  DEBUG.log('startGame complete', {status, elapsedSec, livesLeft: state.livesLeft});
}
function pauseGame(){
  status='paused';
  document.body.dataset.status='paused';
  stopLoops();
  el('menuView').style.display='none';
  el('pauseView').style.display='block';
}
function resumeGame(){
  status='playing';
  document.body.dataset.status='playing';
  startLoops();
}
function quitGame(){
  stopLoops(); stopGpsWatch();
  clearAllZombies();
  loot.forEach(l=>map.removeLayer(l.marker)); loot.clear();
  if(escapeMarker){ map.removeLayer(escapeMarker); escapeMarker=null; }
  if(escapeCircle){ map.removeLayer(escapeCircle); escapeCircle=null; }
  escapeZone=null;
  status='menu';
  document.body.dataset.status='menu';
  el('menuView').style.display='block';
  el('pauseView').style.display='none';
  setStartPoint(state.player.lat, state.player.lng);
}
function endGame(result){
  status=result;
  document.body.dataset.status='menu';
  stopLoops(); stopGpsWatch();
  updateBestScore();
  showResult(result);
}
function showResult(result){
  const card=el('resultCard');
  card.className='result-card '+(result==='won'?'win':'lose');
  el('resultTitle').textContent=result==='won' ? '🎉 GESCHAFFT!' : '💀 ERWISCHT!';
  el('resultStats').innerHTML=
    'Loot gesammelt: <b>'+state.lootCollected+'</b><br>'+
    'Überlebenszeit: <b>'+fmtTime(elapsedSec)+'</b><br>'+
    'Distanz: <b>'+(state.walkedDistance/1000).toFixed(2)+' km</b><br>'+
    'Modus: <b>'+PRESETS[activePreset].label+' / '+activeDifficulty+'</b>';
  el('overlay-result').classList.add('open');
}

/* ======================= SETTINGS UI ======================= */
function applyPreset(name){
  activePreset=name;
  presetBase={...DEFAULTS, ...PRESETS[name]};
  applyDifficulty(activeDifficulty, true);
  refreshSettingsUI();
}
function applyDifficulty(name, skipRefresh){
  activeDifficulty=name;
  const d=DIFFICULTY[name];
  const base=presetBase || {...DEFAULTS, ...PRESETS[activePreset]};
  settings.simSpeed=base.simSpeed;
  settings.zombieSpeed=+(base.zombieSpeed*d.speedMult).toFixed(2);
  settings.spawnIntervalSec=+(base.spawnIntervalSec/d.spawnMult).toFixed(1);
  settings.maxZombies=base.maxZombies;
  settings.lootRequired=base.lootRequired;
  settings.searchRadius=base.searchRadius;
  settings.lives=Math.max(1, DEFAULTS.lives + d.livesBonus);
  if(!skipRefresh) refreshSettingsUI();
}
function markCustom(){
  document.querySelectorAll('[data-preset]').forEach(b=>b.classList.remove('active'));
  updatePresetHint();
}
function updatePresetHint(){
  const label = PRESETS[activePreset]?.label || activePreset;
  const presetLabel = el('presetLabel');
  const scoreHint = el('presetScoreHint');
  if(presetLabel) presetLabel.textContent = 'Ausgewählt: '+label;
  if(scoreHint) scoreHint.textContent = settings.endless ? 'Ranglisten-Status: Gewertet (Endlosmodus)' : 'Ranglisten-Status: Nur im Endlosmodus gewertet';
}
function getLeaderboardCategoryLabel(cat){
  return PRESETS[cat]?.label || cat;
}
function isLeaderboardEligible(){
  return settings.endless;
}
function updateLeaderboardWarning(){
  const warn = el('leaderboardWarning');
  const btn = el('submitScoreBtn');
  if(!warn) return;
  let text = '';
  let disabled = false;
  if(!settings.endless){
    text = 'Nur Endlosmodus-Scores werden in die Rangliste übernommen.';
    disabled = true;
  } else if(!authUser){
    text = 'Bitte anmelden, um deinen besten Endless-Score zu senden.';
    disabled = true;
  } else if(!currentRunIsBestEndless()){
    text = 'Aktueller Lauf ist nicht dein bisher bester Endless-Lauf in dieser Kategorie.';
    disabled = true;
  } else {
    text = 'Perfekt: Dein bester Endless-Lauf kann jetzt an die Rangliste gesendet werden.';
    disabled = false;
  }
  warn.textContent = text;
  if(btn) btn.disabled = disabled;
}
function setLeaderboardCategory(cat){
  leaderboardCategory = cat;
  document.querySelectorAll('[data-leaderboard]').forEach(b=>b.classList.toggle('active', b.dataset.leaderboard===cat));
  renderLeaderboard();
  updateLeaderboardWarning();
}
function renderLeaderboard(){
  const list = el('leaderboardList');
  if(!list) return;
  list.innerHTML = '';
  if(!leaderboardEntries.length){
    list.innerHTML = '<div class="leaderboard-empty">Keine Werte geladen.</div>';
    return;
  }
  const rows = leaderboardEntries.map((item,i)=>{
    const name = item.email ? item.email.split('@')[0] : 'Anonym';
    return '<div class="leaderboard-row">'+
      '<span class="rank">'+(i+1)+'.</span>'+ 
      '<span class="name">'+name+'</span>'+ 
      '<span class="score">'+item.loot+' Loot</span>'+ 
      '<span class="score">'+fmtTime(item.time)+'</span>'+ 
    '</div>';
  });
  list.innerHTML = rows.join('');
}
async function fetchLeaderboard(){
  try{
    const { ref, query, orderByChild, limitToLast, get } = window.firebaseUtils || {};
    if(!ref || !query || !orderByChild || !limitToLast || !get){
      DEBUG.log('Firebase not loaded; cannot fetch leaderboard');
      return;
    }
    const db = window.firebaseDb;
    const leaderRef = ref(db, 'leaderboard/'+leaderboardCategory);
    const q = query(leaderRef, orderByChild('loot'), limitToLast(20));
    const snap = await get(q);
    const entries=[];
    if(snap.exists()){
      snap.forEach(child=>{
        entries.push(child.val());
      });
    }
    entries.sort((a,b)=>{
      if(b.loot!==a.loot) return b.loot-a.loot;
      return a.time-b.time;
    });
    leaderboardEntries = entries.slice(0,10);
    renderLeaderboard();
  }catch(e){
    console.error('fetchLeaderboard failed', e);
  }
}
async function submitScore(){
  DEBUG.log('submitScore called', {authUser: !!authUser, endless: settings.endless, category: leaderboardCategory});
  const { ref, push, set } = window.firebaseUtils || {};
  if(!ref || !push || !set){
    toast('Firebase nicht vollständig geladen. Aktualisiere die Seite.', 'danger');
    return;
  }
  if(!authUser){ toast('Bitte zuerst anmelden.', 'warn'); return; }
  if(!settings.endless){
    toast('Nur Endlosmodus-Scores werden in die Rangliste übernommen.', 'warn');
    return;
  }
  if(!currentRunIsBestEndless()){
    toast('Nur dein bester Endless-Lauf pro Kategorie kann in die Rangliste.', 'warn');
    return;
  }
  try{
    const db = window.firebaseDb;
    if(!db){
      toast('Firebase Datenbank nicht verfügbar.', 'danger');
      return;
    }
    const scoreRef = push(ref(db, 'leaderboard/'+leaderboardCategory));
    const payload = {
      uid: authUser.uid,
      email: authUser.email || '',
      loot: state.lootCollected,
      time: elapsedSec,
      preset: activePreset,
      date: new Date().toISOString()
    };
    DEBUG.log('submitScore payload', payload);
    await set(scoreRef, payload);
    maybeUpdateBestEndless();
    toast('Score im Leaderboard gespeichert!', 'success');
    fetchLeaderboard();
  }catch(e){
    console.error('submitScore failed', e);
    toast('Fehler beim Senden des Score: '+e.message, 'danger');
  }
}
function saveBestEndless(){
  try{
    localStorage.setItem('pz_best_endless', JSON.stringify(bestEndless));
  }catch(e){ /* ignore */ }
}
function loadBestEndless(){
  try{
    const raw = localStorage.getItem('pz_best_endless');
    if(raw) bestEndless = JSON.parse(raw);
  }catch(e){ /* ignore */ }
}
function currentRunIsBestEndless(){
  const old = bestEndless[activePreset];
  if(!old) return true;
  if(state.lootCollected > old.loot) return true;
  if(state.lootCollected === old.loot && elapsedSec > old.time) return true;
  return false;
}
function maybeUpdateBestEndless(){
  if(!settings.endless) return false;
  if(!currentRunIsBestEndless()) return false;
  bestEndless[activePreset] = {
    loot: state.lootCollected,
    time: elapsedSec,
    preset: activePreset,
    date: new Date().toISOString()
  };
  saveBestEndless();
  updateLeaderboardWarning();
  return true;
}
function updateAuthUI(){
  const status = el('authStatus');
  const form = el('authForm');
  const signOutBtn = el('signOutBtn');
  if(authUser){
    if(status) status.textContent = 'Angemeldet als '+(authUser.email || 'Unbekannt');
    if(form) form.style.display = 'none';
    if(signOutBtn) signOutBtn.style.display = 'block';
  } else {
    if(status) status.textContent = 'Nicht angemeldet';
    if(form) form.style.display = 'grid';
    if(signOutBtn) signOutBtn.style.display = 'none';
  }
  updateLeaderboardWarning();
}
async function signIn(){
  const email = el('authEmail').value.trim();
  const pass = el('authPassword').value;
  if(!email || !pass){ toast('E-Mail und Passwort eingeben.', 'warn'); return; }
  try{
    const { signInWithEmailAndPassword } = window.firebaseUtils;
    const userCred = await signInWithEmailAndPassword(window.firebaseAuth, email, pass);
    authUser = userCred.user;
    updateAuthUI();
    toast('Angemeldet.', 'success');
  }catch(e){
    console.error('signIn failed', e);
    toast('Anmeldung fehlgeschlagen.', 'danger');
  }
}
async function signUp(){
  const email = el('authEmail').value.trim();
  const pass = el('authPassword').value;
  if(!email || !pass){ toast('E-Mail und Passwort eingeben.', 'warn'); return; }
  try{
    const { createUserWithEmailAndPassword } = window.firebaseUtils;
    const userCred = await createUserWithEmailAndPassword(window.firebaseAuth, email, pass);
    authUser = userCred.user;
    updateAuthUI();
    toast('Registrierung erfolgreich.', 'success');
  }catch(e){
    console.error('signUp failed', e);
    toast('Registrierung fehlgeschlagen.', 'danger');
  }
}
async function signOutUser(){
  try{
    const { signOut } = window.firebaseUtils;
    await signOut(window.firebaseAuth);
    authUser = null;
    updateAuthUI();
    toast('Abgemeldet.', 'success');
  }catch(e){
    console.error('signOut failed', e);
    toast('Abmelden fehlgeschlagen.', 'danger');
  }
}
function initFirebaseAuth(){
  try{
    const { onAuthStateChanged } = window.firebaseUtils;
    if(!onAuthStateChanged) return;
    onAuthStateChanged(window.firebaseAuth, user=>{
      authUser = user;
      updateAuthUI();
    });
  }catch(e){
    console.error('initFirebaseAuth failed', e);
  }
}
function switchTab(tabId){
  document.querySelectorAll('#sheet > div').forEach(elm=>{
    if(elm.id===tabId) elm.style.display = elm.id==='menuView' ? 'block' : (elm.id===tabId ? 'block' : 'none');
    else if(elm.id==='menuView' || elm.id==='leaderboardView' || elm.id==='accountView') elm.style.display = elm.id===tabId ? 'block' : 'none';
  });
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active', b.dataset.tab===tabId));
  if(tabId==='leaderboardView') fetchLeaderboard();
}
function refreshSettingsUI(){
  DEBUG.log('refreshSettingsUI', {mode:settings.mode, endless:settings.endless, pathOnlyLoot:settings.pathOnlyLoot});
  document.querySelectorAll('[data-preset]').forEach(b=>b.classList.toggle('active', b.dataset.preset===activePreset));
  document.querySelectorAll('[data-diff]').forEach(b=>b.classList.toggle('active', b.dataset.diff===activeDifficulty));
  document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active', b.dataset.mode===settings.mode));
  el('gpsHint').style.display = settings.mode==='gps' ? 'block' : 'none';

  el('rSimSpeed').value=settings.simSpeed; el('rSimSpeedVal').textContent=settings.simSpeed+' m/s';
  el('rSpawn').value=settings.spawnIntervalSec; el('rSpawnVal').textContent=settings.spawnIntervalSec+'s';
  el('rZSpeed').value=settings.zombieSpeed; el('rZSpeedVal').textContent=settings.zombieSpeed+' m/s';
  el('rMaxZ').value=settings.maxZombies; el('rMaxZVal').textContent=settings.maxZombies;
  el('rLoot').value=settings.lootRequired; el('rLootVal').textContent=settings.lootRequired;
  el('rRadius').value=settings.searchRadius; el('rRadiusVal').textContent=settings.searchRadius+' m';
  el('rCatch').value=settings.catchRadius; el('rCatchVal').textContent=settings.catchRadius+' m';
  el('rCollect').value=settings.collectRadius; el('rCollectVal').textContent=settings.collectRadius+' m';
  el('rLives').value=settings.lives; el('rLivesVal').textContent=settings.lives;
  el('cPathOnly').checked=settings.pathOnlyLoot;
  el('cEndless').checked=settings.endless;
  updatePresetHint();
  updateLeaderboardWarning();
}
function bindSettingsUI(){
  DEBUG.log('bindSettingsUI');
  document.querySelectorAll('[data-preset]').forEach(b=>b.addEventListener('click',()=>applyPreset(b.dataset.preset)));
  document.querySelectorAll('[data-diff]').forEach(b=>b.addEventListener('click',()=>applyDifficulty(b.dataset.diff)));
  document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>{
    settings.mode=b.dataset.mode; document.body.dataset.mode=settings.mode; refreshSettingsUI();
  }));

  el('advToggle').addEventListener('click',()=>{
    const body=el('advBody'); const open=body.classList.toggle('open');
    el('advToggle').textContent=(open?'▾':'▸')+' Erweiterte Einstellungen '+(open?'verbergen':'anzeigen');
  });

  const bind=(id,key,parse,suffix)=>{
    el(id).addEventListener('input',e=>{
      settings[key]=parse(e.target.value);
      el(id+'Val').textContent=e.target.value+(suffix||'');
      markCustom();
    });
  };
  bind('rSimSpeed','simSpeed',parseFloat,' m/s');
  bind('rSpawn','spawnIntervalSec',parseFloat,'s');
  bind('rZSpeed','zombieSpeed',parseFloat,' m/s');
  bind('rMaxZ','maxZombies',v=>parseInt(v,10));
  bind('rLoot','lootRequired',v=>parseInt(v,10));
  bind('rRadius','searchRadius',v=>parseInt(v,10),' m');
  bind('rCatch','catchRadius',v=>parseInt(v,10),' m');
  bind('rCollect','collectRadius',v=>parseInt(v,10),' m');
  bind('rLives','lives',v=>parseInt(v,10));

  el('cPathOnly').addEventListener('change',e=>{ settings.pathOnlyLoot=e.target.checked; DEBUG.log('cPathOnly change', settings.pathOnlyLoot); markCustom(); });
  const endlessCheckbox = el('cEndless');
  let endlessPrevChecked = endlessCheckbox.checked;
  endlessCheckbox.addEventListener('mousedown', ()=>{ endlessPrevChecked = endlessCheckbox.checked; });
  endlessCheckbox.addEventListener('click', e=>{
    const expected = !endlessPrevChecked;
    if(endlessCheckbox.checked !== expected){
      DEBUG.log('cEndless click fix', {prev:endlessPrevChecked, current:endlessCheckbox.checked, expected});
      endlessCheckbox.checked = expected;
    }
    settings.endless = endlessCheckbox.checked;
    DEBUG.log('cEndless click', {checked:endlessCheckbox.checked, settings});
    markCustom();
  });

  el('startBtn').addEventListener('click', startGame);
  el('pauseBtn').addEventListener('click', pauseGame);
  el('resumeBtn').addEventListener('click', resumeGame);
  el('restartBtn').addEventListener('click', ()=>{ el('pauseView').style.display='none'; el('menuView').style.display='block'; quitGame(); startGame(); });
  el('quitBtn').addEventListener('click', quitGame);
  el('playAgainBtn').addEventListener('click', ()=>{ el('overlay-result').classList.remove('open'); startGame(); });
  el('resultMenuBtn').addEventListener('click', ()=>{ el('overlay-result').classList.remove('open'); quitGame(); });

  el('infoBtn').addEventListener('click', ()=>el('legend').classList.toggle('open'));
  el('themeBtn').addEventListener('click', ()=>setMapTheme(mapTheme==='dark'?'light':'dark'));
  el('reopenTab').addEventListener('click', pauseGame);

  document.querySelectorAll('.tab-btn').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));
  document.querySelectorAll('[data-leaderboard]').forEach(b=>b.addEventListener('click',()=>setLeaderboardCategory(b.dataset.leaderboard)));
  el('submitScoreBtn').addEventListener('click', submitScore);
  el('signInBtn').addEventListener('click', signIn);
  el('signUpBtn').addEventListener('click', signUp);
  el('signOutBtn').addEventListener('click', signOutUser);
  initFirebaseAuth();
}

/* ======================= PERSISTENCE ======================= */
function saveSettings(){
  try{
    const data = {
      settings: settings,
      activePreset: activePreset,
      activeDifficulty: activeDifficulty
    };
    localStorage.setItem('pz_settings', JSON.stringify(data));
    DEBUG.log('saveSettings', data);
  }catch(e){ console.error(e); }
}

function loadSettings(){
  try{
    const res = localStorage.getItem('pz_settings');
    DEBUG.log('loadSettings raw pz_settings', res);
    if(res){
      const data = JSON.parse(res);
      Object.assign(settings, data.settings);
      activePreset = data.activePreset || 'walk';
      activeDifficulty = data.activeDifficulty || 'normal';
      presetBase = {...DEFAULTS, ...PRESETS[activePreset]};
    }
  }catch(e){
    console.warn('[PZ DEBUG] loadSettings failed to parse pz_settings', e);
  }
  
  document.body.dataset.mode = settings.mode;
  DEBUG.log('loadSettings final settings', settings);
  refreshSettingsUI();
}

function renderBestLine(){
  const bestLine = el('bestLine');
  if(!bestLine) return;

  if(bestScore && typeof bestScore.loot === 'number'){
    bestLine.style.display = 'block';
    bestLine.textContent = `Best: ${bestScore.loot} Loot in ${fmtTime(bestScore.time)} (${PRESETS[bestScore.preset]?.label || bestScore.preset})`;
  } else {
    bestLine.style.display = 'none';
    bestLine.textContent = '';
  }
}

function updateBestScore(){
  try{
    let isBest = false;
    if(!bestScore || state.lootCollected > bestScore.loot || (state.lootCollected === bestScore.loot && elapsedSec > bestScore.time)){
      bestScore = {loot: state.lootCollected, time: elapsedSec, preset: activePreset};
      isBest = true;
    }
    if(isBest) localStorage.setItem('pz_highscore', JSON.stringify(bestScore));
    renderBestLine();
  }catch(e){ /* ignore */ }
}

function loadBestScore(){
  try{
    const res = localStorage.getItem('pz_highscore');
    if(res) bestScore = JSON.parse(res);
  }catch(e){ /* none yet */ }
  renderBestLine();
}
function loadAllPersistentData(){
  loadBestScore();
  loadBestEndless();
}


/* ======================= INIT ======================= */
function init(){
  initMap();
  initJoystick();
  bindSettingsUI();
  applyPreset('walk');
  loadSettings();
  loadAllPersistentData();
  setLeaderboardCategory('walk');
}
document.addEventListener('DOMContentLoaded', init);
})();
