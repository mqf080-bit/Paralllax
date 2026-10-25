import * as THREE from 'three';

import { buildBackground } from './background/build';
import { BACKGROUND_PRESETS, DEFAULT_BACKGROUND_ID } from './background/spec';
import type { BackgroundSpec } from './background/spec';

/**
 * 背景：程序化天空 + 体素台地 + 菱形巨构。
 *
 * 设计定稿在 `design/bg-lab/`（Blender），实现在 `scene/background/`。
 * 两个内置预设：`light` / `dark`；包内没写背景时用 `light`。
 *
 * 注意：天空球半径 320 m，所以相机的 far 必须 ≥ 320（`main.ts` 里是 400）。
 */

export interface BackdropBuild {
  group: THREE.Group;
  /** 当前实际使用的背景。 */
  spec: BackgroundSpec;
  dispose(): void;
}

export function buildBackdrop(id: string = DEFAULT_BACKGROUND_ID): BackdropBuild {
  const spec: BackgroundSpec = id === 'dark' ? BACKGROUND_PRESETS.dark : BACKGROUND_PRESETS.light;
  const built = buildBackground(spec);
  return {
    group: built.group,
    spec,
    dispose(): void {
      built.dispose();
    },
  };
}
