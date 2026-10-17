import * as THREE from 'three';

import type { MaterialLibrary } from '../materials/library';

/**
 * 背景：一间暗房。
 *
 * `parallax-idea.md` 5.3：背景可以是 3D、可以动，但必须待在可打区之外，
 * 明度不得超过键，运动不能带动参考系。
 * Step 1 只做静态的一层：暗房 + 远处一块渐变幕 + 两条极暗的竖向灯带。
 * 不做 shader 演出，不做粒子（那是单曲异象的事）。
 */

export interface BackdropBuild {
  group: THREE.Group;
  dispose(): void;
}

export function buildBackdrop(lib: MaterialLibrary): BackdropBuild {
  const group = new THREE.Group();
  group.name = 'backdrop';

  // 地面：比 Step 0 的检查场景更暗，只提供「脚下有东西」的参照。
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({
    color: 0x07080b,
    roughness: 0.94,
    metalness: 0.05,
  }));
  floor.rotation.x = -Math.PI / 2;
  floor.name = 'stage-floor';
  group.add(floor);

  const grid = new THREE.GridHelper(48, 48, 0x1a2231, 0x10151d);
  grid.position.y = 0.001;
  grid.name = 'stage-grid';
  group.add(grid);

  return {
    group,
    dispose(): void {
      group.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          if (object.material !== lib.backdrop) object.material.dispose();
        }
        if (object instanceof THREE.GridHelper) {
          object.geometry.dispose();
          (object.material as THREE.Material).dispose();
        }
      });
      group.clear();
    },
  };
}
