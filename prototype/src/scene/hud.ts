import * as THREE from 'three';

import type { TableGeometry, TableParams } from '../config';
import type { MaterialLibrary } from '../materials/library';
import { drawToTexture } from '../materials/textures';

/**
 * HUD 托架（占位）。
 *
 * `references/04-synthesis.md` §1 ⑥ 留了一个未决问题：托架固定在**世界**还是**视野**。
 * 这里先做世界固定——更像仪器，代价是玩家可能找不到。
 * 这一步只测「仪器语言能不能读」，不实现任何真实 HUD。
 *
 * 位置在台面右外侧，不进入可打区（5.2）。
 */

export interface HudBuild {
  group: THREE.Group;
  dispose(): void;
}

export interface HudTextures {
  panel: THREE.CanvasTexture;
  dispose(): void;
}

const TEXTURE_WIDTH = 1024;
const TEXTURE_HEIGHT = 320;
const PANEL_WIDTH = 0.27;
const PANEL_HEIGHT = (PANEL_WIDTH * TEXTURE_HEIGHT) / TEXTURE_WIDTH;

export function createHudTextures(): HudTextures {
  const panel = drawToTexture(TEXTURE_WIDTH, TEXTURE_HEIGHT, (ctx, w, h) => {
    // 面板底：极暗的渐变，让文字有「发光的玻璃」感。
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, 'rgba(14,18,24,0.94)');
    bg.addColorStop(1, 'rgba(6,8,11,0.94)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // 顶部黄铜细线：唯一暖色。
    ctx.fillStyle = 'rgba(176,141,87,0.85)';
    ctx.fillRect(0, 0, w, 4);

    // 右侧竖排刻度：纯粹的仪器装饰，不含信息。
    ctx.fillStyle = 'rgba(140,158,178,0.25)';
    for (let i = 0; i < 9; i += 1) {
      const y = 28 + i * 32;
      const long = i % 3 === 0;
      ctx.fillRect(w - (long ? 34 : 20), y, long ? 22 : 12, 2);
    }

    ctx.textBaseline = 'alphabetic';

    ctx.font = '600 46px ui-monospace, Menlo, monospace';
    ctx.fillStyle = 'rgba(176,141,87,0.95)';
    ctx.fillText('PARALLAX', 44, 82);

    ctx.font = '500 26px ui-monospace, Menlo, monospace';
    ctx.fillStyle = 'rgba(124,136,152,0.95)';
    ctx.fillText('LANE 06   WINDOW 1–4', 44, 128);

    ctx.font = '700 104px ui-monospace, Menlo, monospace';
    ctx.fillStyle = 'rgba(230,241,251,0.98)';
    ctx.fillText('0000000', 40, 240);

    ctx.font = '500 24px ui-monospace, Menlo, monospace';
    ctx.fillStyle = 'rgba(90,102,117,0.95)';
    ctx.fillText('SYNC 0.00    FPS —', 44, 286);

    ctx.font = '500 22px ui-monospace, Menlo, monospace';
    ctx.fillStyle = 'rgba(176,141,87,0.7)';
    ctx.textAlign = 'right';
    ctx.fillText('S1', w - 72, 82);
  });

  return {
    panel,
    dispose(): void {
      panel.dispose();
    },
  };
}

export function buildHud(
  params: TableParams,
  g: TableGeometry,
  lib: MaterialLibrary,
  textures: HudTextures,
): HudBuild {
  const group = new THREE.Group();
  group.name = 'hud-cradle';

  const topY = params.tableHeight;
  const mountX = g.width / 2 + 0.035;
  const mountY = topY + 0.075;
  const mountZ = g.nearZ - 0.62;

  // 悬臂：从台面右侧伸出来。
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.012, 0.024), lib.machinedEdge);
  arm.position.set(g.width / 2 + 0.045, topY - 0.03, mountZ);
  group.add(arm);

  const post = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.11, 0.018), lib.rib);
  post.position.set(mountX, topY + 0.02, mountZ);
  group.add(post);

  // 面板组：朝向玩家，略向上仰。
  const panel = new THREE.Group();
  panel.position.set(mountX, mountY, mountZ);
  panel.rotation.set(-0.4, -1.2, 0);
  group.add(panel);

  const backing = new THREE.Mesh(new THREE.BoxGeometry(PANEL_WIDTH + 0.012, PANEL_HEIGHT + 0.012, 0.005), lib.rib);
  panel.add(backing);

  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(PANEL_WIDTH, PANEL_HEIGHT),
    new THREE.MeshBasicMaterial({
      map: textures.panel,
      transparent: true,
      toneMapped: false,
      depthWrite: false,
    }),
  );
  face.position.z = 0.003;
  face.renderOrder = 4;
  panel.add(face);

  // 黄铜边框：四条细边，不是整块黄铜——暖金属只能当强调。
  const halfW = (PANEL_WIDTH + 0.012) / 2;
  const halfH = (PANEL_HEIGHT + 0.012) / 2;
  const frameParts: Array<{ w: number; h: number; x: number; y: number }> = [
    { w: PANEL_WIDTH + 0.016, h: 0.0025, x: 0, y: halfH },
    { w: PANEL_WIDTH + 0.016, h: 0.0025, x: 0, y: -halfH },
    { w: 0.0025, h: PANEL_HEIGHT + 0.012, x: -halfW, y: 0 },
    { w: 0.0025, h: PANEL_HEIGHT + 0.012, x: halfW, y: 0 },
  ];
  for (const part of frameParts) {
    const geometry = new THREE.BoxGeometry(part.w, part.h, 0.002);
    geometry.translate(part.x, part.y, 0.0028);
    panel.add(new THREE.Mesh(geometry, lib.brass));
  }

  return {
    group,
    dispose(): void {
      group.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          if (object.material instanceof THREE.MeshBasicMaterial && object.material.map === textures.panel) {
            object.material.dispose();
          }
        }
      });
      group.clear();
    },
  };
}
