import * as THREE from 'three';

import type { TableGeometry, TableParams } from '../config';

/**
 * 判定带上的“引导网”。
 *
 * 和 editor 的 3D 编辑网格一样，是一面竖在 bandZ 上的网格；默认完全透明。
 * 地面 hit 接近时，在它附近点亮一片较大的网格，并随时钟平滑增强。
 * 时间阈值：320ms 内开始；perfect 的 early -100ms / late +80ms 内最亮；更远完全不亮。
 *
 * 网格不是贴花：没有半透明底板，只有局部软化的线条 / 冷光 / perfect 暖黄核心。
 */

export interface GuideHit {
  x: number;
  y: number;
  time: number;
  /** 这颗 hit 是否已经在 perfect 窗口内（只有它为真时才点亮暖黄）。 */
  perfect: boolean;
}

export interface JudgementGuide {
  group: THREE.Group;
  update(clockMs: number, windowValue: number, hits: GuideHit[]): void;
  clear(): void;
  dispose(): void;
}

const TEXTURE_W = 512;
const TEXTURE_H = 420;
const PATCH_RX = 190;
const PATCH_RY = 128;
const GUIDE_HEIGHT = 0.9;
/** 网格和编辑器 3D 网格对齐：竖线 1/4 轨一条，横线 5cm 一条。 */
const LANE_STEP = 0.25;
const HEIGHT_STEP = 0.05;
const BOTTOM_OFFSET = 0.08;
const LEVELS = [0, 0.33, 0.61, 0.81];
const CELL_Y_FOR_WARM = (HEIGHT_STEP / GUIDE_HEIGHT) * TEXTURE_H;
export const GUIDE_START_MS = 320;
const GUIDE_FULL_EARLY_MS = 100;
const GUIDE_FULL_LATE_MS = 80;

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

  function lineColor(alpha: number, warm: number): string {
    const r = Math.round(154 + (255 - 154) * warm);
    const g = Math.round(212 + (228 - 212) * warm);
    const b = Math.round(255 + (138 - 255) * warm);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  /** 世界坐标 → 贴图像素（贴图贴在随窗口滑动的平面上）。 */
  function laneToPx(lane: number, planeCenterX: number): number {
    const width = geometry.laneWidth * 4 * 0.98;
    const worldX = (lane - 2.5) * geometry.laneWidth;
    return ((worldX - (planeCenterX - width / 2)) / width) * TEXTURE_W;
  }

  /** 台面上方高度（米） → 贴图像素。 */
  function heightToPy(height: number): number {
    return (1 - (height + BOTTOM_OFFSET) / GUIDE_HEIGHT) * TEXTURE_H;
  }

  function drawPatch(
    px: number,
    py: number,
    intensity: number,
    perfect: boolean,
    planeCenterX: number,
  ): void {
    // 只照亮网格线，不画底板 / 光晕；线的两端和两侧都由渐变淡出。
    ctx.globalCompositeOperation = 'lighter';
    const laneGapPx = (geometry.laneWidth * LANE_STEP * TEXTURE_W) / (geometry.laneWidth * 4 * 0.98);

    // 竖线：位置和编辑器 3D 网格完全一致（1/4 轨一条，整轨加亮）。
    for (let lane = -0.5; lane <= 5.5001; lane += LANE_STEP) {
      const x = laneToPx(lane, planeCenterX);
      if (x < px - PATCH_RX || x > px + PATCH_RX) continue;
      if (x < -4 || x > TEXTURE_W + 4) continue;
      const falloff = Math.max(0, 1 - Math.abs(x - px) / PATCH_RX);
      const alpha = intensity * falloff * falloff * 0.7;
      if (alpha < 0.008) continue;
      const major = Math.abs(lane - Math.round(lane)) < 1e-6;
      const warm = perfect ? Math.max(0, 1 - Math.abs(x - px) / (laneGapPx * 2.2)) : 0;
      const grad = ctx.createLinearGradient(0, py - PATCH_RY, 0, py + PATCH_RY);
      grad.addColorStop(0, lineColor(0, warm));
      grad.addColorStop(0.22, lineColor(alpha * (major ? 1.2 : 0.82), warm));
      grad.addColorStop(0.78, lineColor(alpha * (major ? 1.2 : 0.82), warm));
      grad.addColorStop(1, lineColor(0, warm));
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, py - PATCH_RY);
      ctx.lineTo(x, py + PATCH_RY);
      ctx.stroke();
    }

    // 横线：5cm 一条；10cm / 胸 / 面 / 头顶加亮。
    for (let height = 0; height <= GUIDE_HEIGHT - BOTTOM_OFFSET + 1e-6; height += HEIGHT_STEP) {
      const y = heightToPy(height);
      if (y < py - PATCH_RY || y > py + PATCH_RY) continue;
      if (y < -4 || y > TEXTURE_H + 4) continue;
      const falloff = Math.max(0, 1 - Math.abs(y - py) / PATCH_RY);
      const alpha = intensity * falloff * falloff * 0.56;
      if (alpha < 0.008) continue;
      const major =
        LEVELS.some((level) => Math.abs(level - height) < 1e-6) ||
        Math.abs(height / 0.1 - Math.round(height / 0.1)) < 1e-6;
      const warm = perfect ? Math.max(0, 1 - Math.abs(y - py) / (CELL_Y_FOR_WARM * 2.2)) : 0;
      const grad = ctx.createLinearGradient(px - PATCH_RX, 0, px + PATCH_RX, 0);
      grad.addColorStop(0, lineColor(0, warm));
      grad.addColorStop(0.22, lineColor(alpha * (major ? 1.2 : 0.82), warm));
      grad.addColorStop(0.78, lineColor(alpha * (major ? 1.2 : 0.82), warm));
      grad.addColorStop(1, lineColor(0, warm));
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px - PATCH_RX, y);
      ctx.lineTo(px + PATCH_RX, y);
      ctx.stroke();
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

    const lit: Array<{ px: number; py: number; intensity: number; perfect: boolean }> = [];
    const windowCenter = windowValue * geometry.laneWidth;
    const windowWidth = geometry.laneWidth * 4;
    const bottom = params.tableHeight - 0.08;
    for (const hit of hits) {
      const offset = clockMs - hit.time;
      const delta = Math.abs(offset);
      if (delta > GUIDE_START_MS) continue;
      const fullWindow = offset < 0 ? GUIDE_FULL_EARLY_MS : GUIDE_FULL_LATE_MS;
      const raw = 1 - smoothstep(fullWindow, GUIDE_START_MS, delta);
      // 0.6 次幂让远处也先浮起来，而不是等到最后 100ms 才突然出现。
      const intensity = raw <= 0 ? 0 : Math.pow(raw, 0.6);
      if (intensity <= 0.01) continue;
      const u = (hit.x - windowCenter) / windowWidth + 0.5;
      const v = (hit.y - bottom) / GUIDE_HEIGHT;
      if (u < -0.08 || u > 1.08 || v < -0.02 || v > 1.02) continue;
      lit.push({ px: u * TEXTURE_W, py: (1 - v) * TEXTURE_H, intensity, perfect: hit.perfect });
    }

    if (lit.length === 0) {
      clear();
      return;
    }

    group.visible = true;
    ctx.clearRect(0, 0, TEXTURE_W, TEXTURE_H);
    for (const item of lit) drawPatch(item.px, item.py, item.intensity, item.perfect, group.position.x);
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
