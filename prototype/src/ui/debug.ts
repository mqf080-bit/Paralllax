import GUI from 'lil-gui';
import type * as THREE from 'three';

import { DEFAULT_PARAMS, type TableParams } from '../config';

/**
 * 调试面板（仅 dev）。
 *
 * `agent.md` §5 要求能现场调：槽宽 / 槽深 / 导轨高度 / 台面高度 / 显示隐藏轨 / 轨号。
 * 明暗切换已决定后置（只做深色），所以这里只有曝光与环境强度，没有主题开关。
 */

export interface DebugOptions {
  params: TableParams;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  onChange(): void;
}

export interface DebugHandle {
  dispose(): void;
}

export function createDebug(options: DebugOptions): DebugHandle {
  const { params, renderer, scene, onChange } = options;
  const gui = new GUI({ title: 'PARALLAX · STEP 1', width: 288 });

  const table = gui.addFolder('台面');
  table.add(params, 'tableHeight', 0.8, 1.12, 0.005).name('高度 m').onChange(onChange);
  table.add(params, 'tableDepth', 1.4, 2.4, 0.02).name('进深 m').onChange(onChange);
  table.add(params, 'nearOffset', 0.16, 0.5, 0.01).name('近端距离 m').onChange(onChange);
  table.add(params, 'lanePitch', 0.15, 0.24, 0.005).name('轨距 m').onChange(onChange);
  table.add(params, 'slotWidth', 0.1, 0.22, 0.005).name('槽宽 m').onChange(onChange);
  table.add(params, 'slotDepth', 0.006, 0.03, 0.001).name('槽深 m').onChange(onChange);
  table.add(params, 'railHeight', 0, 0.012, 0.001).name('导轨高度 m').onChange(onChange);

  const layout = gui.addFolder('布局');
  layout
    .add(params, 'windowOffset', { '0–3': -1, '1–4': 0, '2–5': 1 })
    .name('4 轨窗口')
    .onChange(onChange);
  layout.add(params, 'revealHidden').name('揭开隐藏轨 0/5').onChange(onChange);
  layout.add(params, 'showLaneNumbers').name('近端轨号').onChange(onChange);
  layout.add(params, 'showBand').name('判定带').onChange(onChange);

  const look = gui.addFolder('表现');
  look.add(renderer, 'toneMappingExposure', 0.5, 2, 0.01).name('曝光');
  look.add(scene, 'environmentIntensity', 0, 3, 0.01).name('环境强度');

  gui
    .add(
      {
        reset: () => {
          Object.assign(params, DEFAULT_PARAMS);
          gui.controllersRecursive().forEach((controller) => controller.updateDisplay());
          onChange();
        },
      },
      'reset',
    )
    .name('恢复默认');

  return {
    dispose(): void {
      gui.destroy();
    },
  };
}
