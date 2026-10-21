import * as THREE from 'three';

import type { TableGeometry, TableParams } from '../config';

/**
 * 判定带上的“引导网”。
 *
 * 和 editor 的 3D 编辑网格一样，是一面竖在 bandZ 上的网格；默认完全透明。
 * 地面 hit 接近时，只在它附近的网格上点亮一小块，并随时钟平滑增强。
 * 时间阈值：180ms 内开始，perfect ±80ms 最亮；更远完全不亮。
 *
 * 网格不是贴花：没有半透明底板，只有局部软化的线条 / 冷光 / perfect 暖黄核心。
 */

export interface GuideHit {
  x: number;
  y: number;
  time: number;
}

export interface JudgementGuide {
  group: THREE.Group;
  update(clockMs: number, windowValue: number, hits: GuideHit[]): void;
  clear(): void;
  dispose(): void;
}

const TEXTURE_W = 512;
const TEXTURE_H = 420;
const CELL_X = 32;
const CELL_Y = 22;
const PATCH_RX = 84;
const PATCH_RY = 52;
const GUIDE_HEIGHT = 0.9;
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
  const planeGeometry = new THREE.PlaneGeometry(width, GUIDE_HEIGHT);
  const mesh = new THREE.Mesh(planeGeometry, material);
  mesh.name = 'judgement-guide';
  mesh.renderOrder = 4;
  // 底边略低于台面，让 hit 的 y=0.07 落在网格内部而不是贴着裁切线。
  mesh.position.set(0, params.tableHeight - 0.08 + GUIDE_HEIGHT / 2, geometry.bandZ);
  // 不能让 editor 的 3D 拾取把这块透明引导网当成 note。
  mesh.raycast = () => {};

  const group = new THREE.Group();
  group.name = 'judgement-guide';
  group.add(mesh);
  group.visible = false;

  function drawPatch(px: number, py: number, intensity: number): void {
    // 软边：不裁椭圆，只画一块渐变消失的网格；alpha 整体压低，避免变成发光的板子。
    ctx.globalCompositeOperation = 'lighter';

    const x0 = Math.floor((px - PATCH_RX) / CELL_X) * CELL_X;
    const x1 = px + PATCH_RX;
    for (let x = x0; x <= x1; x += CELL_X) {
      const falloff = Math.max(0, 1 - Math.abs(x - px) / PATCH_RX);
      const alpha = intensity * falloff * falloff * 0.34;
      if (alpha < 0.008) continue;
      const major = Math.abs(x / CELL_X - Math.round(x / CELL_X)) < 1e-6 && Math.round(x / CELL_X) % 4 === 0;
      const grad = ctx.createLinearGradient(0, py - PATCH_RY, 0, py + PATCH_RY);
      grad.addColorStop(0, 'rgba(154, 212, 255, 0)');
      grad.addColorStop(0.22, `rgba(154, 212, 255, ${alpha * (major ? 1.25 : 0.85)})`);
      grad.addColorStop(0.78, `rgba(154, 212, 255, ${alpha * (major ? 1.25 : 0.85)})`);
      grad.addColorStop(1, 'rgba(154, 212, 255, 0)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, py - PATCH_RY);
      ctx.lineTo(x, py + PATCH_RY);
      ctx.stroke();
    }

    const y0 = Math.floor((py - PATCH_RY) / CELL_Y) * CELL_Y;
    const y1 = py + PATCH_RY;
    for (let y = y0; y <= y1; y += CELL_Y) {
      const falloff = Math.max(0, 1 - Math.abs(y - py) / PATCH_RY);
      const alpha = intensity * falloff * falloff * 0.3;
      if (alpha < 0.008) continue;
      const major = Math.abs(y / CELL_Y - Math.round(y / CELL_Y)) < 1e-6 && Math.round(y / CELL_Y) % 4 === 0;
      const grad = ctx.createLinearGradient(px - PATCH_RX, 0, px + PATCH_RX, 0);
      grad.addColorStop(0, 'rgba(154, 212, 255, 0)');
      grad.addColorStop(0.22, `rgba(154, 212, 255, ${alpha * (major ? 1.25 : 0.85)})`);
      grad.addColorStop(0.78, `rgba(154, 212, 255, ${alpha * (major ? 1.25 : 0.85)})`);
      grad.addColorStop(1, 'rgba(154, 212, 255, 0)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px - PATCH_RX, y);
      ctx.lineTo(px + PATCH_RX, y);
      ctx.stroke();
    }

    const glow = ctx.createRadialGradient(px, py, 0, px, py, PATCH_RX);
    glow.addColorStop(0, `rgba(112, 184, 255, ${0.1 + intensity * 0.14})`);
    glow.addColorStop(0.55, `rgba(80, 148, 225, ${0.035 + intensity * 0.07})`);
    glow.addColorStop(1, 'rgba(60, 120, 200, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(px - PATCH_RX, py - PATCH_RY, PATCH_RX * 2, PATCH_RY * 2);

    if (intensity > 0.65) {
      const core = (intensity - 0.65) / 0.35;
      const warm = ctx.createRadialGradient(px, py, 0, px, py, 28);
      warm.addColorStop(0, `rgba(255, 228, 138, ${0.5 * core})`);
      warm.addColorStop(0.45, `rgba(255, 201, 94, ${0.2 * core})`);
      warm.addColorStop(1, 'rgba(255, 180, 70, 0)');
      ctx.fillStyle = warm;
      ctx.fillRect(px - 30, py - 30, 60, 60);
    }

    ctx.globalCompositeOperation = 'source-over';
  }

  function clear(): void {
    if (!group.visible) return;
    ctx.clearRect(0, 0, TEXTURE_W, TEXTURE_H);
    texture.needsUpdate = true;
    group.visible = false;
  }

  function update(clockMs: number, windowValue: number, hits: GuideHit[]): void {
    group.position.x = windowValue * geometry.laneWidth;

    const lit: Array<{ px: number; py: number; intensity: number }> = [];
    const windowCenter = windowValue * geometry.laneWidth;
    const windowWidth = geometry.laneWidth * 4;
    const bottom = params.tableHeight - 0.08;
    for (const hit of hits) {
      const delta = Math.abs(clockMs - hit.time);
      if (delta > GUIDE_START_MS) continue;
      const intensity = 1 - smoothstep(GUIDE_FULL_MS, GUIDE_START_MS, delta);
      if (intensity <= 0.01) continue;
      const u = (hit.x - windowCenter) / windowWidth + 0.5;
      const v = (hit.y - bottom) / GUIDE_HEIGHT;
      if (u < -0.08 || u > 1.08 || v < -0.02 || v > 1.02) continue;
      lit.push({ px: u * TEXTURE_W, py: (1 - v) * TEXTURE_H, intensity });
    }

    if (lit.length === 0) {
      clear();
      return;
    }

    group.visible = true;
    ctx.clearRect(0, 0, TEXTURE_W, TEXTURE_H);
    for (const item of lit) drawPatch(item.px, item.py, item.intensity);
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
