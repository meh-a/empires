// ── renderer.js ──

// ═══════════════════════════════════════════════════
//  CANVAS / CONTEXT
// ═══════════════════════════════════════════════════
const canvas   = document.getElementById('gameCanvas');
const ctx      = canvas.getContext('2d');
const mmCanvas = document.getElementById('minimap');
const mmCtx    = mmCanvas.getContext('2d');
const _groundBuildingAt = new Map();
let _groundBldgCount = -1;

function resize() { canvas.width = innerWidth; canvas.height = innerHeight; }
resize();
addEventListener('resize', resize);

// ═══════════════════════════════════════════════════
//  TILE COLORS (animated)
// ═══════════════════════════════════════════════════
function cl(v) { return Math.round(Math.max(0,Math.min(255,v))); }
function tint(r,g,b,s,n) {
  const nv=n*38;
  return `rgb(${cl(r*s+nv)},${cl(g*s+nv*0.82)},${cl(b*s+nv*0.65)})`;
}

function tileBaseColor(tx, ty, t, v, time) {
  const h = mapHeight[ty]?.[tx] ?? 0.5;
  const s = 0.78 + h*0.44;   // height-based shade: 0.78..1.22

  switch(t) {
    case T.DEEP: {
      const w=Math.sin(time*0.5+tx*0.28+ty*0.35)*9;
      return `rgb(${cl(16+w)},${cl(42+w)},${cl(92+w)})`;
    }
    case T.WATER: {
      const w=Math.sin(time*0.8+tx*0.4-ty*0.3)*11;
      return `rgb(${cl(34+w)},${cl(112+w)},${cl(184+w)})`;
    }
    case T.SAND:     return tint(228,194,108,s, v*0.07-0.035);
    case T.GRASS:    return tint( 70,158, 38,s, v*0.15-0.075);
    case T.FOREST:   return tint( 22, 80, 14,s, v*0.12-0.060);
    case T.HILL:     return tint(176,142, 86,s, v*0.09-0.045);
    case T.MOUNTAIN: return tint(112,110,124,s, v*0.07-0.035);
    case T.PEAK:     return tint(222,228,242,s, v*0.04-0.020);
    case T.RIVER: {
      const w=Math.sin(time*1.2+tx*0.55+ty*0.6)*13;
      return `rgb(${cl(40+w)},${cl(140+w)},${cl(202+w)})`;
    }
  }
  return '#f0f';
}

// ═══════════════════════════════════════════════════
//  PIXEL ART SPRITES
// ═══════════════════════════════════════════════════

// Draw an N×N pixel-art sprite at screen position (sx,sy) fitting a `size`×`size` square.
// rows: array of equal-length strings; pal: char→color (null/undefined = skip/transparent).
function drawSprite(rows, pal, sx, sy, size) {
  const n = rows[0].length;
  const ps = size / n;
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < n; c++) {
      const col = pal[rows[r][c]];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(
        Math.floor(sx + c * ps),
        Math.floor(sy + r * ps),
        Math.ceil(ps),
        Math.ceil(ps)
      );
    }
  }
}

// Like drawSprite but allows a separate render width and height,
// so sprites can be drawn taller than their tile footprint.
function drawSpriteH(rows, pal, sx, sy, w, h) {
  const cols = rows[0].length;
  const nrows = rows.length;
  const px = w / cols;
  const py = h / nrows;
  for (let r = 0; r < nrows; r++) {
    for (let c = 0; c < cols; c++) {
      const col = pal[rows[r][c]];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(
        Math.floor(sx + c * px),
        Math.floor(sy + r * py),
        Math.ceil(px),
        Math.ceil(py)
      );
    }
  }
}

// ═══════════════════════════════════════════════════
//  TILE DETAIL DRAWING
// ═══════════════════════════════════════════════════
function drawDetails(tx, ty, t, sx, sy, sz, v, time) {
  if (sz < 8) return;

  // ── Mountain: pixel-art rocky peak ───────────────
  // (Forest trees are drawn as Y-sorted objects in drawObjects)
  if (t === T.MOUNTAIN) {
    drawSprite(STAMP.mtn, STAMP_PAL.mtn, sx, sy, sz);
  }

  // ── Hill: pixel-art rounded bump ─────────────────
  else if (t === T.HILL) {
    drawSprite(STAMP.hill, STAMP_PAL.hill, sx, sy, sz);
  }

  // ── Snowy peak ────────────────────────────────────
  else if (t === T.PEAK) {
    drawSprite(STAMP.peak, STAMP_PAL.peak, sx, sy, sz);
  }

  // ── Water / Deep: pixel-art ripple bars ──────────
  else if ((t === T.WATER || t === T.DEEP) && sz >= 12) {
    const ps  = Math.max(1, Math.ceil(sz * 0.06));
    const a   = t === T.DEEP ? 0.07 : 0.11;
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    for (let w = 0; w < 2; w++) {
      const p  = (time * (0.07 + w * 0.03) + tx * 0.17 + ty * 0.13 + w * 0.28) % 0.55;
      const ry = sy + Math.floor(sz * (0.15 + p));
      if (ry < sy || ry > sy + sz - ps) continue;
      ctx.fillRect(sx + Math.floor(sz * 0.18), ry, Math.floor(sz * 0.64), ps);
    }
  }

  // ── River: scrolling pixel bars ──────────────────
  else if (t === T.RIVER && sz >= 10) {
    const ps = Math.max(1, Math.ceil(sz * 0.06));
    for (let i = 0; i < 2; i++) {
      const p  = (time * 0.22 + tx * 0.28 + ty * 0.36 + i * 0.5) % 1;
      const ry = sy + Math.floor(sz * p);
      if (ry < sy || ry >= sy + sz) continue;
      ctx.fillStyle = `rgba(255,255,255,${0.18 - i * 0.06})`;
      ctx.fillRect(sx + Math.floor(sz * 0.16), ry, Math.floor(sz * 0.68), ps);
    }
  }

  // ── Sand: pixel ripple marks ──────────────────────
  else if (t === T.SAND && sz >= 16) {
    const ps = Math.max(1, Math.ceil(sz * 0.055));
    ctx.fillStyle = 'rgba(165,126,52,0.22)';
    for (let i = 0; i < 3; i++) {
      const ry  = sy + Math.floor(sz * (0.22 + i * 0.26));
      const barX = sx + Math.floor(sz * (0.10 + ihash(tx + i, ty, 43) * 0.18));
      const barW = Math.floor(sz * (0.28 + ihash(tx, ty + i, 42) * 0.22));
      ctx.fillRect(barX, ry, barW, ps);
    }
  }

  // ── Grass: small pixel tufts ──────────────────────
  else if (t === T.GRASS && sz >= 20) {
    const ps = Math.max(1, Math.ceil(sz * 0.055));
    ctx.fillStyle = 'rgba(92,170,46,0.28)';
    for (const [px, py] of [[0.22,0.72],[0.52,0.68],[0.36,0.82],[0.70,0.75],[0.15,0.62]]) {
      const gx = sx + Math.floor(px * sz);
      const gy = sy + Math.floor(py * sz);
      ctx.fillRect(gx, gy - ps * 2, ps, ps * 2);   // vertical blade
      ctx.fillRect(gx + ps, gy - ps, ps, ps);       // lean right
    }
  }
}

// ═══════════════════════════════════════════════════
//  GROUND-LAYER BUILDINGS (flat tiles: farmland, mine)
// ═══════════════════════════════════════════════════
// Drawn inline in the tile pass, before fog overlay.
function drawGroundBuildingInline(b, sx, sy, sz) {
  const alpha = b.complete ? 1.0 : 0.25 + b.progress * 0.75;
  ctx.globalAlpha = alpha;
  drawSprite(BSTAMP[b.type], BSTAMP_PAL[b.type], sx, sy, sz);
  ctx.globalAlpha = 1.0;
  if (!b.complete) {
    // Construction stipple dots
    const dot = Math.max(1, Math.floor(sz / 10));
    ctx.fillStyle = 'rgba(180,140,60,0.45)';
    for (let dy2 = 0; dy2 < sz; dy2 += dot * 4)
      for (let dx2 = 0; dx2 < sz; dx2 += dot * 4)
        ctx.fillRect(Math.floor(sx + dx2), Math.floor(sy + dy2), dot, dot);
    // Progress bar
    const ph = Math.max(3, Math.floor(sz * 0.05));
    const pw = Math.floor(sz * 0.82);
    const px2 = Math.floor(sx + (sz - pw) / 2);
    const py2 = Math.floor(sy - ph - Math.max(2, sz * 0.03));
    ctx.fillStyle = 'rgba(0,0,0,0.60)';
    ctx.fillRect(px2, py2, pw, ph);
    ctx.fillStyle = `rgb(${cl(60+180*b.progress)},${cl(200-100*b.progress)},40)`;
    ctx.fillRect(px2, py2, Math.floor(pw * b.progress), ph);
  }
}

// ═══════════════════════════════════════════════════
//  Y-SORTED OBJECT DRAWING
// ═══════════════════════════════════════════════════

function drawTreeObj(tree, sz) {
  const treeSz = tree.scale * sz;
  if (treeSz < 3) return;
  const bx = tree.tx * sz + tree.ox * sz - camX;
  const by = tree.ty * sz + tree.oy * sz - camY;
  const wobble = _choppingIds.has(tree.id) ? Math.sin(time * 24) * treeSz * 0.09 : 0;
  const cx = bx + treeSz * 0.5 + wobble;
  const fi = tree.ty * MAP_W + tree.tx;
  const inFog = !fogVisible[fi]; // explored but currently dark

  if (inFog) ctx.globalAlpha = 0.35;

  // Ground shadow ellipse under trunk
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  ctx.ellipse(cx, by + treeSz * 0.84, treeSz * 0.22, treeSz * 0.07, 0, 0, Math.PI * 2);
  ctx.fill();

  drawSprite(STAMP.tree, STAMP_PAL.tree, Math.floor(bx + wobble), Math.floor(by), treeSz);

  if (inFog) ctx.globalAlpha = 1.0;
}

// ── Health bar helper ────────────────────────────────────────────
function drawHealthBar(x, y, hp, maxHp, w) {
  const pct = hp / maxHp;
  const bh  = Math.max(2, w * 0.07);
  const by  = y - bh - 1;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(Math.floor(x), Math.floor(by), Math.ceil(w), Math.ceil(bh));
  const r = cl(220 - pct*100), g = cl(pct*210);
  ctx.fillStyle = `rgb(${r},${g},20)`;
  ctx.fillRect(Math.floor(x), Math.floor(by), Math.ceil(w*pct), Math.ceil(bh));
}

// ── Connected wall rendering ──────────────────────────────────────
function isWallAt(tx, ty) {
  return buildings.some(b => b.type === 2 && b.complete && b.tx === tx && b.ty === ty);
}

function drawConnectedWall(b, sx, sy, sz, enemyTint) {
  const tx = b.tx, ty = b.ty;
  const hasN = isWallAt(tx, ty - 1);
  const hasS = isWallAt(tx, ty + 1);
  const hasE = isWallAt(tx + 1, ty);
  const hasW = isWallAt(tx - 1, ty);

  const w = Math.ceil(sz), h = Math.ceil(sz);
  // Merlon thickness and dimensions
  const mT  = Math.max(2, Math.floor(sz * 0.20)); // merlon depth (inset band)
  const mW  = Math.max(3, Math.floor(sz * 0.24)); // merlon block width
  const gap = Math.max(1, Math.floor(sz * 0.12)); // gap between merlons

  // 1. Outer stone border (merlons band area)
  ctx.fillStyle = '#706858';
  ctx.fillRect(sx, sy, w, h);

  // 2. Inner walkway surface
  const iX = sx + (hasW ? 0 : mT);
  const iY = sy + (hasN ? 0 : mT);
  const iW = w - (hasW ? 0 : mT) - (hasE ? 0 : mT);
  const iH = h - (hasN ? 0 : mT) - (hasS ? 0 : mT);
  ctx.fillStyle = '#9c9080';
  ctx.fillRect(iX, iY, iW, iH);

  // 3. Mortar lines on walkway
  const blk = Math.max(4, Math.floor(sz * 0.27));
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  for (let row = 0, yy = iY; yy < iY + iH; yy += blk, row++) {
    ctx.fillRect(iX, yy, iW, 1); // horizontal mortar
    const off = (row % 2) ? Math.floor(blk * 0.5) : 0;
    for (let xx = iX - off; xx < iX + iW + blk; xx += blk) {
      if (xx >= iX && xx < iX + iW) ctx.fillRect(xx, yy, 1, blk); // vertical mortar
    }
  }

  // 4. Highlight / shadow edges on walkway
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fillRect(iX, iY, iW, 1);
  ctx.fillRect(iX, iY, 1, iH);
  ctx.fillStyle = 'rgba(0,0,0,0.20)';
  ctx.fillRect(iX, iY + iH - 1, iW, 1);
  ctx.fillRect(iX + iW - 1, iY, 1, iH);

  // 5. Merlons (battlements) on exposed edges
  function drawMerlonsH(ex, ey, totalW, vertical) {
    // Draw merlon blocks along a horizontal or vertical band
    ctx.fillStyle = '#5a5048';
    const step = mW + gap;
    const count = Math.max(1, Math.floor((totalW - gap) / step));
    const offset = Math.floor((totalW - count * step + gap) / 2);
    for (let i = 0; i < count; i++) {
      const pos = offset + i * step;
      if (vertical) {
        ctx.fillRect(ex, ey + pos, mT, mW);
        ctx.fillStyle = '#7a6e62'; ctx.fillRect(ex, ey + pos, 1, mW); // left highlight
        ctx.fillRect(ex, ey + pos, mT, 1);                             // top highlight
        ctx.fillStyle = '#3e3830'; ctx.fillRect(ex + mT - 1, ey + pos, 1, mW); // right shadow
        ctx.fillStyle = '#5a5048';
      } else {
        ctx.fillRect(ex + pos, ey, mW, mT);
        ctx.fillStyle = '#7a6e62'; ctx.fillRect(ex + pos, ey, mW, 1); // top highlight
        ctx.fillRect(ex + pos, ey, 1, mT);                             // left highlight
        ctx.fillStyle = '#3e3830'; ctx.fillRect(ex + pos, ey + mT - 1, mW, 1); // bottom shadow
        ctx.fillStyle = '#5a5048';
      }
    }
  }

  if (!hasN) drawMerlonsH(sx,         sy,         w, false);
  if (!hasS) drawMerlonsH(sx,         sy + h - mT, w, false);
  if (!hasW) drawMerlonsH(sx,         sy,          h, true);
  if (!hasE) drawMerlonsH(sx + w - mT, sy,         h, true);

  if (enemyTint) {
    ctx.fillStyle = 'rgba(180,20,20,0.28)';
    ctx.fillRect(sx, sy, w, h);
  }
}

function drawBuildingObj(b, sz) {
  const sx  = Math.floor(b.tx * sz - camX);
  const tsy = Math.floor(b.ty * sz - camY);   // tile-top y
  const bw  = sz * b.w;
  const hm  = BLDG_HEIGHT[b.type] ?? 1.0;
  const bh  = bw * hm;                        // visual height
  const sy  = tsy - (bh - bw);                // shift up so bottom aligns with tile bottom

  if (!b.complete) {
    ctx.globalAlpha = 0.25 + b.progress * 0.75;
    drawSpriteH(BSTAMP[b.type], BSTAMP_PAL[b.type], sx, sy, bw, bh);
    ctx.globalAlpha = 1.0;
    const dot = Math.max(1, Math.floor(bw / 10));
    ctx.fillStyle = 'rgba(180,140,60,0.45)';
    for (let dy2 = 0; dy2 < bh; dy2 += dot * 4)
      for (let dx2 = 0; dx2 < bw; dx2 += dot * 4)
        ctx.fillRect(Math.floor(sx + dx2), Math.floor(sy + dy2), dot, dot);
    const ph = Math.max(3, Math.floor(bw * 0.05));
    const pw = Math.floor(bw * 0.82);
    const px2 = Math.floor(sx + (bw - pw) / 2);
    const py2 = Math.floor(sy - ph - Math.max(2, bw * 0.03));
    ctx.fillStyle = 'rgba(0,0,0,0.60)';
    ctx.fillRect(px2, py2, pw, ph);
    ctx.fillStyle = `rgb(${cl(60+180*b.progress)},${cl(200-100*b.progress)},40)`;
    ctx.fillRect(px2, py2, Math.floor(pw * b.progress), ph);
  } else {
    if (b.type === 2) {
      drawConnectedWall(b, sx, tsy, bw, false);
    } else {
      drawSpriteH(BSTAMP[b.type], BSTAMP_PAL[b.type], sx, sy, bw, bh);
    }
    // Warm window glow on occupied houses at night
    if (b.type === 0 && getNightAlpha() > 0.1) {
      const sleepers = villagers.filter(v => v.state === 'sleeping' && v.tx === b.tx && v.ty === b.ty).length;
      if (sleepers > 0) {
        const na = getNightAlpha();
        const pulse = 0.55 + 0.12*Math.sin(time*1.8 + b.id);
        const glow = na * pulse;
        const gx = sx + bw * 0.5, gy = sy + bh * 0.62;
        const grad = ctx.createRadialGradient(gx, gy, 1, gx, gy, bw * 0.7);
        grad.addColorStop(0, `rgba(255,210,80,${glow * 0.7})`);
        grad.addColorStop(1, 'rgba(255,140,30,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(sx - bw*0.2, sy, bw*1.4, bh*1.1);
      }
    }
    if (b.hp < b.maxHp) drawHealthBar(sx, sy, b.hp, b.maxHp, bw);
  }
}

function drawTCSprite(tc, sz) {
  const sx  = Math.floor(tc.tx * sz - camX);
  const tsy = Math.floor(tc.ty * sz - camY);
  const th  = sz * TC_HEIGHT;
  const sy  = tsy - (th - sz);
  drawSpriteH(TC_STAMP, TC_PAL, sx, sy, sz, th);
  if (tc.hp !== undefined && tc.hp < tc.maxHp) drawHealthBar(sx, sy, tc.hp, tc.maxHp, sz);
  if (sz >= 22) {
    const ly = sy - Math.max(4, sz * 0.14) - (tc.hp < tc.maxHp ? sz*0.10 : 0);
    ctx.font = `bold ${Math.max(8, Math.floor(sz * 0.13))}px 'Silkscreen',monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText('Town Center', sx + sz / 2, ly);
    ctx.fillStyle = '#c8922a';
    ctx.fillText('Town Center', sx + sz / 2, ly);
  }
}

function drawEnemyBuildingObj(b, sz) {
  const sx  = Math.floor(b.tx * sz - camX);
  const tsy = Math.floor(b.ty * sz - camY);
  const hm  = BLDG_HEIGHT[b.type] ?? 1.0;
  const bh  = sz * hm;
  const sy  = tsy - (bh - sz);
  if (b.type === 2) {
    drawConnectedWall(b, sx, tsy, sz, true);
  } else {
    drawSpriteH(BSTAMP[b.type], BSTAMP_PAL[b.type], sx, sy, sz, bh);
    ctx.fillStyle = 'rgba(180,20,20,0.28)';
    ctx.fillRect(sx, sy, Math.ceil(sz), Math.ceil(bh));
  }
  if (b.hp < b.maxHp) drawHealthBar(sx, sy, b.hp, b.maxHp, sz);
}

function drawEnemyVillagerChar(ev, px, py, sz) {
  const sprSz = Math.max(6, sz * 1.15);
  const sprX  = px - sprSz * 0.5;
  const sprY  = py - sprSz * 0.88;
  if (sprSz < 8) {
    ctx.fillStyle = '#c06060';
    ctx.fillRect(Math.floor(sprX), Math.floor(sprY), Math.ceil(sprSz), Math.ceil(sprSz));
    return;
  }
  const shW = Math.ceil(sprSz*0.55);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(Math.floor(px-shW*0.5), Math.floor(py+sprSz*0.10), shW, Math.ceil(sprSz*0.10));
  // Use normal villager sprite but with enemy-tinted palette
  const sprites = VSPRITE[ev.role] || VSPRITE.Basic;
  drawSprite(sprites[0], ENEMY_VILLAGER_PAL, sprX, sprY, sprSz);
  // Small red dot above head to mark as enemy
  const dotR = Math.max(2, sz * 0.08);
  ctx.fillStyle = 'rgba(220,60,60,0.9)';
  ctx.beginPath();
  ctx.arc(Math.floor(px), Math.floor(sprY - dotR*1.2), dotR, 0, Math.PI*2);
  ctx.fill();
}

function drawEnemyTC(ek, sz) {
  const sx = Math.floor(ek.tx * sz - camX);
  const sy = Math.floor(ek.ty * sz - camY);
  const fi = ek.ty * MAP_W + ek.tx;
  if (!fogExplored[fi]) return; // hidden in fog
  ctx.save();
  drawSprite(TC_STAMP, TC_PAL, sx, sy, sz);
  // Red tint overlay
  ctx.fillStyle = 'rgba(160,20,20,0.42)';
  ctx.fillRect(Math.floor(sx), Math.floor(sy), Math.ceil(sz), Math.ceil(sz));
  ctx.restore();
  if (ek.hp < ek.maxHp) drawHealthBar(sx, sy, ek.hp, ek.maxHp, sz);
  if (sz >= 22) {
    const ly = sy - Math.max(4, sz*0.14) - (ek.hp < ek.maxHp ? sz*0.10 : 0);
    ctx.font = `bold ${Math.max(8, Math.floor(sz*0.13))}px 'Silkscreen',monospace`;
    ctx.textAlign='center'; ctx.textBaseline='bottom';
    ctx.lineWidth=3; ctx.strokeStyle='rgba(0,0,0,0.85)';
    ctx.strokeText(ek.name || 'Enemy Keep', sx+sz/2, ly);
    ctx.fillStyle='#e06060';
    ctx.fillText(ek.name || 'Enemy Keep', sx+sz/2, ly);
  }
}

function drawObjects() {
  const sz = TILE_SZ * zoom;

  // ── TC background effects (glow + territory ring) drawn before sort ──
  if (townCenter) {
    const sx = Math.floor(townCenter.tx * sz - camX);
    const sy = Math.floor(townCenter.ty * sz - camY);
    const grad = ctx.createRadialGradient(sx+sz/2, sy+sz/2, 0, sx+sz/2, sy+sz/2, sz*2.2);
    grad.addColorStop(0, 'rgba(200,146,42,0.22)');
    grad.addColorStop(1, 'rgba(200,146,42,0)');
    ctx.fillStyle = grad; ctx.fillRect(sx-sz, sy-sz, sz*3, sz*3);
    const rcx = townCenter.tx*sz+sz/2-camX, rcy = townCenter.ty*sz+sz/2-camY;
    ctx.strokeStyle = 'rgba(200,146,42,0.15)';
    ctx.lineWidth = Math.max(1, sz*0.12);
    ctx.setLineDash([Math.floor(sz*0.35), Math.floor(sz*0.18)]);
    ctx.beginPath(); ctx.arc(rcx, rcy, getTerritoryRadius()*sz, 0, Math.PI*2); ctx.stroke();
    ctx.setLineDash([]);
  }

  // ── Destination marker (below objects) ──
  if (selectedVillager && selectedVillager.path.length > 0) {
    const last = selectedVillager.path[selectedVillager.path.length - 1];
    const mx = (last.x+0.5)*sz-camX, my = (last.y+0.5)*sz-camY;
    const pr = Math.max(5, Math.floor(sz*0.18));
    const lw = Math.max(1, Math.round(pr*0.22));
    ctx.fillStyle = 'rgba(255,215,40,0.92)';
    ctx.fillRect(Math.floor(mx-pr), Math.floor(my-lw*0.5), pr*2, lw);
    ctx.fillRect(Math.floor(mx-lw*0.5), Math.floor(my-pr), lw, pr*2);
    ctx.fillStyle = 'rgba(255,215,40,0.50)';
    for (const [ox,oy] of [[-1,-1],[1,-1],[-1,1],[1,1]])
      ctx.fillRect(Math.floor(mx+ox*pr*0.62), Math.floor(my+oy*pr*0.62), lw, lw);
  }

  // ── Collect visible objects ──
  const c0 = Math.max(0, Math.floor(camX/sz) - 1);
  const r0 = Math.max(0, Math.floor(camY/sz) - 2);
  const c1 = Math.min(MAP_W-1, Math.ceil((camX+canvas.width)/sz) + 1);
  const r1 = Math.min(MAP_H-1, Math.ceil((camY+canvas.height)/sz) + 2);

  // Update chopping-tree set for wobble (rebuild only every 6 frames)
  if (frameCount % 6 === 0) {
    _choppingIds.clear();
    for (const v of villagers) { if (v.state==='chopping'&&v.chopTarget) _choppingIds.add(v.chopTarget.id); }
  }

  const objs = [];

  for (const tree of trees) {
    if (tree.tx < c0 || tree.tx > c1 || tree.ty < r0 || tree.ty > r1) continue;
    const tfi = tree.ty * MAP_W + tree.tx;
    if (!fogExplored[tfi]) continue; // never seen — hidden
    objs.push({k:0, sortY: tree.ty + tree.oy + tree.scale*0.85, d: tree});
  }
  for (const b of buildings) {
    if (b.type === 4 || b.type === 5) continue; // drawn in tile pass as ground layer
    if (b.tx < c0 || b.tx > c1 || b.ty < r0 || b.ty > r1) continue;
    objs.push({k:1, sortY: b.ty + b.h, d: b});
  }
  if (townCenter && townCenter.tx>=c0 && townCenter.tx<=c1 && townCenter.ty>=r0 && townCenter.ty<=r1) {
    objs.push({k:2, sortY: townCenter.ty + 1.0, d: townCenter});
  }
  for (const v of villagers) {
    if (v.state === 'sleeping') continue; // hidden inside house
    if (v.x < c0-1 || v.x > c1+1 || v.y < r0-1 || v.y > r1+1) continue;
    objs.push({k:3, sortY: v.y, d: v});
  }
  for (const n of npcs) {
    if (n.state==='raiding'||n.state==='gone'||n._despawn) continue;
    if (n.x < c0-1 || n.x > c1+1 || n.y < r0-1 || n.y > r1+1) continue;
    objs.push({k:4, sortY: n.y, d: n});
  }
  for (const b of bandits) {
    if (b._despawn) continue;
    if (b.x < c0-1 || b.x > c1+1 || b.y < r0-1 || b.y > r1+1) continue;
    if (!fogExplored[Math.floor(b.y)*MAP_W+Math.floor(b.x)]) continue;
    objs.push({k:9, sortY: b.y, d: b});
  }
  for (const eu of enemyUnits) {
    if (eu._despawn) continue;
    const fi = Math.floor(eu.y)*MAP_W + Math.floor(eu.x);
    if (!fogExplored[fi]) continue;
    if (eu.x < c0-1 || eu.x > c1+1 || eu.y < r0-1 || eu.y > r1+1) continue;
    objs.push({k:5, sortY: eu.y, d: eu});
  }
  for (const ek of enemyKingdoms) {
    if (ek.hp > 0) {
      const fi = ek.ty*MAP_W + ek.tx;
      if (fogExplored[fi] && ek.tx>=c0 && ek.tx<=c1 && ek.ty>=r0 && ek.ty<=r1)
        objs.push({k:6, sortY: ek.ty+1.0, d: ek});
    }
    for (const b of ek.buildings) {
      if (b.tx < c0 || b.tx > c1 || b.ty < r0 || b.ty > r1) continue;
      if (!fogExplored[b.ty*MAP_W+b.tx]) continue;
      objs.push({k:7, sortY: b.ty+1.0, d: b});
    }
    for (const ev of ek.villagers) {
      if (ev.x < c0-1 || ev.x > c1+1 || ev.y < r0-1 || ev.y > r1+1) continue;
      if (!fogExplored[Math.floor(ev.y)*MAP_W+Math.floor(ev.x)]) continue;
      objs.push({k:8, sortY: ev.y, d: ev});
    }
  }

  // ── Sort by Y ascending (objects higher on screen drawn first / behind) ──
  objs.sort((a,b) => a.sortY - b.sortY);

  // ── Draw in order ──
  for (const {k, d} of objs) {
    if      (k===0) drawTreeObj(d, sz);
    else if (k===1) drawBuildingObj(d, sz);
    else if (k===2) drawTCSprite(d, sz);
    else if (k===3) drawVillagerChar(d, d.x*sz-camX, d.y*sz-camY, sz);
    else if (k===4) drawNPCChar(d, d.x*sz-camX, d.y*sz-camY, sz);
    else if (k===5) drawEnemyUnitChar(d, d.x*sz-camX, d.y*sz-camY, sz);
    else if (k===9) drawBanditChar(d, d.x*sz-camX, d.y*sz-camY, sz);
    else if (k===6) drawEnemyTC(d, sz);
    else if (k===7) drawEnemyBuildingObj(d, sz);
    else            drawEnemyVillagerChar(d, d.x*sz-camX, d.y*sz-camY, sz);
  }
}

function drawEnemyUnitChar(eu, px, py, sz) {
  const moving = eu.path.length > 0;
  const frame  = (moving && Math.floor(time*5+eu.id*0.83)%2===1) ? 1 : 0;
  const sprSz  = Math.max(6, sz*1.15);
  const sprX   = px - sprSz*0.5;
  const sprY   = py - sprSz*0.88;

  if (sprSz < 8) {
    ctx.fillStyle = '#c02020';
    ctx.fillRect(Math.floor(sprX), Math.floor(sprY), Math.ceil(sprSz), Math.ceil(sprSz));
    return;
  }

  // Shadow
  const shW = Math.ceil(sprSz*0.55);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(Math.floor(px-shW*0.5), Math.floor(py+sprSz*0.10), shW, Math.ceil(sprSz*0.10));

  const sprite = eu.role==='archer' ? VSPRITE.Archer[frame] : VSPRITE.Knight[frame];
  const pal    = eu.role==='archer' ? ENEMY_ARC_PAL          : ENEMY_INF_PAL;
  drawSprite(sprite, pal, sprX, sprY, sprSz);

  // Enemy infantry sword swing
  if (eu.role !== 'archer' && eu.attackAnim > 0) {
    const a = eu.attackAnim;
    const cx2 = px, cy2 = py - sprSz * 0.35;
    const bladeLen = sz * 0.52;
    const swing = (1 - a) * Math.PI * 0.85 - Math.PI * 0.1;
    ctx.save();
    ctx.translate(cx2, cy2);
    ctx.rotate(swing);
    ctx.beginPath();
    ctx.arc(0, 0, bladeLen * 0.6, -Math.PI * 0.1, (1-a) * Math.PI * 0.85, false);
    ctx.strokeStyle = `rgba(255,120,120,${a * 0.35})`;
    ctx.lineWidth = Math.max(1, sz * 0.045);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(bladeLen, 0);
    ctx.strokeStyle = '#e08080';
    ctx.lineWidth = Math.max(1, sz * 0.04);
    ctx.stroke();
    if (a > 0.6) {
      ctx.beginPath();
      ctx.arc(bladeLen, 0, Math.max(1.5, sz * 0.055), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,180,180,${(a-0.6)*2.5})`;
      ctx.fill();
    }
    ctx.restore();
  }

  if (eu.hp < eu.maxHp) drawHealthBar(sprX, sprY, eu.hp, eu.maxHp, sprSz);
}

function drawNPCChar(npc, px, py, sz) {
  const moving = npc.path.length > 0;
  const frame  = (moving && Math.floor(time*5+npc.id*0.7)%2===1) ? 1 : 0;
  const sprSz  = Math.max(6, sz*1.15);
  const sprX   = px - sprSz*0.5;
  const sprY   = py - sprSz*0.88;

  if (sprSz < 8) {
    ctx.fillStyle = npc.type==='trader' ? '#c07820' : '#c84040';
    ctx.fillRect(Math.floor(sprX), Math.floor(sprY), Math.ceil(sprSz), Math.ceil(sprSz));
    return;
  }

  // Shadow
  const shW = Math.ceil(sprSz*0.55);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(Math.floor(px-shW*0.5), Math.floor(py+sprSz*0.10), shW, Math.ceil(sprSz*0.10));

  // Arrived indicator — small pulsing dot above head
  if (npc.state==='arrived') {
    const pulse = 0.55 + 0.45*Math.sin(time*4);
    const dotR  = Math.max(2, sz*0.09);
    ctx.fillStyle = npc.type==='trader' ? `rgba(200,180,40,${pulse})` : `rgba(220,80,80,${pulse})`;
    ctx.beginPath();
    ctx.arc(Math.floor(px), Math.floor(sprY - dotR*1.5), dotR, 0, Math.PI*2);
    ctx.fill();
  }

  if (npc.type==='trader') {
    drawSprite(VSPRITE.Basic[frame], NPC_TRADER_PAL, sprX, sprY, sprSz);
  } else {
    drawSprite(VSPRITE.Knight[frame], NPC_WKNIGHT_PAL, sprX, sprY, sprSz);
  }

  // Name at high zoom
  if (sz >= 42) {
    const ny = Math.floor(sprY + sprSz + 3);
    const label = npc.type==='trader' ? `⚜ ${npc.name}` : `⚔ ${npc.name}`;
    ctx.font = `bold ${Math.max(9,sz*0.12)}px 'Silkscreen',monospace`;
    ctx.textAlign='center'; ctx.textBaseline='top';
    ctx.lineWidth=3; ctx.strokeStyle='rgba(0,0,0,0.80)';
    ctx.strokeText(label, px, ny);
    ctx.fillStyle = npc.type==='trader' ? 'rgba(220,190,80,0.95)' : 'rgba(220,100,100,0.95)';
    ctx.fillText(label, px, ny);
  }
}

function drawBanditChar(b, px, py, sz) {
  const moving = b.path.length > 0;
  const frame  = (moving && Math.floor(time*6+b.id*1.3)%2===1) ? 1 : 0;
  const sprSz  = Math.max(6, sz * 1.1);
  const sprX   = px - sprSz * 0.5;
  const sprY   = py - sprSz * 0.88;

  if (sprSz < 8) {
    ctx.fillStyle = '#1a0a18';
    ctx.fillRect(Math.floor(sprX), Math.floor(sprY), Math.ceil(sprSz), Math.ceil(sprSz));
    return;
  }

  // Ominous red flicker beneath the sprite
  const flicker = 0.3 + 0.2 * Math.sin(time * 7 + b.id * 2.1);
  const auraR = Math.max(4, sz * 0.55);
  const grad = ctx.createRadialGradient(px, py, 0, px, py, auraR);
  grad.addColorStop(0,   `rgba(180,40,0,${flicker})`);
  grad.addColorStop(1,   'rgba(180,40,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(Math.floor(px - auraR), Math.floor(py - auraR), Math.ceil(auraR*2), Math.ceil(auraR*2));

  drawSprite(VSPRITE.Basic[frame], BANDIT_PAL, sprX, sprY, sprSz);

  if (sz >= 42) {
    const ny = Math.floor(sprY + sprSz + 3);
    ctx.font = `bold ${Math.max(9,sz*0.11)}px 'Silkscreen',monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText('🗡 Rogue', px, ny);
    ctx.fillStyle = 'rgba(220,80,40,0.95)';
    ctx.fillText('🗡 Rogue', px, ny);
  }
}

// ═══════════════════════════════════════════════════
//  VILLAGER RENDERING
// ═══════════════════════════════════════════════════
function drawVillagerChar(v, px, py, sz) {
  // Possession aura — drawn before the sprite so it sits underneath
  if (v === possessedVillager) {
    const pulse = 0.55 + 0.45 * Math.sin(time * 5.0);
    const auraR = Math.max(8, sz * 0.82);
    const grad  = ctx.createRadialGradient(px, py, auraR * 0.1, px, py, auraR);
    grad.addColorStop(0, `rgba(255,80,80,${0.55 * pulse})`);
    grad.addColorStop(0.5, `rgba(220,40,40,${0.30 * pulse})`);
    grad.addColorStop(1,   'rgba(160,20,20,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(px, py - sz * 0.2, auraR, 0, Math.PI * 2); ctx.fill();
  }

  const moving = v.path.length > 0;
  const frame  = (moving && Math.floor(time * 5 + v.id * 0.61) % 2 === 1) ? 1 : 0;

  // 3/4 view: sprite is taller than a tile; feet anchor at the character's world pos
  const sprSz = Math.max(6, sz * 1.15);
  const sprX  = px - sprSz * 0.5;
  const sprY  = py - sprSz * 0.88; // head rises above world pos; feet near py+sprSz*0.12

  if (sprSz < 8) {
    const [cr,cg,cb] = ROLE_COLOR[v.role];
    ctx.fillStyle = v.selected ? 'rgba(255,215,0,1)' : `rgb(${cr},${cg},${cb})`;
    ctx.fillRect(Math.floor(sprX), Math.floor(sprY), Math.ceil(sprSz), Math.ceil(sprSz));
    return;
  }

  // Ground shadow under feet
  const shW = Math.ceil(sprSz * 0.55);
  const shH = Math.ceil(sprSz * 0.10);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(
    Math.floor(px - shW * 0.5),
    Math.floor(py + sprSz * 0.10),
    shW, shH
  );

  // Selection: bright pixel border
  if (v.selected) {
    const pad = Math.max(2, Math.floor(sz * 0.07));
    const bw  = Math.max(1, Math.floor(pad * 0.55));
    const x0  = Math.floor(sprX - pad), y0 = Math.floor(sprY - pad);
    const ww  = Math.ceil(sprSz + pad * 2);
    ctx.fillStyle = 'rgba(255,215,0,0.92)';
    ctx.fillRect(x0, y0, ww, bw);
    ctx.fillRect(x0, y0 + ww - bw, ww, bw);
    ctx.fillRect(x0, y0, bw, ww);
    ctx.fillRect(x0 + ww - bw, y0, bw, ww);
  }

  // Pixel-art sprite
  const sprites = VSPRITE[v.role] || VSPRITE.Basic;
  const pal     = VPAL[v.role]    || VPAL.Basic;
  drawSprite(sprites[frame], pal, sprX, sprY, sprSz);

  // Knight/Archer sword/bow attack animation
  if ((v.role === VROLE.KNIGHT || v.role === VROLE.ARCHER) && v.attackAnim > 0) {
    const a = v.attackAnim; // 1→0
    const cx2 = px, cy2 = py - sprSz * 0.35;
    // tier-based blade color and length
    const tierProps = [
      { col: '#c8c8c8', len: 0.55 },
      { col: '#e0e8f0', len: 0.65 },
      { col: '#a0d8ff', len: 0.80 },
    ];
    const tp = tierProps[Math.min(2, (v.tier||1)-1)];
    // tool tier controls blade width
    const toolW = [1.0, 1.35, 1.75][(v.toolTier||0)];
    const bladeLen = sz * tp.len;
    const swing = (1 - a) * Math.PI * 0.9 - Math.PI * 0.1;
    ctx.save();
    ctx.translate(cx2, cy2);
    ctx.rotate(swing);
    // sweep arc
    ctx.beginPath();
    ctx.arc(0, 0, bladeLen * 0.6, -Math.PI * 0.1, (1-a) * Math.PI * 0.9, false);
    ctx.strokeStyle = `rgba(220,220,255,${a * 0.35})`;
    ctx.lineWidth = Math.max(1, sz * 0.05 * toolW);
    ctx.stroke();
    // blade line
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(bladeLen, 0);
    ctx.strokeStyle = tp.col;
    ctx.lineWidth = Math.max(1, sz * 0.045 * toolW);
    ctx.stroke();
    // tip flash
    if (a > 0.6) {
      ctx.beginPath();
      ctx.arc(bladeLen, 0, Math.max(1.5, sz * 0.06 * toolW), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,200,${(a-0.6)*2.5})`;
      ctx.fill();
    }
    ctx.restore();
  }

  // Health bar when damaged
  if (v.hp !== undefined && v.hp < v.maxHp) {
    drawHealthBar(sprX, sprY, v.hp, v.maxHp, sprSz);
  }

  // Name label (high zoom only)
  if (sz >= 42) {
    const ny = Math.floor(sprY + sprSz + 3);
    ctx.font = `bold ${Math.max(9, sz * 0.135)}px 'Silkscreen',monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.80)';
    ctx.strokeText(v.name, px, ny);
    ctx.fillStyle = 'rgba(255,238,188,0.96)';
    ctx.fillText(v.name, px, ny);
  }
}

// ═══════════════════════════════════════════════════
//  DAY / NIGHT
// ═══════════════════════════════════════════════════
function getNightAlpha() {
  // 0 at noon (t=0.5), 1 at midnight (t=0 or 1)
  const dist=Math.abs(dayTime-0.5); // 0=noon, 0.5=midnight
  return Math.pow(Math.max(0,(dist-0.25)/0.25),2);
}
function isNight()    { return getNightAlpha()>0.5; }
function isDaylight() { return getNightAlpha()<0.05; }
function getTimeLabel() {
  const t=dayTime;
  if (t<0.10||t>0.90) return 'Midnight';
  if (t<0.24) return 'Dawn';
  if (t<0.45) return 'Morning';
  if (t<0.56) return 'Noon';
  if (t<0.76) return 'Afternoon';
  if (t<0.88) return 'Dusk';
  return 'Night';
}

// ═══════════════════════════════════════════════════
//  NIGHT OVERLAY
// ═══════════════════════════════════════════════════
function drawNightOverlay() {
  const a=getNightAlpha();
  if (a<0.01) return;
  ctx.fillStyle=`rgba(4,6,24,${a*0.80})`;
  ctx.fillRect(0,0,canvas.width,canvas.height);
  // Stars
  if (a>0.3) {
    const sa=Math.min(1,(a-0.3)/0.4);
    for (let i=0;i<80;i++) {
      const sx=Math.floor(ihash(i,0,7)*canvas.width);
      const sy=Math.floor(ihash(i,1,8)*canvas.height*0.5);
      const bright=0.35+ihash(i,3,10)*0.55;
      ctx.fillStyle=`rgba(255,255,240,${sa*bright})`;
      const ss=ihash(i,2,9)<0.12?2:1;
      ctx.fillRect(sx,sy,ss,ss);
    }
  }
}

// ── Adjacency bonus shimmer on buildings ──────────────────────────
function drawAdjacencyShimmer(sz) {
  if (sz < 8) return;
  for (const b of buildings) {
    if (!b.complete) continue;
    const adj = b.adjacencyBonus;
    if (!adj || adj === 1.0) continue;
    const fi = b.ty * MAP_W + b.tx;
    if (!fogVisible[fi]) continue;
    const positive = adj > 1.0;
    const pct = Math.round(Math.abs(adj - 1.0) * 100);
    const sx2 = Math.floor(b.tx * sz - camX);
    const sy2 = Math.floor(b.ty * sz - camY);
    const bsz = Math.ceil(sz * (b.w || 1));
    // Solid coloured border
    const lw = Math.max(2, Math.floor(sz * 0.10));
    ctx.strokeStyle = positive ? 'rgba(70,220,70,0.82)' : 'rgba(220,70,70,0.82)';
    ctx.lineWidth = lw;
    ctx.strokeRect(sx2 + lw*0.5, sy2 + lw*0.5, bsz - lw, bsz - lw);
    // Pill badge — always visible, no minimum zoom
    const label = `${positive ? '+' : '-'}${pct}%`;
    const fsz = Math.max(7, Math.min(13, sz * 0.28));
    ctx.font = `bold ${fsz}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const tw = ctx.measureText(label).width;
    const pad = 2;
    ctx.fillStyle = positive ? 'rgba(10,40,10,0.86)' : 'rgba(40,10,10,0.86)';
    ctx.fillRect(sx2 + 3, sy2 + 3, tw + pad*2, fsz + pad*2);
    ctx.fillStyle = positive ? '#7eff7e' : '#ff7e7e';
    ctx.fillText(label, sx2 + 3 + pad, sy2 + 3 + pad);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
}

// ── Adjacency preview during placement ───────────────────────────
function drawAdjacencyPreview(htx, hty, type, sx2, sy2, sz) {
  const lw = Math.max(2, Math.floor(sz * 0.10));
  let totalBonus = 1.0;

  for (const other of buildings) {
    if (!other.complete) continue;
    if (Math.abs(other.tx - htx) > 1 || Math.abs(other.ty - hty) > 1) continue;
    const myGain    = ADJACENCY_TABLE[type]?.[other.type]       ?? 0;
    const theirGain = ADJACENCY_TABLE[other.type]?.[type]       ?? 0;
    if (myGain === 0 && theirGain === 0) continue;
    totalBonus += myGain;

    // Coloured ring around the interacting neighbour
    const netSign = myGain !== 0 ? myGain : theirGain;
    const osx = Math.floor(other.tx * sz - camX);
    const osy = Math.floor(other.ty * sz - camY);
    const osz = Math.ceil(sz * (other.w || 1));
    ctx.strokeStyle = netSign > 0 ? 'rgba(100,255,100,0.90)' : 'rgba(255,100,100,0.90)';
    ctx.lineWidth = lw;
    ctx.strokeRect(osx + lw*0.5, osy + lw*0.5, osz - lw, osz - lw);

    // Small label on the neighbour showing what THEY gain from this placement
    if (theirGain !== 0) {
      const tpct = Math.round(Math.abs(theirGain) * 100);
      const tlabel = `${theirGain > 0 ? '+' : '-'}${tpct}%`;
      const tfsz = Math.max(7, Math.min(11, sz * 0.24));
      ctx.font = `bold ${tfsz}px sans-serif`;
      const ttw = ctx.measureText(tlabel).width;
      const tpad = 2;
      ctx.fillStyle = theirGain > 0 ? 'rgba(10,40,10,0.86)' : 'rgba(40,10,10,0.86)';
      ctx.fillRect(osx + osz - ttw - tpad*2 - 3, osy + 3, ttw + tpad*2, tfsz + tpad*2);
      ctx.fillStyle = theirGain > 0 ? '#7eff7e' : '#ff7e7e';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText(tlabel, osx + osz - 3, osy + 3 + tpad);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }
  }

  // Projected bonus badge on the ghost
  if (totalBonus !== 1.0) {
    const pct = Math.round((totalBonus - 1.0) * 100);
    const positive = totalBonus > 1.0;
    const label = `${positive ? '+' : ''}${pct}% adj`;
    const fsz = Math.max(9, Math.min(14, sz * 0.30));
    ctx.font = `bold ${fsz}px sans-serif`;
    const tw2 = ctx.measureText(label).width;
    const pad = 3;
    const bx = sx2 + sz * 0.5 - tw2 * 0.5 - pad;
    const by = sy2 - fsz - pad * 2 - 3;
    ctx.fillStyle = positive ? 'rgba(10,40,10,0.90)' : 'rgba(40,10,10,0.90)';
    ctx.fillRect(bx, by, tw2 + pad*2, fsz + pad*2);
    ctx.fillStyle = positive ? '#90ff90' : '#ff9090';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(label, sx2 + sz * 0.5, sy2 - pad - 3);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
}

// ═══════════════════════════════════════════════════
//  RESOURCE NODE OVERLAYS
// ═══════════════════════════════════════════════════
const NODE_ICON = { quarry:'⛏', iron:'🔩', farmland:'🌿', forest:'🌲', delta:'💧' };
const NODE_RING_COL = {
  quarry:   'rgba(200,200,160,0.18)',
  iron:     'rgba(176, 96, 64,0.18)',
  farmland: 'rgba( 96,192, 96,0.18)',
  forest:   ' rgba(26, 92, 26,0.20)',
  delta:    'rgba( 64,128,192,0.18)',
};

function drawResourceNodes(sz, c0, r0, c1, r1) {
  if (!resourceNodes) return;
  for (const node of resourceNodes) {
    if (!node.discovered) continue;
    const fi = node.ty * MAP_W + node.tx;
    if (!fogExplored[fi]) continue;

    const alpha = fogVisible[fi] ? 1.0 : 0.45;
    ctx.globalAlpha = alpha;

    // Radius tint — draw each tile in the node's radius
    const col = NODE_RING_COL[node.type] || 'rgba(255,255,255,0.15)';
    ctx.fillStyle = col;
    for (let dy = -node.radius; dy <= node.radius; dy++) {
      for (let dx = -node.radius; dx <= node.radius; dx++) {
        if (dx*dx + dy*dy > node.radius*node.radius) continue;
        const tx = node.tx + dx, ty = node.ty + dy;
        if (tx < c0 || tx > c1 || ty < r0 || ty > r1) continue;
        const tfi = ty * MAP_W + tx;
        if (!fogExplored[tfi]) continue;
        ctx.fillRect(Math.floor(tx*sz - camX), Math.floor(ty*sz - camY), Math.ceil(sz)+1, Math.ceil(sz)+1);
      }
    }

    // Centre icon label (only when zoomed in enough)
    if (sz >= 16) {
      const cx = Math.floor(node.tx * sz - camX + sz * 0.5);
      const cy = Math.floor(node.ty * sz - camY + sz * 0.5);
      const fs = Math.max(10, Math.min(22, sz * 0.55));
      ctx.font = `${fs}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillText(NODE_ICON[node.type] || '?', cx+1, cy+1);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillText(NODE_ICON[node.type] || '?', cx, cy);
    }
  }
  ctx.globalAlpha = 1.0;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

// ═══════════════════════════════════════════════════
//  MINIMAP
// ═══════════════════════════════════════════════════
function buildMinimap() {
  const mw=mmCanvas.width, mh=mmCanvas.height;
  const off=document.createElement('canvas');
  off.width=mw; off.height=mh;
  const oc=off.getContext('2d');
  const img=oc.createImageData(mw,mh);
  const d=img.data;

  for (let py=0; py<mh; py++) {
    for (let px=0; px<mw; px++) {
      const tx=Math.floor(px/mw*MAP_W);
      const ty=Math.floor(py/mh*MAP_H);
      const [r,g,b]=TILE_RGB[mapTiles[ty][tx]];
      const i=(py*mw+px)*4;
      d[i]=r; d[i+1]=g; d[i+2]=b; d[i+3]=255;
    }
  }

  oc.putImageData(img,0,0);
  mmCache=off;
}

function drawMinimap() {
  const mw=mmCanvas.width, mh=mmCanvas.height;

  // Build terrain + fog in one ImageData pass (putImageData replaces pixels,
  // so we can't layer it on top of the cache — do it all at once instead).
  const img = mmCtx.createImageData(mw, mh);
  const d   = img.data;
  for (let py=0; py<mh; py++) {
    for (let px=0; px<mw; px++) {
      const tx  = Math.floor(px / mw * MAP_W);
      const ty  = Math.floor(py / mh * MAP_H);
      const idx = ty * MAP_W + tx;
      const i   = (py * mw + px) * 4;
      if (!fogExplored[idx]) {
        // Never seen — solid black
        d[i]=0; d[i+1]=0; d[i+2]=0; d[i+3]=255;
      } else {
        const [r,g,b] = TILE_RGB[mapTiles[ty][tx]];
        if (fogVisible[idx]) {
          // Currently visible — full terrain color
          d[i]=r; d[i+1]=g; d[i+2]=b; d[i+3]=255;
        } else {
          // Explored but dark — halved brightness
          d[i]=r>>1; d[i+1]=g>>1; d[i+2]=b>>1; d[i+3]=255;
        }
      }
    }
  }
  mmCtx.putImageData(img, 0, 0);

  // Resource node dots
  if (resourceNodes) {
    for (const node of resourceNodes) {
      if (!node.discovered) continue;
      const px = node.tx / MAP_W * mw;
      const py = node.ty / MAP_H * mh;
      mmCtx.fillStyle = NODE_MM_COL[node.type] || '#ffffff';
      mmCtx.beginPath();
      mmCtx.arc(px, py, 2.5, 0, Math.PI*2);
      mmCtx.fill();
    }
  }

  // Viewport rectangle
  const sz=TILE_SZ*zoom;
  const vx=camX/sz/MAP_W*mw;
  const vy=camY/sz/MAP_H*mh;
  const vw=canvas.width /sz/MAP_W*mw;
  const vh=canvas.height/sz/MAP_H*mh;
  mmCtx.strokeStyle='rgba(255,210,70,0.9)';
  mmCtx.lineWidth=1.5;
  mmCtx.strokeRect(vx,vy,vw,vh);
}

// ═══════════════════════════════════════════════════
//  RENDER
// ═══════════════════════════════════════════════════
function render() {
  ctx.clearRect(0,0,canvas.width,canvas.height);

  // Deep-space border colour
  ctx.fillStyle='#07050a';
  ctx.fillRect(0,0,canvas.width,canvas.height);

  if (!mapTiles.length) return; // map not yet generated

  ctx.imageSmoothingEnabled = false;
  const sz=TILE_SZ*zoom;
  const c0=Math.max(0,  Math.floor(camX/sz));
  const r0=Math.max(0,  Math.floor(camY/sz));
  const c1=Math.min(MAP_W-1, Math.ceil((camX+canvas.width)/sz));
  const r1=Math.min(MAP_H-1, Math.ceil((camY+canvas.height)/sz));

  // Ground-building lookup (farmland=4, mine=5) — rebuilt only when building count changes
  if (_groundBldgCount !== buildings.length) {
    _groundBldgCount = buildings.length;
    _groundBuildingAt.clear();
    for (const b of buildings) {
      if (b.type === 4 || b.type === 5) _groundBuildingAt.set(b.ty * MAP_W + b.tx, b);
    }
  }
  const groundBuildingAt = _groundBuildingAt;

  for (let row=r0; row<=r1; row++) {
    for (let col=c0; col<=c1; col++) {
      const t=mapTiles[row][col];
      const v=mapVariant[row][col];
      const sx=Math.floor(col*sz-camX);
      const sy=Math.floor(row*sz-camY);
      const sw=Math.ceil(sz)+1; // +1 eliminates seams

      ctx.fillStyle=tileBaseColor(col,row,t,v,time);
      ctx.fillRect(sx,sy,sw,sw);

      drawDetails(col,row,t,sx,sy,sz,v,time);

      // Road overlay — warm dirt path beneath buildings/fog
      if (roadTiles.has(row*MAP_W+col)) {
        ctx.fillStyle = 'rgba(152,112,64,0.72)';
        ctx.fillRect(sx, sy, sw, sw);
      }

      // Ground-layer buildings (farmland, mine) drawn before fog
      const gb = groundBuildingAt.get(row * MAP_W + col);
      if (gb) drawGroundBuildingInline(gb, sx, sy, sz);

      // Subtle inner bevel for depth
      if (sz>=6) {
        const bv=Math.max(1,Math.min(3,sz*0.07));
        ctx.fillStyle='rgba(255,255,255,0.055)';
        ctx.fillRect(sx,sy,sw,bv);
        ctx.fillRect(sx,sy,bv,sw);
        ctx.fillStyle='rgba(0,0,0,0.10)';
        ctx.fillRect(sx,sy+sw-bv,sw,bv);
        ctx.fillRect(sx+sw-bv,sy,bv,sw);
      }

      // Fog of war overlay
      const fi = row*MAP_W + col;
      if (!fogVisible[fi]) {
        ctx.fillStyle = fogExplored[fi] ? 'rgba(0,0,0,0.62)' : '#07050a';
        ctx.fillRect(sx, sy, sw, sw);
      }
    }
  }

  // Grid overlay
  if (showGrid&&sz>=8) {
    ctx.strokeStyle='rgba(255,255,255,0.07)'; ctx.lineWidth=0.5;
    for (let col=c0; col<=c1+1; col++) {
      const x=Math.floor(col*sz-camX);
      ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,canvas.height); ctx.stroke();
    }
    for (let row=r0; row<=r1+1; row++) {
      const y=Math.floor(row*sz-camY);
      ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(canvas.width,y); ctx.stroke();
    }
  }

  drawResourceNodes(sz, c0, r0, c1, r1);
  drawAdjacencyShimmer(sz);
  drawNightOverlay();
  drawObjects();
  drawProjectiles();

  // Placement preview
  if (placingTownCenter) {
    const psz=TILE_SZ*zoom;
    const htx=Math.floor((msx+camX)/psz);
    const hty=Math.floor((msy+camY)/psz);
    const valid=canSettleAt(htx,hty);
    const hsx=Math.floor(htx*psz-camX);
    const hsy=Math.floor(hty*psz-camY);
    const hsw=Math.ceil(psz);
    ctx.fillStyle=valid?'rgba(80,200,80,0.18)':'rgba(200,60,60,0.18)';
    ctx.fillRect(hsx,hsy,hsw,hsw);
    ctx.globalAlpha=0.65;
    drawSprite(TC_STAMP,TC_PAL,hsx,hsy,psz);
    ctx.globalAlpha=1.0;
    const bw=Math.max(1,Math.floor(psz*0.06));
    ctx.fillStyle=valid?'rgba(80,200,80,0.9)':'rgba(200,60,60,0.9)';
    ctx.fillRect(hsx,hsy,hsw,bw); ctx.fillRect(hsx,hsy+hsw-bw,hsw,bw);
    ctx.fillRect(hsx,hsy,bw,hsw); ctx.fillRect(hsx+hsw-bw,hsy,bw,hsw);
  }

  if (placingType !== null) {
    const psz=TILE_SZ*zoom;
    const htx=Math.floor((msx+camX)/psz);
    const hty=Math.floor((msy+camY)/psz);
    const valid=canBuildAt(htx,hty,placingType);
    const hsx=Math.floor(htx*psz-camX);
    const hsy=Math.floor(hty*psz-camY);
    const [pw,ph]=STRUCT_SIZE[placingType]||[1,1];
    const hsw=Math.ceil(psz*pw);
    const hsh=Math.ceil(psz*ph);
    const bsz=psz*pw; // sprite rendered at building width
    ctx.fillStyle=valid?'rgba(80,200,80,0.18)':'rgba(200,60,60,0.18)';
    ctx.fillRect(hsx,hsy,hsw,hsh);
    ctx.globalAlpha=0.65;
    drawSprite(BSTAMP[placingType],BSTAMP_PAL[placingType],hsx,hsy,bsz);
    ctx.globalAlpha=1.0;
    const bww=Math.max(1,Math.floor(psz*0.06));
    ctx.fillStyle=valid?'rgba(80,200,80,0.85)':'rgba(200,60,60,0.85)';
    ctx.fillRect(hsx,hsy,hsw,bww);
    ctx.fillRect(hsx,hsy+hsh-bww,hsw,bww);
    ctx.fillRect(hsx,hsy,bww,hsh);
    ctx.fillRect(hsx+hsw-bww,hsy,bww,hsh);
    drawAdjacencyPreview(htx, hty, placingType, hsx, hsy, psz);
  }

  // Projectiles (arrows / slashes)
  function drawProjectiles() {
    if (!projectiles.length) return;
    const sz = TILE_SZ * zoom;
    ctx.save();
    for (const p of projectiles) {
      const px = p.x * sz - camX;
      const py = p.y * sz - camY;
      if (p.type === 'arrow') {
        // Draw a thin line in flight direction
        const len = Math.max(4, sz*0.4);
        const ex  = px - p.vx * len;
        const ey  = py - p.vy * len;
        ctx.strokeStyle = 'rgba(160,120,60,0.85)';
        ctx.lineWidth   = Math.max(1, sz*0.04);
        ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(px, py); ctx.stroke();
        // Tip dot
        ctx.fillStyle = 'rgba(200,160,60,0.9)';
        ctx.fillRect(Math.floor(px-1), Math.floor(py-1), 2, 2);
      } else {
        // Slash: bright cross flash
        const r = Math.max(2, sz*0.14);
        ctx.fillStyle = 'rgba(255,220,60,0.75)';
        ctx.fillRect(Math.floor(px-r), Math.floor(py-1), r*2, 2);
        ctx.fillRect(Math.floor(px-1), Math.floor(py-r), 2, r*2);
      }
    }
    ctx.restore();
  }

  // Territory boundary ring
  if (settled && townCenter) {
    const sz2 = TILE_SZ * zoom;
    const tr = getTerritoryRadius() * sz2;
    const tcsx = (townCenter.tx + 0.5) * sz2 - camX;
    const tcsy = (townCenter.ty + 0.5) * sz2 - camY;
    ctx.save();
    ctx.setLineDash([6, 10]);
    ctx.lineDashOffset = -(time * 12) % 16;
    ctx.strokeStyle = 'rgba(200,146,42,0.20)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(tcsx, tcsy, tr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // Vignette
  const vg=ctx.createRadialGradient(
    canvas.width*.5,canvas.height*.5,canvas.height*.28,
    canvas.width*.5,canvas.height*.5,canvas.height*.88
  );
  vg.addColorStop(0,'rgba(0,0,0,0)');
  vg.addColorStop(1,'rgba(0,0,0,0.38)');
  ctx.fillStyle=vg;
  ctx.fillRect(0,0,canvas.width,canvas.height);
}
