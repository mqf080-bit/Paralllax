import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

import type { MaterialLibrary } from '../materials/library';

/**
 * 材质实验台（dev）。
 *
 * 场景里现在没有键，冰 / 玻璃 / 陶瓷 / 黄铜没有地方可以看。
 * 这里放四件样品，浮在玩家正前方 0.7m、台面上方 0.3m，慢慢自转 ——
 * 只为凑近看表面行为，不参与任何玩法，也不进入设计文档。
 *
 * 默认在 dev 下显示，`?lab=0` 或调试面板可以关掉。
 */

export interface MaterialLab {
  group: THREE.Group;
  /** 自转；用绝对时间，避免帧率变化时快慢不一。 */
  update(elapsed: number): void;
  dispose(): void;
}

export function buildMaterialLab(lib: MaterialLibrary): MaterialLab {
  const group = new THREE.Group();
  group.name = 'material-lab';
  // 让玻璃管的中心正对 0 号分割线，折射能看出「线被折弯」。
  group.position.set(-0.11, 1.12, -0.66);

  const items: THREE.Object3D[] = [];

  // 检验灯：只在实验台上方，负责把棱面与玻璃的波纹打出来。
  const inspection = new THREE.PointLight(0xdcecff, 3.2, 1.8, 2);
  inspection.position.set(0, 0.3, 0.16);
  group.add(inspection);

  // 暗瓷：一块倒角砖，釉面高光 + 低频起伏。
  const ceramic = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.05, 0.1, 3, 0.007), lib.ceramic);
  ceramic.position.x = -0.27;
  group.add(ceramic);
  items.push(ceramic);

  // 冰：横置细条（和 drag 同形），法线贴图给晶面。
  const ice = new THREE.Mesh(new RoundedBoxGeometry(0.18, 0.022, 0.04, 2, 0.005), lib.iceBar);
  ice.position.x = -0.09;
  group.add(ice);
  items.push(ice);


  // 玻璃管：外壁 + 内光带，端面开口，能看见壁厚。
  const tube = new THREE.Group();
  tube.position.x = 0.09;
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.19, 32, 1, true), lib.clearGlass);
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.17, 16), lib.glassCore);
  tube.add(shell, core);
  group.add(tube);
  items.push(tube);

  // 黄铜：一只环，靠反射与边缘高光说话。
  const brass = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.008, 16, 48), lib.brass);
  brass.position.x = 0.27;
  brass.rotation.x = Math.PI / 2.6;
  group.add(brass);
  items.push(brass);

  // 投影：样品往台面上落影，这是「浮着」最直接的证据。
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });

  return {
    group,
    update(elapsed: number): void {
      const angle = elapsed * 0.45;
      items.forEach((item, index) => {
        item.rotation.y = angle + index * 0.7;
      });
    },
    dispose(): void {
      group.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
      group.clear();
    },
  };
}
