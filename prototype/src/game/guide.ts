import * as THREE from 'three';

import type { TableGeometry, TableParams } from '../config';

/**
 * 判定带上的“引导网”。
 *
 * 默认完全透明；只有即将到达判定带的地面 hit 会在附近点亮一小块网格。
 * 亮度按时间而不是距离计算：进入 perfect 窗口（±80ms）时最亮，中心带一点暖黄，
 * 超过 180ms 就完全熄灭，避免 note 还很远时整条判定带就在发光。
 *
 * 图层是一个贴近台面的横置平面，纹理每帧重画一小块椭圆网格；没有常驻亮线。
 */

export interface GuideHit {
  x: number;
  time: number;
}

export interface JudgementGuide {
  group: THREE.Group;
  update(clockMs: number, windowValue: number, hits: GuideHit[]): void;
  clear(): void;
  dispose(): void;
}

const TEXTURE_W = 512;
const TEXTURE_H = 160;
const CELL_X = 32;
const CELL_Y = 20;
const PATCH_RX = 78;
const PATCH_RY = 48;
const GUIDE_START_MS = 180;
const GUIDE_FULL_MS = 80;

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function createJudgementGuide(params: TableParams, geometry: TableGeometry): JudgementGuide {
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_W;
  canvas.height = TEXTURE_H;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D canvas context unavailable');
  const ctx: CanvasRenderingContext2D = context;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });

  const width = geometry.laneWidth * 4 * 0.98;
  const depth = 0.34;
  const planeGeometry = new THREE.PlaneGeometry(width, depth);
  planeGeometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(planeGeometry, material);
  mesh.name = 'judgement-guide';
  mesh.renderOrder = 4;
  mesh.position.set(0, params.tableHeight + 0.0014, geometry.bandZ);
  // 不能让 editor 的 3D 拾取把这块透明引导网当成 note。
  mesh.raycast = () => {};

  const group = new THREE.Group();
  group.name = 'judgement-guide';
  group.add(mesh);
  group.visible = false;

  function drawPatch(px: number, intensity: number): void {
    const cy = TEXTURE_H / 2;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(px, cy, PATCH_RX, PATCH_RY, 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.globalCompositeOperation = 'lighter';

    // 网格线：只在椭圆内出现；亮度跟着时间 ramp 走。
    ctx.globalAlpha = 0.18 + intensity * 0.55;
    ctx.strokeStyle = 'rgba(158, 214, 255, 0.8)';
    ctx.lineWidth = 1;
    const x0 = Math.floor((px - PATCH_RX) / CELL_X) * CELL_X;
    const x1 = px + PATCH_RX;
    for (let x = x0; x <= x1; x += CELL_X) {
      ctx.beginPath();
      ctx.moveTo(x, cy - PATCH_RY);
      ctx.lineTo(x, cy + PATCH_RY);
      ctx.stroke();
    }
    const y0 = Math.floor((cy - PATCH_RY) / CELL_Y) * CELL_Y;
    const y1 = cy + PATCH_RY;
    for (let y = y0; y <= y1; y += CELL_Y) {
      ctx.beginPath();
      ctx.moveTo(px - PATCH_RX, y);
      ctx.lineTo(px + PATCH_RX, y);
      ctx.stroke();
    }

    // 冷色底光：让网格不是悬空的线。
    const glow = ctx.createRadialGradient(px, cy, 0, px, cy, PATCH_RX);
    glow.addColorStop(0, `rgba(118, 190, 255, ${0.16 + intensity * 0.22})`);
    glow.addColorStop(0.55, `rgba(80, 150, 230, ${0.06 + intensity * 0.12})`);
    glow.addColorStop(1, 'rgba(60, 120, 200, 0)');
    ctx.globalAlpha = 1;
    ctx.fillStyle = glow;
    ctx.fillRect(px - PATCH_RX, cy - PATCH_RY, PATCH_RX * 2, PATCH_RY * 2);

    // perfect 窗口附近，中心泛暖黄；不亮的时候不画。
    if (intensity > 0.65) {
      const core = (intensity - 0.65) / 0.35;
      const warm = ctx.createRadialGradient(px, cy, 0, px, cy, 26);
      warm.addColorStop(0, `rgba(255, 224, 122, ${0.62 * core})`);
      warm.addColorStop(0.45, `rgba(255, 198, 90, ${0.24 * core})`);
      warm.addColorStop(1, 'rgba(255, 180, 70, 0)');
      ctx.fillStyle = warm;
      ctx.fillRect(px - 30, cy - 30, 60, 60);
    }

    ctx.restore();
  }

  function clear(): void {
    if (!group.visible) return;
    ctx.clearRect(0, 0, TEXTURE_W, TEXTURE_H);
    texture.needsUpdate = true;
    group.visible = false;
  }

  function update(clockMs: number, windowValue: number, hits: GuideHit[]): void {
    group.position.x = windowValue * geometry.laneWidth;

    const lit: Array<{ px: number; intensity: number }> = [];
    const windowCenter = windowValue * geometry.laneWidth;
    const windowWidth = geometry.laneWidth * 4;
    for (const hit of hits) {
      const delta = Math.abs(clockMs - hit.time);
      if (delta > GUIDE_START_MS) continue;
      const intensity = 1 - smoothstep(GUIDE_FULL_MS, GUIDE_START_MS, delta);
      if (intensity <= 0.01) continue;
      const u = (hit.x - windowCenter) / windowWidth + 0.5;
      if (u < -0.08 || u > 1.08) continue;
      lit.push({ px: u * TEXTURE_W, intensity });
    }

    if (lit.length === 0) {
      clear();
      return;
    }

    group.visible = true;
    ctx.clearRect(0, 0, TEXTURE_W, TEXTURE_H);
    for (const item of lit) drawPatch(item.px, item.intensity);
    texture.needsUpdate = true;
  }

  return {
    group,
    update,
    clear,
    dispose(): void {
      planeGeometry.dispose();
      material.dispose();
      texture.dispose();
      group.clear();
    },
  };
}
