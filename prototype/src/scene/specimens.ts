import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

import type { TableGeometry, TableParams } from '../config';
import type { MaterialLibrary } from '../materials/library';
import { drawToTexture } from '../materials/textures';

/**
 * 材质样品盘。
 *
 * Step 1 还没有键，而验收要求「深色主题下金属/陶瓷/冰/玻璃/黄铜的像成立」。
 * 所以在台面**左侧下方**挂一只样品盘——它不在可打区里（5.2），也不参与任何判定。
 *
 * 这是 Step 1 的测试道具：Step 2 有了真实键型之后，这块板就该撤掉。
 */

export interface SpecimensBuild {
  group: THREE.Group;
  dispose(): void;
}

export interface SpecimenTextures {
  labels: THREE.CanvasTexture;
  dispose(): void;
}

const CHIP_X = [-0.09, -0.03, 0.03, 0.09];
const LABELS = ['CERAMIC', 'GLASS', 'BRASS', 'FROST'];

export function createSpecimenTextures(): SpecimenTextures {
  const labels = drawToTexture(1024, 128, (ctx, w, h) => {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '500 38px ui-monospace, Menlo, monospace';

    const u = (x: number): number => w * (0.5 + x / 0.26);
    CHIP_X.forEach((x, index) => {
      ctx.fillStyle = 'rgba(0,0,0,0.8)';
      ctx.fillText(LABELS[index]!, u(x) + 1, h / 2 + 2);
      ctx.fillStyle = 'rgba(150,164,180,0.9)';
      ctx.fillText(LABELS[index]!, u(x), h / 2);
    });
  });

  return {
    labels,
    dispose(): void {
      labels.dispose();
    },
  };
}

export function buildSpecimens(
  params: TableParams,
  g: TableGeometry,
  lib: MaterialLibrary,
  textures: SpecimenTextures,
): SpecimensBuild {
  const group = new THREE.Group();
  group.name = 'specimen-tray';

  const trayX = -(g.width / 2 + 0.15);
  const trayY = params.tableHeight - 0.08;
  const trayZ = g.nearZ - 0.58;

  const trayGroup = new THREE.Group();
  trayGroup.position.set(trayX, trayY, trayZ);
  trayGroup.rotation.y = 0.38;
  group.add(trayGroup);

  // 侧托板：从台面左侧壁上伸出来的一块小台，样品盘坐在上面。
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.014, 0.15), lib.machinedEdge);
  shelf.position.set(-g.width / 2 - 0.085, trayY - 0.015, trayZ);
  group.add(shelf);

  const shelfLip = new THREE.Mesh(new THREE.BoxGeometry(0.202, 0.005, 0.152), lib.brass);
  shelfLip.position.set(-g.width / 2 - 0.085, trayY - 0.024, trayZ);
  group.add(shelfLip);

  // 托盘本体。
  const tray = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.012, 0.11), lib.rib);
  trayGroup.add(tray);

  const trayLip = new THREE.Mesh(new THREE.BoxGeometry(0.262, 0.004, 0.112), lib.machinedEdge);
  trayLip.position.y = -0.007;
  trayGroup.add(trayLip);

  // 四个样品。
  const ceramic = new THREE.Mesh(new RoundedBoxGeometry(0.042, 0.02, 0.042, 2, 0.003), lib.ceramic);
  ceramic.position.set(CHIP_X[0]!, 0.016, -0.012);
  ceramic.rotation.y = 0.18;
  trayGroup.add(ceramic);

  const glass = new THREE.Mesh(new RoundedBoxGeometry(0.042, 0.013, 0.042, 2, 0.0025), lib.smokedGlass);
  glass.position.set(CHIP_X[1]!, 0.0125, -0.012);
  glass.rotation.y = -0.12;
  trayGroup.add(glass);

  const brass = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.022, 24), lib.brass);
  brass.position.set(CHIP_X[2]!, 0.017, -0.012);
  trayGroup.add(brass);

  // 冰锥：六棱锥，细而透，棱面就是它的「体积」。
  const frost = new THREE.Mesh(new THREE.ConeGeometry(0.013, 0.042, 6), lib.ice);
  frost.position.set(CHIP_X[3]!, 0.026, -0.012);
  frost.rotation.y = 0.4;
  trayGroup.add(frost);

  // 刻字：躺在托盘前缘。
  const labelPlane = new THREE.PlaneGeometry(0.24, 0.03);
  labelPlane.rotateX(-Math.PI / 2);
  labelPlane.translate(0, 0.0092, 0.037);
  const labelMaterial = new THREE.MeshBasicMaterial({
    map: textures.labels,
    transparent: true,
    toneMapped: false,
    depthWrite: false,
  });
  const labels = new THREE.Mesh(labelPlane, labelMaterial);
  labels.renderOrder = 3;
  trayGroup.add(labels);

  return {
    group,
    dispose(): void {
      group.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          if (object.material instanceof THREE.MeshBasicMaterial && object.material.map === textures.labels) {
            object.material.dispose();
          }
        }
      });
      group.clear();
    },
  };
}
