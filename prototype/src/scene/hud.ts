import * as THREE from 'three';

import { drawToTexture } from '../materials/textures';

/**
 * HUD：空间里的文字，不是一块屏。
 *
 * 位置固定在**视野**的 3–4 点钟方向（agent.md §4 的未决问题这里先选了视野固定）：
 * 它跟着头走，转头不会跟丢，代价是不再属于台面。
 *
 * 没有背板、没有边框、没有玻璃 —— 只有字与一条黄铜细线。
 * 逻辑上挂在 camera 下面，所以桌面 fallback 与 VR 里都在同一处。
 */

export interface HudTextures {
  panel: THREE.CanvasTexture;
  dispose(): void;
}

export interface HudBuild {
  group: THREE.Group;
  dispose(): void;
}

const TEXTURE_WIDTH = 1024;
const TEXTURE_HEIGHT = 320;
const PANEL_WIDTH = 0.42;
const PANEL_HEIGHT = (PANEL_WIDTH * TEXTURE_HEIGHT) / TEXTURE_WIDTH;

/** 相机坐标系里的位置：右 0.62m、下 0.05m、前 0.95m → 约 33° 偏右。 */
const OFFSET = new THREE.Vector3(0.62, -0.05, -0.95);

export function createHudTextures(): HudTextures {
  const panel = drawToTexture(TEXTURE_WIDTH, TEXTURE_HEIGHT, (ctx, w) => {
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';

    // 曲名
    ctx.font = '500 34px ui-monospace, Menlo, monospace';
    ctx.fillStyle = 'rgba(196,210,226,0.82)';
    ctx.fillText('ANTAGONISM', w - 40, 72);

    // 黄铜细线：唯一的暖色，也是「仪器」而不是「海报」的理由。
    ctx.fillStyle = 'rgba(176,141,87,0.55)';
    ctx.fillRect(w - 520, 94, 480, 2);

    // 分数
    ctx.font = '700 118px ui-monospace, Menlo, monospace';
    ctx.fillStyle = 'rgba(232,242,252,0.96)';
    ctx.fillText('00630913', w - 36, 214);

    // 副信息
    ctx.font = '500 24px ui-monospace, Menlo, monospace';
    ctx.fillStyle = 'rgba(122,136,152,0.9)';
    ctx.fillText('IN 7   ·   1,024 NOTES', w - 40, 262);
  });

  return {
    panel,
    dispose(): void {
      panel.dispose();
    },
  };
}

export function buildHud(textures: HudTextures): HudBuild {
  const group = new THREE.Group();
  group.name = 'view-hud';
  group.position.copy(OFFSET);

  const material = new THREE.MeshBasicMaterial({
    map: textures.panel,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });

  const face = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_WIDTH, PANEL_HEIGHT), material);
  face.name = 'view-hud-text';
  // 挂到相机上时，别让视锥裁剪按世界原点算。
  face.frustumCulled = false;
  group.add(face);

  return {
    group,
    dispose(): void {
      face.geometry.dispose();
      material.dispose();
      group.clear();
    },
  };
}
