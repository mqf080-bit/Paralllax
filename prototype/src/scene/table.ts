import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { deriveGeometry, type TableGeometry, type TableParams } from '../config';
import type { MaterialLibrary } from '../materials/library';

/**
 * 台面：一块 10m 长的实心板，物理场 6 轨。
 *
 * 可见性按「4 轨窗口」做：
 * - 正常：1–4 亮，0 / 5 被暗色挡板盖住；
 * - 左 shift：0 亮起、4 盖住（窗口整体左移一轨）；
 * - 右 shift：5 亮起、1 盖住。
 *
 * 窗口滑动不是几何体在动，而是**暗色挡板 + 分割线 + 判定带 + 轨号**按窗口权重淡入淡出。
 * 编号 0–5 与台面固定不动。
 */

export interface TableBuild {
  group: THREE.Group;
  geometry: TableGeometry;
  /** 4 轨窗口的位置：-1 = 左移一轨，0 = 常态，1 = 右移一轨（可传小数做过渡）。 */
  setWindow(value: number): void;
  dispose(): void;
}

const PLATE_BEVEL = 0.002;
const CAVITY_DEPTH = 0.075;
const BASE_THICKNESS = 0.008;
/** 右侧剖切沿进深方向的长度（米）。10m 的台面不可能整条边都敞开。 */
const SIDE_CUT_LENGTH = 2.4;
/** 分割线宽度（米）：细到「能数清 4 轨」，粗到不是一道缝。 */
const DIVIDER_WIDTH = 0.0016;
/** 挡板（窗口外的轨面）颜色：几乎灭掉。 */
const SHUTTER_COLOR = 0x121820;
/** 0 / 5 轨进入窗口时的颜色：比常驻轨暗一档。 */
const SHIFT_LANE_COLOR = 0x232c38;
/** 窗口宽度（轨数）。 */
const WINDOW_LANES = 4;

function roundedRect(target: THREE.Shape | THREE.Path, cx: number, cy: number, w: number, h: number, r: number): void {
  const x0 = cx - w / 2;
  const y0 = cy - h / 2;
  const x1 = cx + w / 2;
  const y1 = cy + h / 2;
  const radius = Math.min(r, w / 2, h / 2);

  target.moveTo(x0 + radius, y0);
  target.lineTo(x1 - radius, y0);
  target.absarc(x1 - radius, y0 + radius, radius, -Math.PI / 2, 0, false);
  target.lineTo(x1, y1 - radius);
  target.absarc(x1 - radius, y1 - radius, radius, 0, Math.PI / 2, false);
  target.lineTo(x0 + radius, y1);
  target.absarc(x0 + radius, y1 - radius, radius, Math.PI / 2, Math.PI, false);
  target.lineTo(x0, y0 + radius);
  target.absarc(x0 + radius, y0 + radius, radius, Math.PI, Math.PI * 1.5, false);
  target.closePath();
}

function box(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BoxGeometry {
  const geometry = new THREE.BoxGeometry(w, h, d);
  geometry.translate(x, y, z);
  return geometry;
}

function mergeAll(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (geometries.length === 0) return null;
  const merged = mergeGeometries(geometries, false);
  for (const geometry of geometries) geometry.dispose();
  return merged;
}

/** 窗口值 w 下，第 i 条轨被点亮的比例（0–1）。 */
function laneLit(i: number, w: number): number {
  const left = 0.5 + w;
  const right = 0.5 + w + WINDOW_LANES;
  return THREE.MathUtils.clamp(Math.min(i + 0.5, right) - Math.max(i - 0.5, left), 0, 1);
}

export function buildTable(params: TableParams, lib: MaterialLibrary): TableBuild {
  const g = deriveGeometry(params);
  const group = new THREE.Group();
  group.name = 'table';

  const topY = params.tableHeight;
  const plateBottom = topY - params.plateThickness;
  const cavityTop = plateBottom;
  const cavityBottom = cavityTop - CAVITY_DEPTH;
  const zCenter = (g.nearZ + g.farZ) / 2;

  // —— 顶板：一块整板，没有孔 ——
  const shape = new THREE.Shape();
  roundedRect(shape, 0, zCenter, g.width, g.depth, 0.01);

  const plateGeometry = new THREE.ExtrudeGeometry(shape, {
    depth: params.plateThickness - PLATE_BEVEL * 2,
    bevelEnabled: true,
    bevelThickness: PLATE_BEVEL,
    bevelSize: PLATE_BEVEL,
    bevelSegments: 2,
    curveSegments: 8,
    steps: 1,
  });
  plateGeometry.rotateX(Math.PI / 2);
  plateGeometry.translate(0, topY - PLATE_BEVEL, 0);

  const plate = new THREE.Mesh(plateGeometry, lib.topPlate);
  plate.name = 'plate';
  plate.receiveShadow = true;
  group.add(plate);

  // —— 窗口挡板：窗口外的轨被暗色板盖住 ——
  const shiftMaterials: THREE.Material[] = [];
  const shiftRoughness = lib.brushed.roughnessMap.clone();
  shiftRoughness.repeat.set(3, 3);
  shiftRoughness.needsUpdate = true;
  const shiftNormal = lib.brushed.normalMap.clone();
  shiftNormal.repeat.set(3, 3);
  shiftNormal.needsUpdate = true;

  const shutterMaterials: THREE.MeshStandardMaterial[] = [];
  const shutterMeshes: THREE.Mesh[] = [];
  for (let lane = 0; lane < 6; lane += 1) {
    const material = new THREE.MeshStandardMaterial({
      color: SHUTTER_COLOR,
      metalness: 0.45,
      roughness: 0.52,
      envMapIntensity: 0.75,
      transparent: true,
      opacity: 1,
    });
    material.roughnessMap = shiftRoughness;
    material.normalMap = shiftNormal;
    material.normalScale = new THREE.Vector2(0.22, 0.22);
    shiftMaterials.push(material);
    shutterMaterials.push(material);

    const geometry = new THREE.PlaneGeometry(g.laneWidth, g.fieldLength);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(g.laneX6[lane]!, topY + 0.00018, g.fieldCenterZ);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `shift-shutter-${lane}`;
    mesh.receiveShadow = true;
    group.add(mesh);
    shutterMeshes.push(mesh);
  }

  // —— 0 / 5 轨进入窗口时用更暗的一层表面：它们永远比常驻轨深一档 ——
  const shiftLaneMaterials: THREE.MeshStandardMaterial[] = [];
  const shiftLaneMeshes: THREE.Mesh[] = [];
  for (const lane of [0, 5]) {
    const material = new THREE.MeshStandardMaterial({
      color: SHIFT_LANE_COLOR,
      metalness: 0.45,
      roughness: 0.5,
      envMapIntensity: 0.8,
      transparent: true,
      opacity: 0,
    });
    material.roughnessMap = shiftRoughness;
    material.normalMap = shiftNormal;
    material.normalScale = new THREE.Vector2(0.22, 0.22);
    shiftMaterials.push(material);
    shiftLaneMaterials.push(material);

    const geometry = new THREE.PlaneGeometry(g.laneWidth, g.fieldLength);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(g.laneX6[lane]!, topY + 0.00024, g.fieldCenterZ);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    group.add(mesh);
    shiftLaneMeshes.push(mesh);
  }

  // —— 5 条分割线：只有夹在窗口里的那几条亮 ——
  const dividerMaterials: THREE.MeshBasicMaterial[] = [];
  for (let i = 0; i < 5; i += 1) {
    const material = new THREE.MeshBasicMaterial({
      color: 0x04060a,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    shiftMaterials.push(material);
    dividerMaterials.push(material);

    const geometry = new THREE.PlaneGeometry(DIVIDER_WIDTH, g.fieldLength);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(g.dividerX6[i]!, topY + 0.0006, g.fieldCenterZ);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 2;
    group.add(mesh);
  }

  // —— 判定带：三个窗口位置各一条，交叉淡入淡出 ——
  interface BandSlot {
    offset: number;
    halo: THREE.MeshBasicMaterial;
    core: THREE.MeshBasicMaterial;
  }
  const bandSlots: BandSlot[] = [];
  if (params.showBand) {
    for (const offset of [-1, 0, 1]) {
      const halo = lib.band.clone();
      halo.opacity = 0;
      const core = lib.bandCore.clone();
      core.opacity = 0;
      shiftMaterials.push(halo, core);

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

      bandSlots.push({ offset, halo, core });
    }
  }

  // —— 轨号（调试）：0–5 固定在各自的轨上 ——
  const digitMaterials: THREE.MeshBasicMaterial[] = [];
  if (params.showLaneNumbers) {
    g.laneX6.forEach((x, lane) => {
      const material = lib.laneDigits[lane]!.clone();
      material.opacity = 0;
      shiftMaterials.push(material);
      digitMaterials.push(material);

      const geometry = new THREE.PlaneGeometry(0.018, 0.018);
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(x, topY + 0.0011, g.nearZ - 0.02);
      const digit = new THREE.Mesh(geometry, material);
      digit.renderOrder = 3;
      group.add(digit);
    });
  }

  function setWindow(value: number): void {
    const w = THREE.MathUtils.clamp(value, -1, 1);

    for (let lane = 0; lane < 6; lane += 1) {
      const lit = laneLit(lane, w);
      shutterMaterials[lane]!.opacity = 1 - lit;
      shutterMeshes[lane]!.visible = lit < 0.995;
    }

    for (let i = 0; i < shiftLaneMaterials.length; i += 1) {
      const lane = i === 0 ? 0 : 5;
      const lit = laneLit(lane, w);
      shiftLaneMaterials[i]!.opacity = lit;
      shiftLaneMeshes[i]!.visible = lit > 0.005;
    }

    for (let i = 0; i < 5; i += 1) {
      dividerMaterials[i]!.opacity = Math.min(laneLit(i, w), laneLit(i + 1, w)) * 0.72;
    }

    for (const slot of bandSlots) {
      const weight = THREE.MathUtils.clamp(1 - Math.abs(w - slot.offset), 0, 1);
      slot.halo.opacity = weight * 0.3;
      slot.core.opacity = weight * 0.16;
    }

    for (let lane = 0; lane < 6; lane += 1) {
      const material = digitMaterials[lane];
      if (material) material.opacity = laneLit(lane, w) * 0.85;
    }
  }
  setWindow(0);

  // —— 剖切腔体 ——
  const skinParts: THREE.BufferGeometry[] = [];
  skinParts.push(box(0.012, CAVITY_DEPTH, g.depth - 0.012, -g.width / 2 + 0.006, cavityBottom + CAVITY_DEPTH / 2, zCenter));
  skinParts.push(box(g.width - 0.012, CAVITY_DEPTH, 0.012, 0, cavityBottom + CAVITY_DEPTH / 2, g.farZ + 0.006));

  const rightWallLength = g.depth - SIDE_CUT_LENGTH - 0.012;
  if (rightWallLength > 0) {
    skinParts.push(
      box(
        0.012,
        CAVITY_DEPTH,
        rightWallLength,
        g.width / 2 - 0.006,
        cavityBottom + CAVITY_DEPTH / 2,
        g.farZ + rightWallLength / 2 + 0.006,
      ),
    );
  }

  skinParts.push(box(g.width - 0.024, BASE_THICKNESS, g.depth - 0.024, 0, cavityBottom + BASE_THICKNESS / 2, zCenter));

  const skinGeometry = mergeAll(skinParts);
  if (skinGeometry) {
    const skin = new THREE.Mesh(skinGeometry, lib.cavity);
    skin.name = 'cavity-skin';
    group.add(skin);
  }

  const innerParts: THREE.BufferGeometry[] = [];
  const deckY = cavityBottom + 0.034;
  innerParts.push(box(g.width - 0.05, 0.006, g.depth * 0.42, 0, deckY, g.farZ + g.depth * 0.24));
  innerParts.push(box(g.width * 0.32, 0.006, 1.4, g.width * 0.16, deckY, g.nearZ - 1.5));

  const ribBottom = cavityBottom + BASE_THICKNESS;
  const ribHeight = cavityTop - ribBottom - 0.004;
  for (const x of [-g.width * 0.33, 0, g.width * 0.33]) {
    innerParts.push(box(0.014, ribHeight, g.depth - 0.06, x, ribBottom + ribHeight / 2, zCenter));
  }
  for (const z of [g.nearZ - 0.9, g.nearZ - 2.2, g.nearZ - 4.6, g.nearZ - 7.2]) {
    innerParts.push(box(g.width - 0.06, 0.028, 0.012, 0, cavityTop - 0.024, z));
  }

  const innerGeometry = mergeAll(innerParts);
  if (innerGeometry) {
    const inner = new THREE.Mesh(innerGeometry, lib.rib);
    inner.name = 'cavity-structure';
    group.add(inner);
  }

  const edgeParts: THREE.BufferGeometry[] = [];
  const frame = 0.006;
  const cutEndZ = g.nearZ - SIDE_CUT_LENGTH;

  edgeParts.push(box(g.width, frame, frame, 0, cavityTop - frame / 2, g.nearZ - frame / 2));
  edgeParts.push(box(g.width, frame, frame, 0, cavityBottom + frame / 2, g.nearZ - frame / 2));
  edgeParts.push(box(frame, CAVITY_DEPTH, frame, -g.width / 2 + frame / 2, cavityBottom + CAVITY_DEPTH / 2, g.nearZ - frame / 2));
  edgeParts.push(box(frame, CAVITY_DEPTH, frame, g.width / 2 - frame / 2, cavityBottom + CAVITY_DEPTH / 2, g.nearZ - frame / 2));

  edgeParts.push(box(frame, frame, SIDE_CUT_LENGTH, g.width / 2 - frame / 2, cavityTop - frame / 2, g.nearZ - SIDE_CUT_LENGTH / 2));
  edgeParts.push(box(frame, frame, SIDE_CUT_LENGTH, g.width / 2 - frame / 2, cavityBottom + frame / 2, g.nearZ - SIDE_CUT_LENGTH / 2));
  edgeParts.push(box(frame, CAVITY_DEPTH, frame, g.width / 2 - frame / 2, cavityBottom + CAVITY_DEPTH / 2, cutEndZ + frame / 2));

  for (const x of [-g.width * 0.33, 0, g.width * 0.33]) {
    edgeParts.push(box(0.015, ribHeight, 0.0025, x, ribBottom + ribHeight / 2, g.nearZ - 0.0012));
  }
  edgeParts.push(box(g.width - 0.024, 0.0025, 0.0025, 0, cavityBottom + BASE_THICKNESS / 2, g.nearZ - 0.0012));

  const edgeGeometry = mergeAll(edgeParts);
  if (edgeGeometry) {
    const edges = new THREE.Mesh(edgeGeometry, lib.machinedEdge);
    edges.name = 'cut-edges';
    group.add(edges);
  }

  return {
    group,
    geometry: g,
    setWindow,
    dispose(): void {
      group.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
      for (const material of shiftMaterials) material.dispose();
      shiftRoughness.dispose();
      shiftNormal.dispose();
      group.clear();
    },
  };
}
