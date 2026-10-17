import * as THREE from 'three';

import type { HandSample } from '../game/hands';

/**
 * 一个可以被手「戳」的 3D 面板：canvas 贴图 + 平面 + 按钮矩形。
 *
 * 没有射线：手伸到面板前面、落在按钮的矩形里、按下扳机 = 点击。
 * 面板只绕 Y 轴朝向玩家（和浮空显示一样），所以局部坐标很好算。
 */

export interface PanelButton {
  id: string;
  label: string;
  /** canvas 像素坐标。 */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface VrPanel {
  group: THREE.Group;
  readonly visible: boolean;
  setTitle(title: string): void;
  setLines(lines: string[]): void;
  setButtons(buttons: PanelButton[]): void;
  setVisible(visible: boolean): void;
  aimAt(target: THREE.Vector3): void;
  /** 处理点击；返回这一帧被按下的按钮 id。 */
  update(hands: HandSample[]): string | null;
  dispose(): void;
}

export interface PanelOptions {
  width: number;
  height: number;
  canvasWidth?: number;
  canvasHeight?: number;
  title?: string;
  /** 面板前表面到这个距离以内算「手在面板上」。 */
  touchDepth?: number;
}

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
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

export function createVrPanel(options: PanelOptions): VrPanel {
  const width = options.width;
  const height = options.height;
  const cw = options.canvasWidth ?? 640;
  const ch = options.canvasHeight ?? 480;
  const touchDepth = options.touchDepth ?? 0.12;

  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D canvas context unavailable');
  const ctx: CanvasRenderingContext2D = context;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    side: THREE.FrontSide,
  });

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  const group = new THREE.Group();
  group.add(mesh);
  group.visible = false;

  let title = options.title ?? '';
  let lines: string[] = [];
  let buttons: PanelButton[] = [];
  let hovered: string | null = null;

  const pressState = new WeakMap<HandSample, boolean>();

  function pxToLocalX(px: number): number {
    return (px / cw - 0.5) * width;
  }
  function pxToLocalY(py: number): number {
    return (0.5 - py / ch) * height;
  }

  function draw(): void {
    ctx.clearRect(0, 0, cw, ch);

    ctx.fillStyle = 'rgba(8, 12, 18, 0.86)';
    rounded(ctx, 6, 6, cw - 12, ch - 12, 22);
    ctx.fill();
    ctx.strokeStyle = 'rgba(140, 170, 200, 0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = 'rgba(232, 242, 252, 0.95)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '600 38px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.fillText(title, 36, 66);

    ctx.fillStyle = 'rgba(176, 141, 87, 0.7)';
    ctx.fillRect(36, 82, 132, 2);

    ctx.font = '400 26px ui-monospace, Menlo, monospace';
    ctx.fillStyle = 'rgba(190, 206, 222, 0.92)';
    let y = 128;
    for (const line of lines) {
      ctx.fillText(line, 36, y);
      y += 34;
    }

    for (const button of buttons) {
      const isHovered = hovered === button.id;
      ctx.fillStyle = isHovered ? 'rgba(90, 140, 175, 0.55)' : 'rgba(40, 56, 72, 0.7)';
      rounded(ctx, button.x, button.y, button.w, button.h, 10);
      ctx.fill();
      ctx.strokeStyle = isHovered ? 'rgba(190, 230, 255, 0.9)' : 'rgba(140, 170, 200, 0.45)';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = 'rgba(232, 242, 252, 0.95)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '600 26px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif';
      ctx.fillText(button.label, button.x + button.w / 2, button.y + button.h / 2 + 1);
    }

    texture.needsUpdate = true;
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

  const local = new THREE.Vector3();

  function update(hands: HandSample[]): string | null {
    if (!group.visible) return null;
    group.updateMatrixWorld(true);

    let hover: string | null = null;
    let clicked: string | null = null;

    for (const hand of hands) {
      if (!hand.active) continue;
      local.copy(hand.position);
      group.worldToLocal(local);
      const inside =
        Math.abs(local.x) <= width / 2 &&
        Math.abs(local.y) <= height / 2 &&
        local.z >= -touchDepth &&
        local.z <= 0.06;
      const id = inside ? buttonAt(local.x, local.y) : null;

      if (id) {
        hover = id;
        const wasPressed = pressState.get(hand) ?? false;
        if (hand.pressed && !wasPressed) clicked = id;
      }
      pressState.set(hand, hand.pressed);
    }

    if (hover !== hovered) {
      hovered = hover;
      draw();
    }
    return clicked;
  }

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
      draw();
    },
    setButtons(next: PanelButton[]): void {
      buttons = next;
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
