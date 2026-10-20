import * as THREE from 'three';

import type { HandSample } from '../game/hands';

/**
 * 可被激光 / 手戳点击的世界空间面板。
 *
 * 这个版本不再提供固定的「标题 + 行 + 按钮」布局；每个界面自己画内容，
 * 并返回可点击的矩形（hotspot）。这样 Home / Songs / Pause 可以是完全不同的版式，
 * 而不是同一张列表换数据。
 *
 * 外观只负责底板：石墨表面 + 1px 边线，**没有圆角、没有拟物装饰**。
 */

export interface PanelHotspot {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PanelDrawState {
  hovered: string | null;
  width: number;
  height: number;
}

export type PanelDraw = (ctx: CanvasRenderingContext2D, state: PanelDrawState) => PanelHotspot[];

export interface PanelPointer {
  point: THREE.Vector3;
  distance: number;
  hand: HandSample;
  ray: boolean;
}

export interface PanelUpdate {
  hovered: string | null;
  clicked: string | null;
  pointer: PanelPointer | null;
}

export interface VrPanel {
  group: THREE.Group;
  readonly visible: boolean;
  setScreen(draw: PanelDraw): void;
  redraw(): void;
  setVisible(visible: boolean): void;
  aimAt(target: THREE.Vector3): void;
  update(hands: HandSample[]): PanelUpdate;
  dispose(): void;
}

export interface PanelOptions {
  width: number;
  height: number;
  canvasWidth?: number;
  canvasHeight?: number;
  /** 面板前表面到这个距离以内算「手在面板上」。 */
  touchDepth?: number;
  /** 盖在一切之上（模态面板）。 */
  onTop?: boolean;
  opacity?: number;
}

const SUPERSAMPLE = 2;
const MAX_RAY_DISTANCE = 6;

export function createVrPanel(options: PanelOptions): VrPanel {
  const width = options.width;
  const height = options.height;
  const logicalW = options.canvasWidth ?? 760;
  const logicalH = options.canvasHeight ?? 470;
  const cw = Math.round(logicalW * SUPERSAMPLE);
  const ch = Math.round(logicalH * SUPERSAMPLE);
  const touchDepth = options.touchDepth ?? 0.12;
  const onTop = options.onTop ?? true;

  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D canvas context unavailable');
  const ctx: CanvasRenderingContext2D = context;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: !onTop,
    toneMapped: false,
    side: THREE.FrontSide,
  });

  const group = new THREE.Group();
  group.visible = false;

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.renderOrder = onTop ? 30 : 20;
  group.add(mesh);

  let drawScreen: PanelDraw = () => [];
  let hotspots: PanelHotspot[] = [];
  let hovered: string | null = null;
  let opacity = options.opacity ?? 1;
  let lastHoverSignature = '';

  const pressState = new WeakMap<HandSample, boolean>();

  function pxToLocalX(px: number): number {
    return (px / logicalW - 0.5) * width;
  }
  function pxToLocalY(py: number): number {
    return (0.5 - py / logicalH) * height;
  }

  function draw(): void {
    ctx.setTransform(SUPERSAMPLE, 0, 0, SUPERSAMPLE, 0, 0);
    ctx.clearRect(0, 0, logicalW, logicalH);

    // 底板：方角、细边线、石墨渐变；不画阴影 / 圆角 / 高光边。
    const bg = ctx.createLinearGradient(0, 0, 0, logicalH);
    bg.addColorStop(0, '#151B23');
    bg.addColorStop(1, '#0E1319');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, logicalW, logicalH);
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, logicalW - 1, logicalH - 1);

    hotspots = drawScreen(ctx, { hovered, width: logicalW, height: logicalH });
    texture.needsUpdate = true;
  }

  function hotspotAt(localX: number, localY: number): string | null {
    for (const spot of hotspots) {
      const x0 = pxToLocalX(spot.x);
      const x1 = pxToLocalX(spot.x + spot.w);
      const y0 = pxToLocalY(spot.y + spot.h);
      const y1 = pxToLocalY(spot.y);
      if (localX >= x0 && localX <= x1 && localY >= y0 && localY <= y1) return spot.id;
    }
    return null;
  }

  const inverseMatrix = new THREE.Matrix4();
  const localRay = new THREE.Ray();
  const localPoint = new THREE.Vector3();
  const worldPoint = new THREE.Vector3();

  interface Hit {
    localX: number;
    localY: number;
    distance: number;
    ray: boolean;
  }

  function rayHit(hand: HandSample): Hit | null {
    if (!hand.active || !hand.ray) return null;
    localRay.copy(hand.ray).applyMatrix4(inverseMatrix);
    if (Math.abs(localRay.direction.z) < 1e-4) return null;
    const t = -localRay.origin.z / localRay.direction.z;
    if (t <= 0.02 || t > MAX_RAY_DISTANCE) return null;
    localPoint.copy(localRay.origin).addScaledVector(localRay.direction, t);
    if (Math.abs(localPoint.x) > width / 2 || Math.abs(localPoint.y) > height / 2) return null;
    return { localX: localPoint.x, localY: localPoint.y, distance: t, ray: true };
  }

  function touchHit(hand: HandSample): Hit | null {
    if (!hand.active) return null;
    localPoint.copy(hand.position);
    group.worldToLocal(localPoint);
    const inside =
      Math.abs(localPoint.x) <= width / 2 &&
      Math.abs(localPoint.y) <= height / 2 &&
      localPoint.z >= -touchDepth &&
      localPoint.z <= 0.06;
    if (!inside) return null;
    return { localX: localPoint.x, localY: localPoint.y, distance: 0, ray: false };
  }

  function update(hands: HandSample[]): PanelUpdate {
    if (!group.visible) return { hovered: null, clicked: null, pointer: null };
    group.updateMatrixWorld(true);
    inverseMatrix.copy(group.matrixWorld).invert();

    let best: { id: string; hit: Hit; hand: HandSample } | null = null;
    let nearest: { hit: Hit; hand: HandSample } | null = null;
    let clicked: string | null = null;

    for (const hand of hands) {
      const hit = rayHit(hand) ?? touchHit(hand);
      if (!hit) {
        pressState.set(hand, hand.pressed);
        continue;
      }

      const id = hotspotAt(hit.localX, hit.localY);
      if (id && (!best || hit.distance < best.hit.distance)) best = { id, hit, hand };
      if (!nearest || hit.distance < nearest.hit.distance) nearest = { hit, hand };

      const wasPressed = pressState.get(hand) ?? false;
      if (hit.ray && hand.pressed && !wasPressed && id && !clicked) clicked = id;
      pressState.set(hand, hand.pressed);
    }

    const nextHover = best?.id ?? null;
    if (nextHover !== hovered) {
      hovered = nextHover;
      lastHoverSignature = nextHover ?? '-';
      draw();
    } else if (lastHoverSignature !== (nextHover ?? '-')) {
      lastHoverSignature = nextHover ?? '-';
    }

    let pointer: PanelPointer | null = null;
    if (nearest) {
      if (nearest.hit.ray) {
        worldPoint.set(nearest.hit.localX, nearest.hit.localY, 0).applyMatrix4(group.matrixWorld);
      } else {
        worldPoint.copy(nearest.hand.position);
      }
      pointer = {
        point: worldPoint.clone(),
        distance: nearest.hit.ray ? nearest.hit.distance : 0,
        hand: nearest.hand,
        ray: nearest.hit.ray,
      };
    }

    return { hovered: nextHover, clicked, pointer };
  }

  material.opacity = opacity;
  draw();

  return {
    group,
    get visible(): boolean {
      return group.visible;
    },
    setScreen(next: PanelDraw): void {
      drawScreen = next;
      hovered = null;
      lastHoverSignature = '';
      draw();
    },
    redraw(): void {
      draw();
    },
    setVisible(visible: boolean): void {
      group.visible = visible;
    },
    aimAt(target: THREE.Vector3): void {
      group.rotation.y = Math.atan2(target.x - group.position.x, target.z - group.position.z);
    },
    update,
    dispose(): void {
      mesh.geometry.dispose();
      material.dispose();
      texture.dispose();
      group.clear();
    },
  };
}
