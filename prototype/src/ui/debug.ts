import GUI from 'lil-gui';
import type * as THREE from 'three';

import { DEFAULT_PARAMS, type TableParams } from '../config';
import { DEFAULT_DISPLAY, type DisplayPlacement } from '../scene/display';

/**
 * 调试面板（仅 dev）。
 *
 * 这一版的参数变少了：没有槽宽 / 槽深 / 导轨，也没有隐藏轨／窗口偏移。
 * 多了「浮空显示」的位置 —— 它属于世界，可以整块挪到你顺眼的地方。
 */

export interface DebugOptions {
  params: TableParams;
  display: DisplayPlacement;
  lab: { visible: boolean };
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  onChange(): void;
  onDisplayChange(): void;
  onLabChange(): void;
}

export interface DebugHandle {
  dispose(): void;
}

export function createDebug(options: DebugOptions): DebugHandle {
  const { params, display, lab, renderer, scene, onChange, onDisplayChange, onLabChange } = options;
  const gui = new GUI({ title: 'PARALLAX · STEP 1', width: 288 });

  const table = gui.addFolder('台面');
  table.add(params, 'tableHeight', 0.8, 1.12, 0.005).name('高度 m').onChange(onChange);
  table.add(params, 'laneWidth', 0.16, 0.34, 0.005).name('轨宽 m').onChange(onChange);
  table.add(params, 'tableDepth', 1.4, 12, 0.1).name('进深 m').onChange(onChange);
  table.add(params, 'nearOffset', 0.16, 0.5, 0.01).name('近端距离 m').onChange(onChange);
  table.add(params, 'plateThickness', 0.006, 0.03, 0.001).name('板厚 m').onChange(onChange);

  const layout = gui.addFolder('布局');
  layout.add(params, 'showLaneNumbers').name('近端轨号').onChange(onChange);
  layout.add(params, 'showBand').name('判定带').onChange(onChange);

  const floating = gui.addFolder('浮空显示');
  floating.add(display, 'x', -2, 2, 0.01).name('X 右').onChange(onDisplayChange);
  floating.add(display, 'y', 0.4, 2.2, 0.01).name('Y 高').onChange(onDisplayChange);
  floating.add(display, 'z', -8, 0, 0.05).name('Z 前').onChange(onDisplayChange);

  const material = gui.addFolder('材质实验台');
  material.add(lab, 'visible').name('显示样品').onChange(onLabChange);

  const look = gui.addFolder('表现');
  look.add(renderer, 'toneMappingExposure', 0.5, 2, 0.01).name('曝光');
  look.add(scene, 'environmentIntensity', 0, 3, 0.01).name('环境强度');

  gui
    .add(
      {
        reset: () => {
          Object.assign(params, DEFAULT_PARAMS);
          Object.assign(display, DEFAULT_DISPLAY);
          gui.controllersRecursive().forEach((controller) => controller.updateDisplay());
          onChange();
          onDisplayChange();
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
