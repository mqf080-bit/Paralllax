import * as THREE from 'three';

import { deriveGeometry, type TableGeometry, type TableParams } from '../config';
import type { MaterialLibrary } from '../materials/library';

/**
 * 台面：**只有一层平面**，没有厚度、没有腔体、没有剖切。
 *
 * 物理场 6 轨、可见窗口 4 轨：
 * - 每条轨是一块独立的平面，窗口覆盖的 4 条才渲染；
 * - 窗口外的轨**直接不画**（`visible = false`），没有任何挡板 / 补面 / 隐藏几何；
 * - 0 / 5 进入窗口时用更暗的一档表面（比常驻 4 轨深），窗口外的 0 / 5 完全不存在；
 * - 分割线、判定带、轨号同样是平面，按窗口权重淡入淡出。
 *
 * 这样做是为了让「隐藏轨」在几何上真的不存在，而不是被一块暗板盖住。
 */

export interface TableBuild {
  group: THREE.Group;
  geometry: TableGeometry;
  /** 4 轨窗口的位置：-1 = 左移一轨，0 = 常态，1 = 右移一轨（可传小数做过渡）。 */
  setWindow(value: number): void;
  dispose(): void;
}

/** 0 / 5 轨在窗口里时的颜色：比常驻 4 轨暗一档。 */
const SHIFT_LANE_COLOR = 0x232c38;
/** 分割线宽度（米）。 */
const DIVIDER_WIDTH = 0.0016;
/** 窗口宽度（轨数）。 */
const WINDOW_LANES = 4;
/** 完全淡出后就不再渲染的门槛。 */
const VISIBLE_EPSILON = 0.004;

/** 窗口值 w 下，第 i 条轨被点亮的比例（0–1）。 */
function laneLit(i: number, w: number): number {
  const left = 0.5 + w;
  const right = 0.5 + w + WINDOW_LANES;
  return THREE.MathUtils.clamp(Math.min(i + 0.5, right) - Math.max(i - 0.5, left), 0, 1);
}

/** 复制一份拉丝贴图引用（repeat 已经和台面一致，不需要再改）。 */
export function cloneBrushed(material: THREE.MeshPhysicalMaterial, source: THREE.MeshPhysicalMaterial): void {
  material.roughnessMap = source.roughnessMap;
  material.normalMap = source.normalMap;
  material.normalScale = source.normalScale?.clone() ?? new THREE.Vector2(0.22, 0.22);
}

export function buildTable(params: TableParams, lib: MaterialLibrary): TableBuild {
  const g = deriveGeometry(params);
  const group = new THREE.Group();
  group.name = 'table';

  const topY = params.tableHeight;
  const createdMaterials: THREE.Material[] = [];

  // —— 6 条轨面：每条一块平面，窗口外的直接不渲染 ——
  const laneMaterials: THREE.MeshPhysicalMaterial[] = [];
  const laneMeshes: THREE.Mesh[] = [];

  for (let lane = 0; lane < 6; lane += 1) {
    const material = lib.topPlate.clone();
    material.transparent = true;
    material.opacity = 0;
    material.depthWrite = true;
    if (lane === 0 || lane === 5) {
      material.color.setHex(SHIFT_LANE_COLOR);
      material.envMapIntensity = 0.8;
    }
    cloneBrushed(material, lib.topPlate);
    createdMaterials.push(material);
    laneMaterials.push(material);

    const geometry = new THREE.PlaneGeometry(g.laneWidth - 0.0015, g.fieldLength);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(g.laneX6[lane]!, topY, g.fieldCenterZ);

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `lane-${lane}`;
    mesh.receiveShadow = true;
    group.add(mesh);
    laneMeshes.push(mesh);
  }

  // —— 5 条分割线 ——
  const dividerMaterials: THREE.MeshBasicMaterial[] = [];
  const dividerMeshes: THREE.Mesh[] = [];
  for (let i = 0; i < 5; i += 1) {
    const material = new THREE.MeshBasicMaterial({
      color: 0x04060a,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    createdMaterials.push(material);
    dividerMaterials.push(material);

    const geometry = new THREE.PlaneGeometry(DIVIDER_WIDTH, g.fieldLength);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(g.dividerX6[i]!, topY + 0.0004, g.fieldCenterZ);

    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 2;
    group.add(mesh);
    dividerMeshes.push(mesh);
  }

  // —— 判定带：三个窗口位置各一条，交叉淡入淡出 ——
  interface BandSlot {
    offset: number;
    halo: THREE.MeshBasicMaterial;
    core: THREE.MeshBasicMaterial;
    haloMesh: THREE.Mesh;
    coreMesh: THREE.Mesh;
  }
  const bandSlots: BandSlot[] = [];
  if (params.showBand) {
    for (const offset of [-1, 0, 1]) {
      const halo = lib.band.clone();
      halo.opacity = 0;
      const core = lib.bandCore.clone();
      core.opacity = 0;
      createdMaterials.push(halo, core);

      const x = offset * g.laneWidth;

      const haloGeometry = new THREE.PlaneGeometry(g.laneWidth * WINDOW_LANES * 0.98, g.bandLength);
      haloGeometry.rotateX(-Math.PI / 2);
      haloGeometry.translate(x, topY + 0.0005, g.bandZ);
      const haloMesh = new THREE.Mesh(haloGeometry, halo);
      haloMesh.renderOrder = 2;
      group.add(haloMesh);

      const coreGeometry = new THREE.PlaneGeometry(g.laneWidth * WINDOW_LANES * 0.96, 0.008);
      coreGeometry.rotateX(-Math.PI / 2);
      coreGeometry.translate(x, topY + 0.0008, g.bandZ);
      const coreMesh = new THREE.Mesh(coreGeometry, core);
      coreMesh.renderOrder = 3;
      group.add(coreMesh);

      bandSlots.push({ offset, halo, core, haloMesh, coreMesh });
    }
  }

  // —— 轨号（调试）：0–5 固定在各自的轨上 ——
  const digitMaterials: THREE.MeshBasicMaterial[] = [];
  const digitMeshes: THREE.Mesh[] = [];
  if (params.showLaneNumbers) {
    g.laneX6.forEach((x, lane) => {
      const material = lib.laneDigits[lane]!.clone();
      material.opacity = 0;
      createdMaterials.push(material);
      digitMaterials.push(material);

      const geometry = new THREE.PlaneGeometry(0.018, 0.018);
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(x, topY + 0.0011, g.nearZ - 0.02);
      const digit = new THREE.Mesh(geometry, material);
      digit.renderOrder = 3;
      group.add(digit);
      digitMeshes.push(digit);
    });
  }

  function setWindow(value: number): void {
    const w = THREE.MathUtils.clamp(value, -1, 1);

    for (let lane = 0; lane < 6; lane += 1) {
      const lit = laneLit(lane, w);
      laneMaterials[lane]!.opacity = lit;
      // 隐藏轨在几何上就不画了。
      laneMeshes[lane]!.visible = lit > VISIBLE_EPSILON;
    }

    for (let i = 0; i < 5; i += 1) {
      const lit = Math.min(laneLit(i, w), laneLit(i + 1, w));
      dividerMaterials[i]!.opacity = lit * 0.72;
      dividerMeshes[i]!.visible = lit > VISIBLE_EPSILON;
    }

    for (const slot of bandSlots) {
      const weight = THREE.MathUtils.clamp(1 - Math.abs(w - slot.offset), 0, 1);
      slot.halo.opacity = weight * 0.3;
      slot.core.opacity = weight * 0.16;
      slot.haloMesh.visible = weight > VISIBLE_EPSILON;
      slot.coreMesh.visible = weight > VISIBLE_EPSILON;
    }

    for (let lane = 0; lane < 6; lane += 1) {
      const material = digitMaterials[lane];
      const mesh = digitMeshes[lane];
      if (!material || !mesh) continue;
      const lit = laneLit(lane, w);
      material.opacity = lit * 0.85;
      mesh.visible = lit > VISIBLE_EPSILON;
    }

  }
  setWindow(0);

  return {
    group,
    geometry: g,
    setWindow,
    dispose(): void {
      group.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
      for (const material of createdMaterials) material.dispose();
      group.clear();
    },
  };
}
