// ── world.js ──

// ═══════════════════════════════════════════════════
//  NOISE
// ═══════════════════════════════════════════════════
function ihash(x, y, s) {
  // Integer hash → [0, 1) — deterministic, seeded
  let h = Math.imul((x|0)*1619 ^ (y|0)*31337 ^ (s|0)*1013, 0x45d9f3b);
  h = Math.imul(h ^ (h>>>16), 0x45d9f3b);
  h = Math.imul(h ^ (h>>>16), 0xac4dbbed);
  h ^= h>>>16;
  return (h>>>0) / 0x100000000;
}

function smooth(t) { return t*t*(3-2*t); }

function vnoise(x, y, s) {
  const ix=Math.floor(x), iy=Math.floor(y);
  const fx=x-ix, fy=y-iy;
  const ux=smooth(fx), uy=smooth(fy);
  const a=ihash(ix,  iy,  s), b=ihash(ix+1,iy,  s);
  const c=ihash(ix,  iy+1,s), d=ihash(ix+1,iy+1,s);
  return a + (b-a)*ux + (c-a)*uy + (a-b-c+d)*ux*uy;
}

function fbm(x, y, s, oct=6) {
  let v=0, amp=0.5, f=1, tot=0;
  for (let i=0; i<oct; i++) {
    v += vnoise(x*f, y*f, s + i*997) * amp;
    tot += amp; amp*=0.5; f*=2.1;
  }
  return v/tot;
}

// ═══════════════════════════════════════════════════
//  MAP GENERATION
// ═══════════════════════════════════════════════════

// Ridge noise: produces sharp mountain-ridge shapes rather than smooth hills.
// Values near 1 = ridge crest, values near 0 = valley floor.
function ridgeNoise(x, y, s, oct) {
  let v=0, amp=0.5, f=1, tot=0;
  for (let i=0; i<oct; i++) {
    const n = 1 - Math.abs(vnoise(x*f, y*f, s+i*997)*2 - 1);
    v += n*n*amp; tot+=amp; amp*=0.5; f*=2.1;
  }
  return v/tot;
}

const _yield = () => new Promise(r => setTimeout(r, 0));

async function generate(seed, onProgress) {
  mapTiles    = [];
  mapHeight   = [];
  mapVariant  = [];
  mapMoisture = [];

  for (let y=0; y<MAP_H; y++) {
    mapHeight[y]   = new Float32Array(MAP_W);
    mapVariant[y]  = new Float32Array(MAP_W);
    mapMoisture[y] = new Float32Array(MAP_W);

    for (let x=0; x<MAP_W; x++) {
      const nx=(x/MAP_W)*2-1, ny=(y/MAP_H)*2-1;

      // ── Border fade ──────────────────────────────────────────────
      const edgeDist = 1.0 - Math.max(Math.abs(nx), Math.abs(ny));
      const border   = Math.pow(Math.min(1.0, edgeDist * 6.5), 0.55);

      // ── Domain-warped landmass shape ─────────────────────────────
      const wx = (fbm(x/52, y/52, seed+1313, 3) - 0.5) * 0.65;
      const wy = (fbm(x/52+170, y/52+170, seed+2424, 3) - 0.5) * 0.65;
      const landBase = fbm(x/68 + wx, y/68 + wy, seed, 6);

      // ── Mountain zones ───────────────────────────────────────────
      const mZone = fbm(x/62+400, y/62+600, seed+77777, 3);
      const rwx   = (fbm(x/42+100, y/42,     seed+11111, 2) - 0.5) * 30;
      const rwy   = (fbm(x/42,     y/42+100, seed+22222, 2) - 0.5) * 30;
      const ridge = ridgeNoise((x+rwx)/30, (y+rwy)/30, seed+33333, 4);
      const mBoost = Math.pow(Math.max(0, mZone - 0.46), 1.1) * ridge;

      // ── Micro surface variation ──────────────────────────────────
      const surf = fbm(x/16, y/16, seed+55555, 3) * 0.14 - 0.06;

      // ── Combine and remap ────────────────────────────────────────
      const raw = landBase * 0.58 + mBoost * 0.54 + surf;
      let h = Math.max(0, raw * 1.75 - 0.22) * border;
      if (h > 0.76) h = 0.76 + (h - 0.76) * 0.42;
      h = Math.min(1, h);

      mapHeight[y][x]   = h;
      mapMoisture[y][x] = fbm(x/48+350, y/48+350, seed+50000, 4);
      mapVariant[y][x]  = vnoise(x/2.2,  y/2.2,   seed+88888);
    }

    // Yield to browser every 16 rows so the loading bar can repaint
    if ((y & 15) === 15) {
      onProgress?.(20 + (y / MAP_H) * 50);
      await _yield();
    }
  }

  // ── Biome assignment ─────────────────────────────────────────────
  for (let y=0; y<MAP_H; y++) {
    mapTiles[y] = new Uint8Array(MAP_W);
    for (let x=0; x<MAP_W; x++) {
      const h=mapHeight[y][x], m=mapMoisture[y][x];
      if      (h < 0.10) mapTiles[y][x] = T.DEEP;
      else if (h < 0.21) mapTiles[y][x] = T.WATER;
      else if (h < 0.29) mapTiles[y][x] = T.SAND;
      else if (h < 0.57) mapTiles[y][x] = m>0.52 ? T.FOREST : T.GRASS;
      else if (h < 0.67) mapTiles[y][x] = m>0.44 ? T.FOREST : T.HILL;
      else if (h < 0.79) mapTiles[y][x] = T.MOUNTAIN;
      else               mapTiles[y][x] = T.PEAK;
    }
  }

  // Soil fertility (1–3) derived from moisture; revealed only when a farm is placed
  mapFertility = [];
  for (let y = 0; y < MAP_H; y++) {
    mapFertility[y] = new Uint8Array(MAP_W);
    for (let x = 0; x < MAP_W; x++) {
      mapFertility[y][x] = Math.max(1, Math.min(3, Math.ceil(mapMoisture[y][x] * 3)));
    }
  }

  carveRivers(seed, mapHeight, mapTiles);
  generateResourceNodes(seed);
  onProgress?.(75);
  await _yield();
  preGenerateKingdomSites();
}

function carveRivers(seed, hmap, tiles) {
  const rng = (i) => ihash(i, i*7+3, seed+777777);
  const numRivers = 10 + Math.floor(rng(0)*8);

  for (let r=0; r<numRivers; r++) {
    // Find a mountain-height start point
    let sx=-1, sy=-1;
    for (let a=0; a<400; a++) {
      const tx=Math.floor(rng(r*800+a*2)  *MAP_W);
      const ty=Math.floor(rng(r*800+a*2+1)*MAP_H);
      if (hmap[ty][tx] > 0.67) { sx=tx; sy=ty; break; }
    }
    if (sx<0) continue;

    const visited = new Set();
    let x=sx, y=sy;

    for (let step=0; step<600; step++) {
      if (x<0||x>=MAP_W||y<0||y>=MAP_H) break;
      const key=y*MAP_W+x;
      if (visited.has(key)) break;
      visited.add(key);

      const t=tiles[y][x];
      if (t===T.DEEP||t===T.WATER) break;
      // Don't overwrite mountain tops — rivers appear on lower slopes
      if (t!==T.PEAK) tiles[y][x]=T.RIVER;

      // Flow to the lowest-elevation neighbour (with a touch of noise to wibble)
      const dirs=[[0,1],[1,0],[0,-1],[-1,0],[1,1],[-1,1],[1,-1],[-1,-1]];
      let bx=-1, by=-1, bh=hmap[y][x];
      for (const [dx,dy] of dirs) {
        const nx=x+dx, ny=y+dy;
        if (nx<0||nx>=MAP_W||ny<0||ny>=MAP_H) continue;
        const nh = hmap[ny][nx] + ihash(nx,ny,seed+555)*0.022;
        if (nh<bh) { bh=nh; bx=nx; by=ny; }
      }
      if (bx<0) break;
      x=bx; y=by;
    }
  }
}

function generateResourceNodes(seed) {
  resourceNodes = [];
  let nid = 0;
  const STEP = 12;

  for (let y = STEP; y < MAP_H - STEP; y += STEP) {
    for (let x = STEP; x < MAP_W - STEP; x += STEP) {
      const jx = Math.floor((ihash(x, y, seed + 1) - 0.5) * STEP * 0.8);
      const jy = Math.floor((ihash(x, y, seed + 2) - 0.5) * STEP * 0.8);
      const tx = Math.max(2, Math.min(MAP_W - 3, x + jx));
      const ty = Math.max(2, Math.min(MAP_H - 3, y + jy));

      const tile = mapTiles[ty][tx];
      const h    = mapHeight[ty][tx];
      const m    = mapMoisture[ty][tx];

      if (ihash(tx, ty, seed + 99) > 0.35) continue;

      let type = null, radius = 3, bonus = 1.0;

      if (tile === T.HILL && h > 0.62) {
        type   = h > 0.66 ? 'iron' : 'quarry';
        radius = type === 'iron' ? 2 : 3;
        bonus  = type === 'iron' ? 0 : 2.5;
      } else if (tile === T.GRASS && m > 0.58) {
        type = 'farmland'; radius = 4; bonus = 2.0;
      } else if (tile === T.FOREST && m > 0.62 && h > 0.45 && h < 0.57) {
        type = 'forest'; radius = 3; bonus = 3.0;
      } else if (tile === T.RIVER && h < 0.35) {
        type = 'delta'; radius = 3; bonus = 1.5;
      }

      if (!type) continue;

      const tooClose = resourceNodes.some(n =>
        Math.hypot(n.tx - tx, n.ty - ty) < STEP * 0.9
      );
      if (tooClose) continue;

      resourceNodes.push({ id: nid++, type, tx, ty, radius, bonus, discovered: false, active: false });
    }
  }
}

// ═══════════════════════════════════════════════════
//  PATHFINDING  (heap-based A*)
// ═══════════════════════════════════════════════════
const WALKABLE_TILES = new Set([T.SAND, T.GRASS, T.FOREST, T.HILL, T.RIVER]);

class MinHeap {
  constructor() { this.h = []; }
  push(n) {
    this.h.push(n);
    let i = this.h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.h[p].f <= this.h[i].f) break;
      [this.h[p], this.h[i]] = [this.h[i], this.h[p]]; i = p;
    }
  }
  pop() {
    const top = this.h[0];
    const last = this.h.pop();
    if (this.h.length > 0) {
      this.h[0] = last;
      let i = 0, n = this.h.length;
      while (true) {
        let m=i, l=2*i+1, r=2*i+2;
        if (l<n && this.h[l].f < this.h[m].f) m=l;
        if (r<n && this.h[r].f < this.h[m].f) m=r;
        if (m===i) break;
        [this.h[m], this.h[i]] = [this.h[i], this.h[m]]; i=m;
      }
    }
    return top;
  }
  get size() { return this.h.length; }
}

// Pre-allocated pathfinding buffers — avoids 128KB GC pressure per call
const _pfGScore = new Float32Array(MAP_W * MAP_H).fill(Infinity);
const _pfParent = new Int32Array(MAP_W * MAP_H);
const _pfDirty  = [];  // indices written this call, for fast reset

function findPath(sx, sy, ex, ey, blocked) {
  if (sx===ex && sy===ey) return [{x:sx,y:sy}];
  if (!WALKABLE_TILES.has(mapTiles[ey]?.[ex])) return null;

  // Reset only the cells touched last call
  for (let i = 0; i < _pfDirty.length; i++) {
    _pfGScore[_pfDirty[i]] = Infinity;
    _pfParent[_pfDirty[i]] = -1;
  }
  _pfDirty.length = 0;

  const W = MAP_W;
  const gScore = _pfGScore;
  const parent  = _pfParent;
  const startIdx = sy*W + sx;
  gScore[startIdx] = 0; parent[startIdx] = -1; _pfDirty.push(startIdx);
  const endIdx = ey*W + ex;

  const heap = new MinHeap();
  heap.push({ f: Math.abs(ex-sx)+Math.abs(ey-sy), idx: startIdx });

  while (heap.size > 0) {
    const { idx } = heap.pop();
    const cx = idx % W, cy = (idx/W)|0;
    if (cx===ex && cy===ey) {
      const path = [];
      let i = idx;
      while (i !== -1) { path.unshift({x: i%W, y: (i/W)|0}); i = parent[i]; }
      return path;
    }
    for (const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nx=cx+dx, ny=cy+dy;
      if (nx<0||nx>=MAP_W||ny<0||ny>=MAP_H) continue;
      if (!WALKABLE_TILES.has(mapTiles[ny][nx])) continue;
      const ni = ny*W+nx;
      if (blocked && blocked[ni] && ni !== endIdx) continue;
      const ng = gScore[idx] + (roadTiles.has(ni) ? 0.5 : 1);
      if (ng < gScore[ni]) {
        if (gScore[ni] === Infinity) _pfDirty.push(ni);
        gScore[ni] = ng; parent[ni] = idx;
        heap.push({ f: ng + Math.abs(nx-ex) + Math.abs(ny-ey), idx: ni });
      }
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════
//  TREE OBJECTS
// ═══════════════════════════════════════════════════
function preGenerateKingdomSites() {
  enemyKingdomSites = [];
  const cx = MAP_W >> 1, cy = MAP_H >> 1;

  // BFS flood-fill from center to mark all land-reachable tiles (one pass, no A*)
  const reachable = new Uint8Array(MAP_W * MAP_H);
  const q = [cy * MAP_W + cx];
  reachable[q[0]] = 1;
  for (let qi = 0; qi < q.length; qi++) {
    const idx = q[qi];
    const x = idx % MAP_W, y = (idx / MAP_W) | 0;
    for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nx = x+dx, ny = y+dy;
      if (nx<0||nx>=MAP_W||ny<0||ny>=MAP_H) continue;
      const ni = ny*MAP_W+nx;
      if (reachable[ni] || !WALKABLE_TILES.has(mapTiles[ny][nx])) continue;
      reachable[ni] = 1;
      q.push(ni);
    }
  }

  // Pre-pick 12 sites spread evenly around the map center
  const NUM_SITES = 12;
  for (let i = 0; i < NUM_SITES; i++) {
    const angle = (i / NUM_SITES) * Math.PI * 2;
    const dist  = 58 + (i % 3) * 9; // 58 / 67 / 76 tiles out
    let ex = Math.round(cx + Math.cos(angle) * dist);
    let ey = Math.round(cy + Math.sin(angle) * dist);
    ex = Math.max(5, Math.min(MAP_W-6, ex));
    ey = Math.max(5, Math.min(MAP_H-6, ey));

    let found = false;
    for (let r = 0; r <= 20 && !found; r++) {
      for (let dy = -r; dy <= r && !found; dy++) {
        for (let dx = -r; dx <= r && !found; dx++) {
          if (Math.abs(dx)!==r && Math.abs(dy)!==r) continue;
          const nx = ex+dx, ny = ey+dy;
          if (nx<4||nx>=MAP_W-4||ny<4||ny>=MAP_H-4) continue;
          if (!reachable[ny*MAP_W+nx]) continue;
          if (Math.hypot(nx-cx, ny-cy) < 45) continue;
          if (enemyKingdomSites.some(s => Math.hypot(nx-s.tx, ny-s.ty) < 30)) continue;
          enemyKingdomSites.push({tx: nx, ty: ny});
          found = true;
        }
      }
    }
  }
}

function generateTrees() {
  trees = []; _treeId = 0;
  for (let ty = 0; ty < MAP_H; ty++) {
    for (let tx = 0; tx < MAP_W; tx++) {
      if (mapTiles[ty][tx] !== T.FOREST) continue;
      if (Math.random() > TREE_SPAWN_CHANCE) continue;
      // Randomise position slightly within the tile so forests feel organic
      const ox = 0.04 + Math.random() * 0.06;
      const oy = 0.04 + Math.random() * 0.06;
      trees.push({id: _treeId++, tx, ty, ox, oy, scale: 0.88});
    }
  }
}