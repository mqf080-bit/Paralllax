import * as THREE from 'three';

import { drawToTexture } from '../materials/textures';

/**
 * 浮空显示：曲名 / 作者 / 封面 + 分数，飘在台面右前方的空间里。
 *
 * 不是 HUD：不挂在相机上，不跟着头走，也没有「显示屏」。
 * 它属于世界，位置在玩家自然的视线方向上（看轨道时顺带就能瞄到），
 * 需要时可以整体挪 —— 调试面板里有 X / Y / Z。
 *
 * 只画字，没有背板 / 边框 / 玻璃；一条黄铜细线负责「仪器」的语义。
 */

export interface DisplayTextures {
  panel: THREE.CanvasTexture;
  /** 分数 / 连击 / 血条是动态的，变化时重画。 */
  update(state: DisplayState): void;
  dispose(): void;
}

export interface DisplayState {
  score: number;
  combo: number;
  health: number;
  /** 物量总数；0 = 还没创建播放器。 */
  objects: number;
}

export interface DisplayMeta {
  title: string;
  artist: string;
  difficulty: string;
  /** 封面（已 decode 的图片）；null = 没有封面。 */
  cover?: CanvasImageSource | null;
}

export interface DisplayBuild {
  group: THREE.Group;
  dispose(): void;
  /** 绕 Y 轴朝向某个点（通常是头显位置）。 */
  aimAt(target: THREE.Vector3): void;
}

export interface DisplayPlacement {
  x: number;
  y: number;
  z: number;
}

/** 默认位置：右前方 2.6m、台面上方 0.1m。x 现在是相对「窗口右缘」的额外偏移。 */
export const DEFAULT_DISPLAY: DisplayPlacement = { x: 0, y: 1.05, z: -2.6 };

const TEXTURE_WIDTH = 1536;
const TEXTURE_HEIGHT = 480;
/** 显示的世界宽度（米）。之前 0.64m，太小了。 */
export const DISPLAY_WIDTH = 1.0;
/** 留给「轨道右缘 → 显示左缘」的距离（米）。 */
export const DISPLAY_GAP = 0.3;
const PLANE_WIDTH = DISPLAY_WIDTH;
const PLANE_HEIGHT = (PLANE_WIDTH * TEXTURE_HEIGHT) / TEXTURE_WIDTH;

export function createDisplayTextures(meta: DisplayMeta): DisplayTextures {
  const panel = drawToTexture(TEXTURE_WIDTH, TEXTURE_HEIGHT, () => {});
  const canvas = panel.image as HTMLCanvasElement;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D canvas context unavailable');
  const ctx: CanvasRenderingContext2D = context;

  let lastScore = -1;
  let lastCombo = -1;
  let lastHealth = -1;
  let lastObjects = -1;

  function draw(state: DisplayState): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // 画布放大 1.5 倍，排版坐标沿用原来的值。
    ctx.scale(1.5, 1.5);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    // 封面：右侧一块方图；没有就留空，不伪造一个「CD」。
    if (meta.cover) {
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(792, 24, 180, 180);
      ctx.drawImage(meta.cover, 792, 24, 180, 180);
      ctx.strokeStyle = 'rgba(176,141,87,0.45)';
      ctx.lineWidth = 1;
      ctx.strokeRect(792.5, 24.5, 180, 180);
      ctx.restore();
    }

    // 曲名（限制在封面左侧，避免长标题压到图上）
    ctx.save();
    ctx.beginPath();
    ctx.rect(8, 0, 760, 130);
    ctx.clip();
    ctx.font = '500 34px ui-monospace, Menlo, monospace';
    ctx.fillStyle = 'rgba(196,210,226,0.82)';
    ctx.fillText(meta.title, 8, 64);

    // 作者
    ctx.font = '500 24px ui-monospace, Menlo, monospace';
    ctx.fillStyle = 'rgba(170,185,200,0.95)';
    ctx.fillText(meta.artist || '—', 8, 100);
    ctx.restore();

    // 黄铜细线：唯一的暖色。
    ctx.fillStyle = 'rgba(176,141,87,0.55)';
    ctx.fillRect(8, 116, 480, 2);

    // 分数
    ctx.font = '700 118px ui-monospace, Menlo, monospace';
    ctx.fillStyle = 'rgba(232,242,252,0.96)';
    ctx.fillText(String(Math.round(state.score)).padStart(8, '0'), 4, 214);

    // 连击（只作反馈，不参与计分）
    ctx.font = '500 30px ui-monospace, Menlo, monospace';
    ctx.fillStyle = 'rgba(150,170,190,0.9)';
    ctx.fillText(`COMBO ${state.combo}`, 470, 214);

    // 血条
    const barX = 8;
    const barY = 230;
    const barW = 480;
    const barH = 16;
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(barX, barY, barW, barH);
    const ratio = Math.max(0, Math.min(1, state.health / 100));
    ctx.fillStyle =
      ratio > 0.5 ? 'rgba(150,220,240,0.95)' : ratio > 0.2 ? 'rgba(232,192,122,0.95)' : 'rgba(224,72,95,0.95)';
    ctx.fillRect(barX, barY, barW * ratio, barH);

    // 副信息
    ctx.font = '500 24px ui-monospace, Menlo, monospace';
    ctx.fillStyle = 'rgba(122,136,152,0.9)';
    const notes = state.objects > 0 ? `${state.objects.toLocaleString('en-US')} NOTES` : '—';
    ctx.fillText(`${meta.difficulty}   ·   ${notes}`, 8, 296);
  }

  const initial: DisplayState = { score: 0, combo: 0, health: 100, objects: 0 };
  draw(initial);
  lastScore = initial.score;
  lastCombo = initial.combo;
  lastHealth = initial.health;
  lastObjects = initial.objects;

  return {
    panel,
    update(state: DisplayState): void {
      const score = Math.round(state.score);
      const combo = Math.round(state.combo);
      const health = Math.round(state.health);
      const objects = Math.round(state.objects);
      if (score === lastScore && combo === lastCombo && health === lastHealth && objects === lastObjects) return;
      lastScore = score;
      lastCombo = combo;
      lastHealth = health;
      lastObjects = objects;
      draw({ score, combo, health, objects });
      panel.needsUpdate = true;
    },
    dispose(): void {
      panel.dispose();
    },
  };
}

export function buildDisplay(textures: DisplayTextures, placement: DisplayPlacement): DisplayBuild {
  const group = new THREE.Group();
  group.name = 'floating-display';
  group.position.set(placement.x, placement.y, placement.z);

  const material = new THREE.MeshBasicMaterial({
    map: textures.panel,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    // 浮空显示不能挡轨道：只写字，关掉深度写入即可。
  });

  const face = new THREE.Mesh(new THREE.PlaneGeometry(PLANE_WIDTH, PLANE_HEIGHT), material);
  face.name = 'floating-display-text';
  group.add(face);

  return {
    group,
    dispose(): void {
      face.geometry.dispose();
      material.dispose();
      group.clear();
    },
    aimAt(target: THREE.Vector3): void {
      const dx = target.x - group.position.x;
      const dz = target.z - group.position.z;
      // 平面法线是 +z：让 +z 指向目标。
      group.rotation.y = Math.atan2(dx, dz);
    },
  };
}
