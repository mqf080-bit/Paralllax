import * as THREE from 'three';

import { drawToTexture } from '../materials/textures';

/**
 * 浮空显示：曲名 + 分数，飘在台面右前方的空间里。
 *
 * 不是 HUD：不挂在相机上，不跟着头走，也没有「显示屏」。
 * 它属于世界，位置在玩家自然的视线方向上（看轨道时顺带就能瞄到），
 * 需要时可以整体挪 —— 调试面板里有 X / Y / Z。
 *
 * 只画字，没有背板 / 边框 / 玻璃；一条黄铜细线负责「仪器」的语义。
 */

export interface DisplayTextures {
  panel: THREE.CanvasTexture;
  dispose(): void;
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

/** 默认位置：右前方 2.6m、台面上方 0.1m。看轨道时在视野上沿。 */
export const DEFAULT_DISPLAY: DisplayPlacement = { x: 0.72, y: 1.05, z: -2.6 };

const TEXTURE_WIDTH = 1024;
const TEXTURE_HEIGHT = 320;
const PLANE_WIDTH = 0.64;
const PLANE_HEIGHT = (PLANE_WIDTH * TEXTURE_HEIGHT) / TEXTURE_WIDTH;

export function createDisplayTextures(): DisplayTextures {
  const panel = drawToTexture(TEXTURE_WIDTH, TEXTURE_HEIGHT, (ctx) => {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    // 曲名
    ctx.font = '500 34px ui-monospace, Menlo, monospace';
    ctx.fillStyle = 'rgba(196,210,226,0.82)';
    ctx.fillText('ANTAGONISM', 8, 72);

    // 黄铜细线：唯一的暖色。
    ctx.fillStyle = 'rgba(176,141,87,0.55)';
    ctx.fillRect(8, 94, 480, 2);

    // 分数
    ctx.font = '700 118px ui-monospace, Menlo, monospace';
    ctx.fillStyle = 'rgba(232,242,252,0.96)';
    ctx.fillText('00630913', 4, 214);

    // 副信息
    ctx.font = '500 24px ui-monospace, Menlo, monospace';
    ctx.fillStyle = 'rgba(122,136,152,0.9)';
    ctx.fillText('IN 7   ·   1,024 NOTES', 8, 262);
  });

  return {
    panel,
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
