// Solmar Bay — everything the player sees, drawn on one canvas:
// the sun-soaked city, the cars and people in it, the HUD with its
// minimap, and the title / paused / busted panels.
import { WORLD_W, WORLD_H, ROAD_W, ROAD_HALF, SEA_W, PALETTE, KMH } from './config.js';
import { objectiveOf } from './world.js';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawCar(ctx, x, y, angle, color, kind, lights) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  roundRect(ctx, -21, -9, 44, 22, 6);
  ctx.fill();
  ctx.fillStyle = color;
  roundRect(ctx, -22, -11, 44, 22, 6);
  ctx.fill();
  ctx.fillStyle = 'rgba(20,30,50,0.75)';
  roundRect(ctx, -6, -9, 14, 18, 3);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  if (lights) {
    ctx.fillRect(20, -9, 3, 4);
    ctx.fillRect(20, 5, 3, 4);
  }
  if (kind === 'taxi') {
    ctx.fillStyle = '#222';
    ctx.font = 'bold 7px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('TAXI', 0, 3);
  }
  ctx.restore();
}

function drawPed(ctx, x, y, angle, color, down) {
  ctx.save();
  ctx.translate(x, y);
  if (down) {
    ctx.rotate(Math.PI / 2);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(0, 0, 9, 5, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.rotate(angle);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.arc(1, 2, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(4, 0, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawWorld(ctx, state, cam, viewW, viewH) {
  const x0 = cam.x - viewW / 2;
  const y0 = cam.y - viewH / 2;
  // Ground.
  ctx.fillStyle = PALETTE.grass;
  ctx.fillRect(0, 0, viewW, viewH);
  // Sea and beach (world space, only when on screen).
  const seaX = -x0;
  if (seaX < viewW) {
    ctx.fillStyle = PALETTE.sea;
    ctx.fillRect(0, 0, Math.max(0, SEA_W - x0), viewH);
    ctx.fillStyle = PALETTE.seaDeep;
    for (let wy = 40; wy < WORLD_H; wy += 180) {
      const yy = wy - y0 + Math.sin(state.time * 0.8 + wy * 0.05) * 4;
      ctx.fillRect(10 - x0, yy, 34, 3);
      ctx.fillRect(56 - x0, yy + 46, 24, 3);
    }
    ctx.fillStyle = PALETTE.sand;
    ctx.fillRect(SEA_W - x0, 0, 160, viewH);
  }
  // Parks.
  for (const park of state.parks) {
    if (park.x + park.w < x0 || park.x > x0 + viewW || park.y + park.h < y0 || park.y > y0 + viewH) continue;
    ctx.fillStyle = PALETTE.park;
    ctx.fillRect(park.x - x0, park.y - y0, park.w, park.h);
    for (const t of park.trees) {
      ctx.fillStyle = '#3a7a3a';
      ctx.beginPath();
      ctx.arc(t.x - x0, t.y - y0, t.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#5aa84a';
      ctx.beginPath();
      ctx.arc(t.x - x0 - 3, t.y - y0 - 3, t.r * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Roads.
  ctx.fillStyle = '#3d3a38';
  for (const rx of state.roadX) {
    ctx.fillRect(rx - ROAD_HALF - x0, -y0, ROAD_W, WORLD_H);
  }
  for (const ry of state.roadY) {
    ctx.fillRect(-x0, ry - ROAD_HALF - y0, WORLD_W, ROAD_W);
  }
  // Lane markings (dashed centre lines).
  ctx.strokeStyle = PALETTE.lane;
  ctx.lineWidth = 3;
  ctx.setLineDash([18, 22]);
  ctx.beginPath();
  for (const rx of state.roadX) {
    ctx.moveTo(rx - x0, -y0);
    ctx.lineTo(rx - x0, WORLD_H - y0);
  }
  for (const ry of state.roadY) {
    ctx.moveTo(-x0, ry - y0);
    ctx.lineTo(WORLD_W - x0, ry - y0);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  // Sidewalk edges.
  ctx.strokeStyle = PALETTE.sidewalk;
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (const rx of state.roadX) {
    ctx.moveTo(rx - ROAD_HALF - 2 - x0, -y0);
    ctx.lineTo(rx - ROAD_HALF - 2 - x0, WORLD_H - y0);
    ctx.moveTo(rx + ROAD_HALF + 2 - x0, -y0);
    ctx.lineTo(rx + ROAD_HALF + 2 - x0, WORLD_H - y0);
  }
  for (const ry of state.roadY) {
    ctx.moveTo(-x0, ry - ROAD_HALF - 2 - y0);
    ctx.lineTo(WORLD_W - x0, ry - ROAD_HALF - 2 - y0);
    ctx.moveTo(-x0, ry + ROAD_HALF + 2 - y0);
    ctx.lineTo(WORLD_W - x0, ry + ROAD_HALF + 2 - y0);
  }
  ctx.stroke();
  // Buildings.
  for (const b of state.buildings) {
    if (b.x + b.w < x0 || b.x > x0 + viewW || b.y + b.h < y0 || b.y > y0 + viewH) continue;
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(b.x - x0 + 4, b.y - y0 + 5, b.w, b.h);
    ctx.fillStyle = b.color;
    ctx.fillRect(b.x - x0, b.y - y0, b.w, b.h);
    ctx.fillStyle = b.roof;
    ctx.fillRect(b.x - x0 + 5, b.y - y0 + 5, b.w - 10, Math.min(18, b.h - 10));
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    for (let wx = b.x + 14; wx < b.x + b.w - 8; wx += 22) {
      for (let wy = b.y + 30; wy < b.y + b.h - 8; wy += 22) {
        ctx.strokeRect(wx - x0, wy - y0, 10, 12);
      }
    }
  }
  // Cash stashes (a glint the player can spot).
  const glint = 0.6 + 0.4 * Math.sin(state.time * 4);
  for (const s of state.stashes) {
    if (s.taken) continue;
    if (s.x < x0 || s.x > x0 + viewW || s.y < y0 || s.y > y0 + viewH) continue;
    ctx.fillStyle = `rgba(255,210,62,${glint})`;
    ctx.beginPath();
    ctx.arc(s.x - x0, s.y - y0, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#7a5a00';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('$', s.x - x0, s.y - y0 + 4);
  }
  // Mara, waiting for her ride.
  if (state.mission.index === 0 && !state.mission.mara.boarded) {
    const m = state.mission.mara;
    ctx.fillStyle = PALETTE.mara;
    ctx.beginPath();
    ctx.arc(m.x - x0, m.y - y0, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('M', m.x - x0, m.y - y0 + 4);
  }
  // Mission marker: a pulsing ring over the objective.
  const obj = objectiveOf(state);
  const pulse = 14 + 4 * Math.sin(state.time * 5);
  ctx.strokeStyle = PALETTE.marker;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(obj.x - x0, obj.y - y0, pulse + 8, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = PALETTE.marker;
  ctx.beginPath();
  ctx.moveTo(obj.x - x0, obj.y - y0 - pulse - 14);
  ctx.lineTo(obj.x - x0 - 7, obj.y - y0 - pulse - 2);
  ctx.lineTo(obj.x - x0 + 7, obj.y - y0 - pulse - 2);
  ctx.closePath();
  ctx.fill();
  // Parked and driven cars.
  for (const car of state.cars) {
    if (car.x < x0 - 40 || car.x > x0 + viewW + 40 || car.y < y0 - 40 || car.y > y0 + viewH + 40) continue;
    drawCar(ctx, car.x - x0, car.y - y0, car.angle, car.color, car.kind, !car.parked);
  }
  // Traffic.
  for (const t of state.traffic) {
    if (t.x < x0 - 40 || t.x > x0 + viewW + 40 || t.y < y0 - 40 || t.y > y0 + viewH + 40) continue;
    drawCar(ctx, t.x - x0, t.y - y0, t.angle, t.color, t.kind, true);
  }
  // Police, with flashing light bars.
  const flash = Math.floor(state.time * 6) % 2 === 0;
  for (const cop of state.police) {
    if (cop.x < x0 - 40 || cop.x > x0 + viewW + 40 || cop.y < y0 - 40 || cop.y > y0 + viewH + 40) continue;
    drawCar(ctx, cop.x - x0, cop.y - y0, cop.angle, PALETTE.police, 'police', true);
    ctx.fillStyle = flash ? '#ff3b30' : '#3b82ff';
    ctx.beginPath();
    ctx.arc(cop.x - x0, cop.y - y0, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  // Pedestrians.
  for (const ped of state.peds) {
    if (ped.inCar) continue;
    if (ped.x < x0 - 20 || ped.x > x0 + viewW + 20 || ped.y < y0 - 20 || ped.y > y0 + viewH + 20) continue;
    drawPed(ctx, ped.x - x0, ped.y - y0, ped.angle, ped.taxi ? PALETTE.taxi : ped.color, ped.down);
    if (ped.taxi && !ped.down) {
      ctx.fillStyle = '#222';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('TAXI', ped.x - x0, ped.y - y0 - 14);
    }
  }
  // The player.
  const p = state.player;
  if (p.onFoot) {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(p.x - x0 + 2, p.y - y0 + 3, 12, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PALETTE.player;
    ctx.beginPath();
    ctx.arc(p.x - x0, p.y - y0, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#7a5a00';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x - x0, p.y - y0, 13, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(p.x - x0 + Math.cos(p.angle) * 6, p.y - y0 + Math.sin(p.angle) * 6, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

// --- HUD, minimap, panels ---

function drawMinimap(ctx, state, x, y, w, h) {
  const sx = w / WORLD_W;
  const sy = h / WORLD_H;
  ctx.save();
  ctx.fillStyle = 'rgba(10,20,30,0.75)';
  roundRect(ctx, x - 4, y - 4, w + 8, h + 8, 8);
  ctx.fill();
  ctx.fillStyle = '#2fa8c9';
  ctx.fillRect(x, y, SEA_W * sx, h);
  ctx.fillStyle = '#e8d5a3';
  ctx.fillRect(x + SEA_W * sx, y, 160 * sx, h);
  ctx.fillStyle = '#7fae62';
  ctx.fillRect(x + (SEA_W + 160) * sx, y, w - (SEA_W + 160) * sx, h);
  ctx.fillStyle = '#3d3a38';
  for (const rx of state.roadX) ctx.fillRect(x + rx * sx - 1, y, 2, h);
  for (const ry of state.roadY) ctx.fillRect(x, y + ry * sy - 1, w, 2);
  const obj = objectiveOf(state);
  ctx.fillStyle = PALETTE.marker;
  ctx.beginPath();
  ctx.arc(x + obj.x * sx, y + obj.y * sy, 4, 0, Math.PI * 2);
  ctx.fill();
  for (const cop of state.police) {
    ctx.fillStyle = '#3b82ff';
    ctx.fillRect(x + cop.x * sx - 2, y + cop.y * sy - 2, 4, 4);
  }
  const p = state.player;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(x + p.x * sx, y + p.y * sy, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = PALETTE.player;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x + p.x * sx, y + p.y * sy, 4, 0, Math.PI * 2);
  ctx.stroke();
  // Viewport frame.
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

function drawHud(ctx, state, viewW, viewH) {
  const obj = objectiveOf(state);
  ctx.textAlign = 'left';
  // Cash.
  ctx.fillStyle = 'rgba(10,20,30,0.7)';
  roundRect(ctx, 12, 12, 150, 40, 8);
  ctx.fill();
  ctx.fillStyle = '#7dff8a';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText(`$${state.cash}`, 24, 40);
  // Wanted stars.
  ctx.fillStyle = 'rgba(10,20,30,0.7)';
  roundRect(ctx, viewW - 182, 12, 170, 40, 8);
  ctx.fill();
  ctx.font = '22px sans-serif';
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = i < state.wanted ? '#ffd23e' : 'rgba(255,255,255,0.25)';
    ctx.fillText('★', viewW - 170 + i * 32, 40);
  }
  // Objective.
  const label = `${obj.label} — ${Math.round(obj.dist)}m`;
  ctx.font = 'bold 15px sans-serif';
  const tw = ctx.measureText(label).width;
  ctx.fillStyle = 'rgba(10,20,30,0.7)';
  roundRect(ctx, (viewW - tw) / 2 - 14, 12, tw + 28, 34, 8);
  ctx.fill();
  ctx.fillStyle = '#ffd23e';
  ctx.textAlign = 'center';
  ctx.fillText(label, viewW / 2, 35);
  ctx.textAlign = 'left';
  // Speed and car health.
  const p = state.player;
  if (!p.onFoot) {
    const car = state.cars.find((c) => c.id === p.carId);
    ctx.fillStyle = 'rgba(10,20,30,0.7)';
    roundRect(ctx, viewW - 182, viewH - 92, 170, 80, 8);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText(`${Math.round(Math.abs(car ? car.speed : 0) * KMH)}`, viewW - 170, viewH - 58);
    ctx.font = '13px sans-serif';
    ctx.fillStyle = '#bbb';
    ctx.fillText('km/h', viewW - 110, viewH - 58);
    ctx.fillStyle = car && car.health > 30 ? '#7dff8a' : '#ff5a4a';
    ctx.fillRect(viewW - 170, viewH - 44, 146 * ((car ? car.health : 100) / 100), 8);
    ctx.fillStyle = '#bbb';
    ctx.font = '11px sans-serif';
    ctx.fillText('CAR', viewW - 170, viewH - 22);
  }
  // Mission name.
  if (state.mission.index < 3) {
    ctx.fillStyle = 'rgba(10,20,30,0.55)';
    ctx.font = 'bold 13px sans-serif';
    const name = ['1 · The Pickup', '2 · The Drop', '3 · The Getaway'][state.mission.index];
    ctx.fillText(name, 16, viewH - 16);
  }
  // Message line.
  if (state.message) {
    ctx.font = '15px sans-serif';
    const mw = ctx.measureText(state.message).width;
    ctx.fillStyle = 'rgba(10,20,30,0.75)';
    roundRect(ctx, (viewW - mw) / 2 - 12, viewH - 52, mw + 24, 30, 8);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText(state.message, viewW / 2, viewH - 32);
    ctx.textAlign = 'left';
  }
  drawMinimap(ctx, state, 16, viewH - 138, 190, 118);
}

function drawPanel(ctx, viewW, viewH, title, lines, foot) {
  ctx.fillStyle = 'rgba(8,16,28,0.72)';
  ctx.fillRect(0, 0, viewW, viewH);
  const w = Math.min(640, viewW - 60);
  const h = 130 + lines.length * 30 + (foot ? 46 : 0);
  const x = (viewW - w) / 2;
  const y = (viewH - h) / 2;
  ctx.fillStyle = '#101c2c';
  roundRect(ctx, x, y, w, h, 14);
  ctx.fill();
  ctx.strokeStyle = '#ffd23e';
  ctx.lineWidth = 2;
  roundRect(ctx, x, y, w, h, 14);
  ctx.stroke();
  ctx.fillStyle = '#ffd23e';
  ctx.font = 'bold 34px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(title, viewW / 2, y + 58);
  ctx.fillStyle = '#e8e8e8';
  ctx.font = '16px sans-serif';
  lines.forEach((line, i) => ctx.fillText(line, viewW / 2, y + 100 + i * 30));
  if (foot) {
    ctx.fillStyle = '#ffd23e';
    ctx.font = 'bold 17px sans-serif';
    ctx.fillText(foot, viewW / 2, y + h - 24);
  }
  ctx.textAlign = 'left';
}

export function render(ctx, state, view) {
  const { width, height, screen, camera } = view;
  ctx.clearRect(0, 0, width, height);
  drawWorld(ctx, state, camera, width, height);
  if (screen === 'play' || screen === 'paused') drawHud(ctx, state, width, height);
  if (screen === 'title') {
    const lines = [
      'A sun-soaked city. Three jobs. One way out clean.',
      'Steal a car, lose the cops, get paid.',
      '',
      'WASD / arrows — move & drive   Shift — run   Space — punch',
      'E — steal / exit a car   P — pause',
    ];
    drawPanel(ctx, width, height, 'SOLMAR BAY', lines, 'Press Enter to start');
  } else if (screen === 'paused') {
    drawPanel(ctx, width, height, 'PAUSED', ['Take a breath. The city waits.'], 'Press P to keep playing');
  } else if (screen === 'busted') {
    drawPanel(
      ctx, width, height, 'BUSTED',
      ['The Solmar Bay police caught you on foot.', `They took $${100} off you.`],
      'Press Enter to walk free',
    );
  }
}
