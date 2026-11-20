// Drawing only: the world's state and the current screen in, pixels out.
// The camera follows the player across the 3200 x 2400 city; the HUD, the
// minimap and the panels are drawn in screen space on top. Flat shapes and
// canvas text, no images, no network.
import {
  BEACH_W, CAR_LEN, CAR_WID, HORIZONTAL_ROADS, MISSIONS, PALETTE, ROAD_W,
  SEA_W, VERTICAL_ROADS, WORLD_H, WORLD_W,
} from './config.js';
import { KIND_PLAYER, KIND_POLICE, KIND_WRECK, currentTarget, objectiveText } from './world.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_BUSTED = 'busted';

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const MAP_W = 200;
const MAP_H = 150;

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  let viewW = 0;
  let viewH = 0;

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    viewW = window.innerWidth;
    viewH = window.innerHeight;
    canvas.width = Math.round(viewW * ratio);
    canvas.height = Math.round(viewH * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function text(value, x, y, size, color, align, weight) {
    ctx.font = `${weight || 400} ${size}px ${FONT}`;
    ctx.fillStyle = color;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(value, x, y);
  }

  function drawCar(car, time) {
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.angle);
    // Wheels.
    ctx.fillStyle = '#14161a';
    ctx.fillRect(-CAR_LEN / 2 + 4, -CAR_WID / 2 - 3, 10, 6);
    ctx.fillRect(CAR_LEN / 2 - 14, -CAR_WID / 2 - 3, 10, 6);
    ctx.fillRect(-CAR_LEN / 2 + 4, CAR_WID / 2 - 3, 10, 6);
    ctx.fillRect(CAR_LEN / 2 - 14, CAR_WID / 2 - 3, 10, 6);
    // Body.
    ctx.fillStyle = car.kind === KIND_WRECK ? '#5a5f66' : car.color;
    roundRect(ctx, -CAR_LEN / 2, -CAR_WID / 2, CAR_LEN, CAR_WID, 7);
    ctx.fill();
    if (car.kind === KIND_POLICE) {
      // Black doors on a white cruiser.
      ctx.fillStyle = '#1d2126';
      ctx.fillRect(-4, -CAR_WID / 2, 12, CAR_WID);
      // Flashing light bar.
      const phase = Math.floor(time * 4) % 2 === 0;
      ctx.fillStyle = phase ? '#ff2e2e' : '#2e6bff';
      ctx.fillRect(-6, -CAR_WID / 2 - 2, 7, 5);
      ctx.fillStyle = phase ? '#2e6bff' : '#ff2e2e';
      ctx.fillRect(1, -CAR_WID / 2 - 2, 7, 5);
    } else {
      // Windshield and rear window.
      ctx.fillStyle = '#bfe3ee';
      ctx.fillRect(CAR_LEN / 2 - 14, -CAR_WID / 2 + 4, 8, CAR_WID - 8);
      ctx.fillStyle = '#22262c';
      ctx.fillRect(-CAR_LEN / 2 + 6, -CAR_WID / 2 + 4, 5, CAR_WID - 8);
    }
    if (car.kind === KIND_PLAYER) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      roundRect(ctx, -CAR_LEN / 2 - 2, -CAR_WID / 2 - 2, CAR_LEN + 4, CAR_WID + 4, 9);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPerson(x, y, angle, color, down) {
    ctx.save();
    ctx.translate(x, y);
    if (down) {
      ctx.rotate(Math.PI / 2);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(0, 0, 11, 6, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.rotate(angle);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f2d5b8';
      ctx.beginPath();
      ctx.arc(3, 0, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#14161a';
      ctx.beginPath();
      ctx.arc(11, 0, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawWorld(world, camX, camY, time) {
    const x0 = camX;
    const y0 = camY;
    const x1 = camX + viewW;
    const y1 = camY + viewH;
    // Ground: grass, then sand, then sea along the west edge.
    ctx.fillStyle = PALETTE.grass;
    ctx.fillRect(x0, y0, viewW, viewH);
    ctx.fillStyle = PALETTE.sand;
    ctx.fillRect(SEA_W, y0, BEACH_W, viewH);
    ctx.fillStyle = PALETTE.sea;
    ctx.fillRect(x0, y0, SEA_W, viewH);
    ctx.strokeStyle = PALETTE.seaDeep;
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i += 1) {
      const wy = y0 + ((i * 397 + Math.floor(time * 30)) % 420);
      ctx.beginPath();
      ctx.moveTo(x0, wy);
      ctx.quadraticCurveTo(x0 + 30, wy + 8, x0 + 55, wy);
      ctx.quadraticCurveTo(x0 + 80, wy - 8, x0 + 108, wy);
      ctx.stroke();
    }
    // Sidewalks: a pale band each side of every road.
    ctx.fillStyle = PALETTE.sidewalk;
    for (const vx of VERTICAL_ROADS) ctx.fillRect(vx - 64, y0, 128, viewH);
    for (const hy of HORIZONTAL_ROADS) ctx.fillRect(x0, hy - 64, viewW, 128);
    // Parks and their trees.
    for (const park of world.parks) {
      if (park.x > x1 || park.x + park.w < x0 || park.y > y1 || park.y + park.h < y0) continue;
      ctx.fillStyle = PALETTE.park;
      ctx.fillRect(park.x, park.y, park.w, park.h);
      for (const tree of park.trees) {
        ctx.fillStyle = '#2f6b2f';
        ctx.beginPath();
        ctx.arc(tree.x, tree.y, tree.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#4c8a3f';
        ctx.beginPath();
        ctx.arc(tree.x - 3, tree.y - 3, tree.r * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Roads.
    ctx.fillStyle = PALETTE.road;
    for (const vx of VERTICAL_ROADS) ctx.fillRect(vx - ROAD_W / 2, y0, ROAD_W, viewH);
    for (const hy of HORIZONTAL_ROADS) ctx.fillRect(x0, hy - ROAD_W / 2, viewW, ROAD_W);
    // Lane dashes down each road's centre.
    ctx.strokeStyle = PALETTE.lane;
    ctx.lineWidth = 3;
    ctx.setLineDash([22, 26]);
    for (const vx of VERTICAL_ROADS) {
      ctx.beginPath();
      ctx.moveTo(vx, y0);
      ctx.lineTo(vx, y1);
      ctx.stroke();
    }
    for (const hy of HORIZONTAL_ROADS) {
      ctx.beginPath();
      ctx.moveTo(x0, hy);
      ctx.lineTo(x1, hy);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // Buildings: pastel block, darker roof edge, a window grid, a label.
    for (const b of world.buildings) {
      if (b.x > x1 || b.x + b.w < x0 || b.y > y1 || b.y + b.h < y0) continue;
      ctx.fillStyle = b.color;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = PALETTE.roof;
      ctx.fillRect(b.x, b.y, b.w, 10);
      ctx.fillStyle = '#ffffff55';
      const cols = Math.max(1, Math.floor(b.w / 34));
      const rows = Math.max(1, Math.floor(b.h / 34));
      for (let c = 0; c < cols; c += 1) {
        for (let r = 0; r < rows; r += 1) {
          ctx.fillRect(b.x + 12 + c * 34, b.y + 18 + r * 34, 16, 18);
        }
      }
      if (b.label) {
        text(b.label, b.x + b.w / 2, b.y + b.h / 2, 15, '#20242a', 'center', 700);
      }
    }
    // Cash stashes: a gold glint on the pavement.
    for (const stash of world.stashes) {
      if (stash.taken) continue;
      const pulse = 0.6 + 0.4 * Math.sin(time * 3 + stash.id);
      ctx.fillStyle = `rgba(242, 194, 48, ${pulse})`;
      ctx.beginPath();
      ctx.arc(stash.x, stash.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#7a5c00';
      text('$', stash.x, stash.y + 4, 11, '#7a5c00', 'center', 700);
    }
    // Mission marker: a pulsing diamond and a beam of light.
    const target = currentTarget(world);
    if (target) {
      const pulse = 1 + 0.18 * Math.sin(time * 4);
      ctx.fillStyle = '#f2c23033';
      ctx.beginPath();
      ctx.arc(target.x, target.y, 34 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f2c230';
      ctx.save();
      ctx.translate(target.x, target.y);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-9 * pulse, -9 * pulse, 18 * pulse, 18 * pulse);
      ctx.restore();
      ctx.strokeStyle = '#f2c230';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(target.x, target.y - 70);
      ctx.lineTo(target.x, target.y - 26);
      ctx.stroke();
    }
    // The package, waiting at the docks.
    if (world.mission.index === 1 && world.mission.stage === 'pickup') {
      const p = MISSIONS[1].pickup;
      ctx.fillStyle = '#8a6d3b';
      ctx.fillRect(p.x - 12, p.y - 9, 24, 18);
      ctx.strokeStyle = '#5c471f';
      ctx.lineWidth = 2;
      ctx.strokeRect(p.x - 12, p.y - 9, 24, 18);
    }
    // The rider: Mara in pink, a fare in yellow.
    if (world.rider && world.rider.state !== 'inCar' && world.rider.state !== 'done') {
      const color = world.rider.kind === 'mara' ? '#e86a92' : '#f2c230';
      drawPerson(world.rider.x, world.rider.y, -Math.PI / 2, color, false);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(world.rider.x, world.rider.y - 16, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    // Pedestrians, then cars, then the player.
    for (const ped of world.peds) drawPerson(ped.x, ped.y, ped.angle, ped.color, ped.state === 'down');
    for (const car of world.cars) {
      if (car.kind === KIND_PLAYER) continue;
      drawCar(car, time);
    }
    const { player } = world;
    if (player.onFoot) {
      drawPerson(player.x, player.y, player.angle, PALETTE.player, false);
    } else if (player.car) {
      drawCar(player.car, time);
    }
    // A red flash at the screen edge while the player is about to be busted.
    if (world.bustedTimer > 0.3) {
      ctx.strokeStyle = `rgba(255, 40, 40, ${0.25 + 0.25 * Math.sin(time * 10)})`;
      ctx.lineWidth = 14;
      ctx.strokeRect(x0 + 7, y0 + 7, viewW - 14, viewH - 14);
    }
  }

  // The camera the HUD's edge arrow needs; set by paint() before drawHud.
  const uiCam = { x: 0, y: 0 };

  function drawMinimap(world) {
    const mx = viewW - MAP_W - 16;
    const my = 16;
    const sx = MAP_W / WORLD_W;
    const sy = MAP_H / WORLD_H;
    ctx.fillStyle = '#10151cd9';
    ctx.fillRect(mx - 4, my - 4, MAP_W + 8, MAP_H + 8);
    ctx.fillStyle = PALETTE.sea;
    ctx.fillRect(mx, my, SEA_W * sx, MAP_H);
    ctx.fillStyle = PALETTE.grass;
    ctx.fillRect(mx + SEA_W * sx, my, MAP_W - SEA_W * sx, MAP_H);
    ctx.strokeStyle = '#d7dbe0';
    ctx.lineWidth = 1;
    for (const vx of VERTICAL_ROADS) {
      ctx.beginPath();
      ctx.moveTo(mx + vx * sx, my);
      ctx.lineTo(mx + vx * sx, my + MAP_H);
      ctx.stroke();
    }
    for (const hy of HORIZONTAL_ROADS) {
      ctx.beginPath();
      ctx.moveTo(mx, my + hy * sy);
      ctx.lineTo(mx + MAP_W, my + hy * sy);
      ctx.stroke();
    }
    const target = currentTarget(world);
    if (target) {
      ctx.fillStyle = '#f2c230';
      ctx.beginPath();
      ctx.arc(mx + target.x * sx, my + target.y * sy, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const car of world.cars) {
      if (car.kind === KIND_POLICE) {
        ctx.fillStyle = '#ff4040';
        ctx.fillRect(mx + car.x * sx - 2, my + car.y * sy - 2, 4, 4);
      }
    }
    const { player } = world;
    const px = player.onFoot ? player.x : player.car.x;
    const py = player.onFoot ? player.y : player.car.y;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(mx + px * sx, my + py * sy, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.strokeRect(mx - 4, my - 4, MAP_W + 8, MAP_H + 8);
  }

  function drawHud(world, time) {
    const { player } = world;
    // Cash and wanted stars, top left.
    ctx.fillStyle = '#10151cd9';
    roundRect(ctx, 12, 12, 210, 64, 10);
    ctx.fill();
    text(`$${world.cash.toLocaleString('en-US')}`, 28, 42, 28, '#ffffff', 'left', 700);
    let stars = '';
    for (let i = 0; i < 5; i += 1) stars += i < world.wanted ? '★' : '☆';
    text(stars, 28, 66, 20, world.wanted > 0 ? '#ffd23d' : '#8b93a3', 'left', 700);
    // Objective, top centre, with the distance in metres.
    const target = currentTarget(world);
    const px = player.onFoot ? player.x : player.car.x;
    const py = player.onFoot ? player.y : player.car.y;
    const objective = objectiveText(world);
    const dist = target ? Math.round(Math.hypot(target.x - px, target.y - py) / 8) : null;
    ctx.fillStyle = '#10151cd9';
    const label = dist === null ? objective : `${objective}  ·  ${dist} m`;
    ctx.font = `600 17px ${FONT}`;
    const w = ctx.measureText(label).width + 28;
    roundRect(ctx, (viewW - w) / 2, 12, w, 34, 10);
    ctx.fill();
    text(label, viewW / 2, 35, 17, '#ffffff', 'center', 600);
    // Mission banner, under the objective.
    if (world.banner) {
      ctx.font = `700 20px ${FONT}`;
      const bw = ctx.measureText(world.banner.text).width + 32;
      ctx.fillStyle = '#f2c230';
      roundRect(ctx, (viewW - bw) / 2, 54, bw, 34, 10);
      ctx.fill();
      text(world.banner.text, viewW / 2, 77, 20, '#20242a', 'center', 700);
    }
    drawMinimap(world);
    // Speed and car health, bottom right, while driving.
    if (!player.onFoot && player.car) {
      const kmh = Math.round(Math.abs(player.car.speed) * 0.22);
      ctx.fillStyle = '#10151cd9';
      roundRect(ctx, viewW - 216, viewH - 76, 200, 60, 10);
      ctx.fill();
      text(`${kmh} km/h`, viewW - 32, viewH - 50, 24, '#ffffff', 'right', 700);
      text('CAR', viewW - 200, viewH - 50, 14, '#8b93a3', 'left', 600);
      ctx.fillStyle = '#2c3037';
      ctx.fillRect(viewW - 200, viewH - 38, 168, 8);
      ctx.fillStyle = player.car.health > 40 ? '#3d9e6a' : '#d94f3d';
      ctx.fillRect(viewW - 200, viewH - 38, 168 * Math.max(0, player.car.health) / 100, 8);
    }
    // Context hint, bottom left.
    let hint = null;
    if (player.onFoot) {
      const near = world.cars.some((c) => (c.kind === 'parked' || c.kind === 'traffic')
        && Math.hypot(c.x - player.x, c.y - player.y) < 60);
      if (near) hint = 'E — steal the car';
      else hint = 'WASD move · Shift run · Space punch · E enter car · P pause';
    } else {
      hint = 'WASD drive · E leave car · P pause';
    }
    text(hint, 20, viewH - 20, 15, '#ffffff', 'left', 500);
    // Off-screen marker arrow, pointing at the objective.
    if (target) {
      const camX = uiCam.x;
      const camY = uiCam.y;
      const sx = target.x - camX;
      const sy = target.y - camY;
      if (sx < 60 || sx > viewW - 60 || sy < 60 || sy > viewH - 60) {
        const cx = Math.max(50, Math.min(viewW - 50, sx));
        const cy = Math.max(90, Math.min(viewH - 90, sy));
        const angle = Math.atan2(sy - cy, sx - cx);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angle);
        ctx.fillStyle = '#f2c230';
        ctx.beginPath();
        ctx.moveTo(16, 0);
        ctx.lineTo(-10, -11);
        ctx.lineTo(-10, 11);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
  }

  function drawPanel(title, lines, prompt, accent) {
    ctx.fillStyle = '#0d1117b8';
    ctx.fillRect(0, 0, viewW, viewH);
    const width = 640;
    const height = 150 + lines.length * 34 + 70;
    const x = (viewW - width) / 2;
    const y = (viewH - height) / 2;
    ctx.fillStyle = '#171d26f2';
    roundRect(ctx, x, y, width, height, 14);
    ctx.fill();
    ctx.strokeStyle = accent || '#f2c230';
    ctx.lineWidth = 3;
    roundRect(ctx, x, y, width, height, 14);
    ctx.stroke();
    text(title, viewW / 2, y + 82, 52, '#ffffff', 'center', 800);
    for (let i = 0; i < lines.length; i += 1) {
      text(lines[i], viewW / 2, y + 132 + i * 34, 19, '#c3c9d4', 'center', 400);
    }
    text(prompt, viewW / 2, y + height - 34, 20, '#f2c230', 'center', 600);
  }

  /** Paint one frame. `ui` carries the screen, the camera's top-left corner in world px, and the clock. */
  function paint(world, ui) {
    if (window.innerWidth !== viewW || window.innerHeight !== viewH) resize();
    const { screen, camX, camY, time } = ui;
    uiCam.x = camX;
    uiCam.y = camY;
    ctx.fillStyle = '#10151c';
    ctx.fillRect(0, 0, viewW, viewH);
    ctx.save();
    ctx.translate(-camX, -camY);
    drawWorld(world, camX, camY, time);
    ctx.restore();
    if (screen === SCREEN_TITLE) {
      const lines = [
        'A sun-soaked city, a stolen car, three jobs — and the whole Solmar Bay police force.',
        'WASD / arrows — move and drive · Shift — run · Space — punch',
        'E — steal or leave a car · P — pause · Your progress saves itself.',
      ];
      if (ui.saveInfo) lines.push(ui.saveInfo);
      drawPanel('SOLMAR BAY', lines, 'Press Enter or click to play', '#f2c230');
      return;
    }
    drawHud(world, time);
    if (screen === SCREEN_PAUSED) {
      drawPanel('Paused', ['The city waits for you. Your progress is saved.'], 'Press P to resume', '#8b93a3');
    } else if (screen === SCREEN_BUSTED) {
      drawPanel('BUSTED', [
        `The Solmar Bay police caught you on foot and took $${world.lastFine || 100}.`,
        `Cash: $${world.cash.toLocaleString('en-US')} · the jobs are still waiting.`,
      ], 'Press Enter to walk free', '#ff4040');
    }
  }

  resize();
  window.addEventListener('resize', resize);
  return { paint };
}
