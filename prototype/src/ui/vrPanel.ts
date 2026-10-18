import * as THREE from 'three';

import type { HandSample } from '../game/hands';
import { createGlowTexture } from '../materials/textures';

/**
 * 可以被「指」也可以被「戳」的 3D 面板：canvas 贴图 + 平面 + 按钮矩形。
 *
 * 交互有两条路，任何一条都算数：
 * 1. **激光笔**：控制器的 target-ray 打中面板，扳机 = 点击（VR 里主要用它）；
 * 2. **手戳**：手伸到面板前面、落在按钮矩形里，扳机 = 点击（近身时更自然）。
 *
 * 面板只绕 Y 轴朝向玩家（和浮空显示一样），所以局部坐标很好算。
 * 外观走「仪器面板」：暗玻璃 + 一点黄铜 + 极细的边框与刻度，
 * 不用图片资产，全部是 canvas 画出来的。
 */

export interface PanelButton {
  id: string;
  label: string;
  /** canvas 逻辑像素坐标。 */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 视觉权重：主按钮更亮。 */
  tone?: 'default' | 'primary' | 'quiet';
}

/** 一行「标签 …… 值」：标签靠左、值靠右，读起来像仪表读数。 */
export interface PanelRow {
  label: string;
  value: string;
}

export interface PanelPointer {
  /** 世界坐标（射线命中点 / 手的位置）。 */
  point: THREE.Vector3;
  /** 从控制器到命中点的距离（米）。 */
  distance: number;
  hand: HandSample;
  /** 来自激光笔（false = 手戳）。 */
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
  setTitle(title: string): void;
  setLines(lines: string[]): void;
  setRows(rows: PanelRow[]): void;
  /** 数值列的右对齐位置（canvas 逻辑 x）。不设则贴右边缘。 */
  setValueColumn(x: number | null): void;
  /** 标题右侧的结论标记（CLEAR / FAILED / 状态）。 */
  setBadge(text: string, tone?: 'good' | 'bad' | 'none'): void;
  /** 按钮上方的一行小字。 */
  setFooter(text: string): void;
  setButtons(buttons: PanelButton[]): void;
  setVisible(visible: boolean): void;
  /** 整块面板的半透明（播放中把常驻条压暗一点）。 */
  setOpacity(value: number): void;
  aimAt(target: THREE.Vector3): void;
  /** 处理交互；返回这一帧的悬停 / 点击。 */
  update(hands: HandSample[]): PanelUpdate;
  dispose(): void;
}

export interface PanelOptions {
  width: number;
  height: number;
  /** 逻辑画布尺寸；实际画布会再乘 supersample。 */
  canvasWidth?: number;
  canvasHeight?: number;
  title?: string;
  /** 面板前表面到这个距离以内算「手在面板上」。 */
  touchDepth?: number;
  /** 盖在一切之上（模态面板）。 */
  onTop?: boolean;
  /** 常驻透明度。 */
  opacity?: number;
}

const SUPERSAMPLE = 1.5;
/** 激光笔的最远命中距离（米）。 */
const MAX_RAY_DISTANCE = 6;
/** 点击后按钮高亮的时长（毫秒）。 */
const FLASH_MS = 130;

const INK = {
  text: '#e9f2fa',
  dim: '#8ea3b8',
  faint: 'rgba(142,163,184,0.45)',
  brass: 'rgba(176,141,87,0.75)',
  accent: 'rgba(126,206,236,0.9)',
};

const FONT =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/** 带字距的文本：canvas 的 letterSpacing 支持还不齐，手动画更稳。 */
function spaced(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  spacing: number,
  align: 'left' | 'right' | 'center' = 'left',
): void {
  let total = 0;
  for (const char of text) total += ctx.measureText(char).width + spacing;
  total = Math.max(0, total - spacing);
  let cursor = align === 'right' ? x - total : align === 'center' ? x - total / 2 : x;
  for (const char of text) {
    ctx.fillText(char, cursor, y);
    cursor += ctx.measureText(char).width + spacing;
  }
}

export function createVrPanel(options: PanelOptions): VrPanel {
  const width = options.width;
  const height = options.height;
  const logicalW = options.canvasWidth ?? 640;
  const logicalH = options.canvasHeight ?? 480;
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

  // 面板背后的一层柔光：让它看起来是「亮着」的，而不是一块贴纸。
  const haloTexture = createGlowTexture(128);
  const haloMaterial = new THREE.MeshBasicMaterial({
    map: haloTexture,
    color: 0x2f6f8c,
    transparent: true,
    opacity: 0.22,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: !onTop,
    toneMapped: false,
  });
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(width * 1.5, height * 2.2), haloMaterial);
  halo.position.z = -0.004;
  halo.renderOrder = mesh.renderOrder - 1;
  group.add(halo);

  let title = options.title ?? '';
  let lines: string[] = [];
  let rows: PanelRow[] = [];
  let valueColumn: number | null = null;
  let badge: { text: string; tone: 'good' | 'bad' | 'none' } | null = null;
  let footer = '';
  let buttons: PanelButton[] = [];
  let hovered: string | null = null;
  let flashId: string | null = null;
  let flashUntil = 0;
  let opacity = options.opacity ?? 1;
  let lastHoverSignature = '';

  const pressState = new WeakMap<HandSample, boolean>();

  function pxToLocalX(px: number): number {
    return (px / logicalW - 0.5) * width;
  }
  function pxToLocalY(py: number): number {
    return (0.5 - py / logicalH) * height;
  }
  // —— 绘制 ——
  function draw(): void {
    ctx.setTransform(SUPERSAMPLE, 0, 0, SUPERSAMPLE, 0, 0);
    ctx.clearRect(0, 0, logicalW, logicalH);

    const pad = 10;
    const radius = 26;

    // 背板：上亮下暗的玻璃，加一层外阴影把面板「托」起来。
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = 26;
    ctx.shadowOffsetY = 6;
    const backdrop = ctx.createLinearGradient(0, pad, 0, logicalH - pad);
    backdrop.addColorStop(0, 'rgba(17, 25, 34, 0.94)');
    backdrop.addColorStop(0.55, 'rgba(11, 16, 23, 0.94)');
    backdrop.addColorStop(1, 'rgba(7, 10, 15, 0.96)');
    ctx.fillStyle = backdrop;
    rounded(ctx, pad, pad, logicalW - pad * 2, logicalH - pad * 2, radius);
    ctx.fill();
    ctx.restore();

    // 顶边高光 + 边框：一条渐变，越往下越暗。
    const rim = ctx.createLinearGradient(0, pad, 0, logicalH - pad);
    rim.addColorStop(0, 'rgba(168, 204, 232, 0.55)');
    rim.addColorStop(0.35, 'rgba(120, 150, 178, 0.22)');
    rim.addColorStop(1, 'rgba(90, 112, 136, 0.12)');
    ctx.strokeStyle = rim;
    ctx.lineWidth = 1.6;
    rounded(ctx, pad, pad, logicalW - pad * 2, logicalH - pad * 2, radius);
    ctx.stroke();

    // 四角刻度：仪器感，不要边框。
    ctx.strokeStyle = 'rgba(150, 185, 214, 0.4)';
    ctx.lineWidth = 2;
    const tick = 14;
    const inset = pad + 12;
    const corners: Array<[number, number, number, number]> = [
      [inset, inset, 1, 1],
      [logicalW - inset, inset, -1, 1],
      [inset, logicalH - inset, 1, -1],
      [logicalW - inset, logicalH - inset, -1, -1],
    ];
    for (const [x, y, sx, sy] of corners) {
      ctx.beginPath();
      ctx.moveTo(x + sx * tick, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + sy * tick);
      ctx.stroke();
    }

    // 标题 + 黄铜细线 + 右上角的水印。
    let contentTop = 54;
    if (title) {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = INK.text;
      ctx.font = `600 34px ${FONT}`;
      spaced(ctx, title.toUpperCase(), 36, 62, 3);

      ctx.fillStyle = INK.brass;
      ctx.fillRect(36, 78, 96, 2);
      contentTop = 118;
    }

    if (badge) {
      const tone =
        badge.tone === 'good'
          ? 'rgba(122, 226, 214, 0.95)'
          : badge.tone === 'bad'
            ? 'rgba(238, 126, 126, 0.95)'
            : 'rgba(150, 170, 190, 0.85)';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'alphabetic';
      ctx.font = `700 20px ${FONT}`;
      ctx.fillStyle = tone;
      spaced(ctx, badge.text.toUpperCase(), logicalW - 36, 60, 2.5, 'right');
    } else {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.font = `600 16px ${FONT}`;
      ctx.fillStyle = 'rgba(126, 206, 236, 0.32)';
      spaced(ctx, 'PARALLAX', logicalW - 36, 52, 4, 'right');
    }

    // 读数行：标签左、值右，中间一层极淡的引导点。
    ctx.textBaseline = 'middle';
    let y = contentTop + 4;
    for (const row of rows) {
      ctx.font = `500 22px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.fillStyle = INK.dim;
      spaced(ctx, row.label, 40, y, 1.5);

      ctx.textAlign = 'right';
      ctx.font = `600 24px ${MONO}`;
      ctx.fillStyle = INK.text;
      ctx.fillText(row.value, valueColumn ?? logicalW - 40, y + 1);

      ctx.fillStyle = 'rgba(126, 160, 190, 0.16)';
      ctx.fillRect(40, y + 26, logicalW - 80, 1);
      y += 58;
    }

    for (const line of lines) {
      ctx.textAlign = 'left';
      ctx.font = `500 23px ${MONO}`;
      ctx.fillStyle = INK.dim;
      ctx.fillText(line, 40, y);
      y += 40;
    }

    if (footer) {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = `500 16px ${FONT}`;
      ctx.fillStyle = INK.faint;
      spaced(ctx, footer, 40, buttonBottom() - 30, 1.2);
    }

    // 按钮
    const now = performance.now();
    for (const button of buttons) {
      const isHover = hovered === button.id;
      const isFlash = flashId === button.id && now < flashUntil;
      const r = Math.min(button.h / 2, 16);

      if (isHover || isFlash) {
        ctx.save();
        ctx.shadowColor = 'rgba(110, 205, 235, 0.55)';
        ctx.shadowBlur = 18;
        ctx.fillStyle = 'rgba(70, 150, 180, 0.22)';
        rounded(ctx, button.x - 2, button.y - 2, button.w + 4, button.h + 4, r + 2);
        ctx.fill();
        ctx.restore();
      }

      const fill = ctx.createLinearGradient(0, button.y, 0, button.y + button.h);
      if (isFlash) {
        fill.addColorStop(0, 'rgba(88, 168, 198, 0.9)');
        fill.addColorStop(1, 'rgba(38, 92, 116, 0.9)');
      } else if (isHover) {
        fill.addColorStop(0, 'rgba(52, 104, 132, 0.92)');
        fill.addColorStop(1, 'rgba(28, 62, 82, 0.92)');
      } else if (button.tone === 'primary') {
        fill.addColorStop(0, 'rgba(38, 58, 76, 0.88)');
        fill.addColorStop(1, 'rgba(22, 34, 46, 0.88)');
      } else if (button.tone === 'quiet') {
        fill.addColorStop(0, 'rgba(28, 38, 49, 0.72)');
        fill.addColorStop(1, 'rgba(18, 25, 34, 0.72)');
      } else {
        fill.addColorStop(0, 'rgba(34, 48, 62, 0.85)');
        fill.addColorStop(1, 'rgba(21, 31, 42, 0.85)');
      }
      ctx.fillStyle = fill;
      rounded(ctx, button.x, button.y, button.w, button.h, r);
      ctx.fill();

      ctx.strokeStyle = isHover || isFlash ? 'rgba(150, 226, 252, 0.9)' : 'rgba(126, 158, 186, 0.35)';
      ctx.lineWidth = isHover || isFlash ? 2 : 1.2;
      rounded(ctx, button.x, button.y, button.w, button.h, r);
      ctx.stroke();

      // 顶部一道内高光，让按钮读起来是凸的。
      ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
      rounded(ctx, button.x + 3, button.y + 2, button.w - 6, button.h * 0.42, r);
      ctx.fill();

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `600 23px ${FONT}`;
      ctx.fillStyle = isFlash ? '#f2fbff' : isHover ? '#eaf9ff' : INK.text;
      const labelY = button.y + button.h / 2 + 2;
      spaced(ctx, button.label.toUpperCase(), button.x + button.w / 2, labelY, 1.5, 'center');
    }

    texture.needsUpdate = true;
  }

  /** 最下面那个按钮的 y；没有按钮时退回底部。footer 放在它上方。 */
  function buttonBottom(): number {
    let bottom = 0;
    for (const button of buttons) bottom = Math.max(bottom, button.y);
    return bottom > 0 ? bottom : logicalH - 20;
  }

  function buttonAt(localX: number, localY: number): string | null {
    for (const button of buttons) {
      const x0 = pxToLocalX(button.x);
      const x1 = pxToLocalX(button.x + button.w);
      const y0 = pxToLocalY(button.y + button.h);
      const y1 = pxToLocalY(button.y);
      if (localX >= x0 && localX <= x1 && localY >= y0 && localY <= y1) return button.id;
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

  /** 激光笔命中（面板局部坐标）。 */
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

  /** 手戳命中：手在面板前表面附近，且落在面板矩形里。 */
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
      // 激光笔优先：远距离点击是 VR 里最自然的姿势。
      const hit = rayHit(hand) ?? touchHit(hand);
      if (!hit) {
        pressState.set(hand, hand.pressed);
        continue;
      }

      if (!best || hit.distance < best.hit.distance) {
        const id = buttonAt(hit.localX, hit.localY);
        if (id) best = { id, hit, hand };
      }
      if (!nearest || hit.distance < nearest.hit.distance) nearest = { hit, hand };

      const wasPressed = pressState.get(hand) ?? false;
      if (hit.ray && hand.pressed && !wasPressed) {
        const id = buttonAt(hit.localX, hit.localY);
        if (id && !clicked) {
          clicked = id;
          flashId = id;
          flashUntil = performance.now() + FLASH_MS;
        }
      }
      pressState.set(hand, hand.pressed);
    }

    const nextHover = best?.id ?? null;
    const signature = `${nextHover ?? '-'}|${flashId ?? '-'}|${performance.now() < flashUntil}`;
    if (signature !== lastHoverSignature) {
      hovered = nextHover;
      lastHoverSignature = signature;
      draw();
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

  // 初始不透明度 + 首帧绘制。
  material.opacity = opacity;
  haloMaterial.opacity = 0.22 * opacity;
  draw();

  return {
    group,
    get visible(): boolean {
      return group.visible;
    },
    setTitle(next: string): void {
      title = next;
      draw();
    },
    setLines(next: string[]): void {
      lines = next;
      rows = [];
      draw();
    },
    setRows(next: PanelRow[]): void {
      rows = next;
      lines = [];
      draw();
    },
    setValueColumn(x: number | null): void {
      valueColumn = x;
      draw();
    },
    setBadge(text: string, tone: 'good' | 'bad' | 'none' = 'none'): void {
      badge = text ? { text, tone } : null;
      draw();
    },
    setFooter(text: string): void {
      footer = text;
      draw();
    },
    setButtons(next: PanelButton[]): void {
      buttons = next;
      draw();
    },
    setVisible(visible: boolean): void {
      group.visible = visible;
    },
    setOpacity(value: number): void {
      if (value === opacity) return;
      opacity = value;
      material.opacity = value;
      haloMaterial.opacity = 0.22 * value;
      mesh.visible = value > 0.005;
      halo.visible = value > 0.005;
    },
    aimAt(target: THREE.Vector3): void {
      group.rotation.y = Math.atan2(target.x - group.position.x, target.z - group.position.z);
    },
    update,
    dispose(): void {
      mesh.geometry.dispose();
      material.dispose();
      texture.dispose();
      halo.geometry.dispose();
      haloMaterial.dispose();
      haloTexture.dispose();
      group.clear();
    },
  };
}
