import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { deriveGeometry, type TableGeometry, type TableParams } from '../config';
import type { MaterialLibrary } from '../materials/library';

/**
 * 台面：一块 10m 长的实心板，4 条轨，没有凹槽、没有边框。
 *
 * 读过第二版反馈之后的取舍：
 * - 凹槽全部取消，轨与轨之间只用一条 1.6mm 的暗线分隔。
 * - 台面宽度 ≈ 4 轨，左右只留 4mm 倒角余量。
 * - 板下仍然是剖切的：近端整面 + 右侧靠玩家的一段敞开，露出层与筋。
 *
 * 判定带（5.1）依旧是贴在台面上的一段光带，位置固定。
 */

export interface TableBuild {
  group: THREE.Group;
  geometry: TableGeometry;
  /** shift 的过渡值 0–1：0 = 0/5 轨不存在，1 = 完全淡入。 */
  setShift(value: number): void;
  dispose(): void;
}

const PLATE_BEVEL = 0.002;
const CAVITY_DEPTH = 0.075;
const BASE_THICKNESS = 0.008;
/** 右侧剖切沿进深方向的长度（米）。10m 的台面不可能整条边都敞开。 */
const SIDE_CUT_LENGTH = 2.4;
/** 分割线宽度（米）：细到「能数清 4 轨」，粗到不是一道缝。 */
const DIVIDER_WIDTH = 0.0016;

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
  // ExtrudeGeometry 的 bevel 会向 z 两端各多长出一段，所以深度要减掉两头、再整体下移。
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

  // —— 4 轨之间的分割线 ——
  const dividerGeometries = g.dividerX.map((x) => {
    const plane = new THREE.PlaneGeometry(DIVIDER_WIDTH, g.fieldLength);
    plane.rotateX(-Math.PI / 2);
    plane.translate(x, topY + 0.0006, g.fieldCenterZ);
    return plane;
  });
  const dividerGeometry = mergeAll(dividerGeometries);
  if (dividerGeometry) {
    const dividers = new THREE.Mesh(dividerGeometry, lib.divider);
    dividers.name = 'lane-dividers';
    dividers.renderOrder = 2;
    group.add(dividers);
  }

  // —— 判定带：台面上的一段冷白光带，静态 ——
  if (params.showBand) {
    const halo = new THREE.PlaneGeometry(g.width * 0.98, g.bandLength);
    halo.rotateX(-Math.PI / 2);
    halo.translate(0, topY + 0.0005, g.bandZ);
    const haloMesh = new THREE.Mesh(halo, lib.band);
    haloMesh.name = 'judgement-band-halo';
    haloMesh.renderOrder = 2;
    group.add(haloMesh);

    const core = new THREE.PlaneGeometry(g.width * 0.96, 0.008);
    core.rotateX(-Math.PI / 2);
    core.translate(0, topY + 0.0008, g.bandZ);
    const coreMesh = new THREE.Mesh(core, lib.bandCore);
    coreMesh.name = 'judgement-band-core';
    coreMesh.renderOrder = 3;
    group.add(coreMesh);
  }

  // —— 轨号（调试）——
  if (params.showLaneNumbers) {
    g.laneX.forEach((x, lane) => {
      const plane = new THREE.PlaneGeometry(0.018, 0.018);
      plane.rotateX(-Math.PI / 2);
      plane.translate(x, topY + 0.0011, g.nearZ - 0.02);
      // 轨号沿用谱面层的编号：默认显示 1–4。
      const digit = new THREE.Mesh(plane, lib.laneDigits[lane + 1]!);
      digit.name = `lane-number-${lane}`;
      digit.renderOrder = 3;
      group.add(digit);
    });
  }

  // —— 剖切腔体 ——
  // 外壳：左侧与远端封闭；右侧只保留远端（靠玩家的一段切开）。
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

  // 承力底板。
  skinParts.push(box(g.width - 0.024, BASE_THICKNESS, g.depth - 0.024, 0, cavityBottom + BASE_THICKNESS / 2, zCenter));

  const skinGeometry = mergeAll(skinParts);
  if (skinGeometry) {
    const skin = new THREE.Mesh(skinGeometry, lib.cavity);
    skin.name = 'cavity-skin';
    group.add(skin);
  }

  // 中层甲板 + 纵筋 + 横梁：剖切里能读出来的「层」。
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

  // 剖切面倒角框：把两个开口框出来。
  const edgeParts: THREE.BufferGeometry[] = [];
  const frame = 0.006;
  const cutEndZ = g.nearZ - SIDE_CUT_LENGTH;

  // 近端整面敞开。
  edgeParts.push(box(g.width, frame, frame, 0, cavityTop - frame / 2, g.nearZ - frame / 2));
  edgeParts.push(box(g.width, frame, frame, 0, cavityBottom + frame / 2, g.nearZ - frame / 2));
  edgeParts.push(box(frame, CAVITY_DEPTH, frame, -g.width / 2 + frame / 2, cavityBottom + CAVITY_DEPTH / 2, g.nearZ - frame / 2));
  edgeParts.push(box(frame, CAVITY_DEPTH, frame, g.width / 2 - frame / 2, cavityBottom + CAVITY_DEPTH / 2, g.nearZ - frame / 2));

  // 右侧靠玩家的一段。
  edgeParts.push(box(frame, frame, SIDE_CUT_LENGTH, g.width / 2 - frame / 2, cavityTop - frame / 2, g.nearZ - SIDE_CUT_LENGTH / 2));
  edgeParts.push(box(frame, frame, SIDE_CUT_LENGTH, g.width / 2 - frame / 2, cavityBottom + frame / 2, g.nearZ - SIDE_CUT_LENGTH / 2));
  edgeParts.push(box(frame, CAVITY_DEPTH, frame, g.width / 2 - frame / 2, cavityBottom + CAVITY_DEPTH / 2, cutEndZ + frame / 2));

  // 切面上的断面端头：筋 / 底板。
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

  // —— shift 轨：0 / 5 ——
  // 平时不存在，shift 时淡入。颜色比常住的 4 轨暗一档，本身就是状态标识。
  const shiftMaterials: THREE.Material[] = [];
  const shiftMeshes: THREE.Mesh[] = [];

  const shiftLaneMaterial = new THREE.MeshStandardMaterial({
    color: 0x1c2430,
    metalness: 0.45,
    roughness: 0.52,
    envMapIntensity: 0.7,
    transparent: true,
    opacity: 0,
  });
  shiftMaterials.push(shiftLaneMaterial);

  // 拉丝贴图沿用台面的：多出来的轨也要是「同一块材料，只是更暗」。
  const shiftRoughness = lib.brushed.roughnessMap.clone();
  shiftRoughness.repeat.set(3, 3);
  shiftRoughness.needsUpdate = true;
  const shiftNormal = lib.brushed.normalMap.clone();
  shiftNormal.repeat.set(3, 3);
  shiftNormal.needsUpdate = true;
  shiftLaneMaterial.roughnessMap = shiftRoughness;
  shiftLaneMaterial.normalMap = shiftNormal;
  shiftLaneMaterial.normalScale = new THREE.Vector2(0.22, 0.22);

  const shiftDividerMaterial = new THREE.MeshBasicMaterial({
    color: 0x04060a,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  shiftMaterials.push(shiftDividerMaterial);

  const shiftBandMaterial = lib.band.clone();
  shiftBandMaterial.opacity = 0;
  shiftMaterials.push(shiftBandMaterial);

  const shiftBandCoreMaterial = lib.bandCore.clone();
  shiftBandCoreMaterial.opacity = 0;
  shiftMaterials.push(shiftBandCoreMaterial);

  const shiftDigitMaterials: THREE.MeshBasicMaterial[] = [];
  if (params.showLaneNumbers) {
    for (const digit of [0, 5]) {
      const material = lib.laneDigits[digit]!.clone();
      material.opacity = 0;
      shiftDigitMaterials.push(material);
      shiftMaterials.push(material);
    }
  }

  const outerLaneCenters = [-1, 1].map((side) => side * (g.width / 2 + g.laneWidth / 2));
  const outerLaneWidth = g.laneWidth - 0.002;

  outerLaneCenters.forEach((x, index) => {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(outerLaneWidth, 0.01, g.fieldLength), shiftLaneMaterial);
    strip.name = `shift-lane-${index === 0 ? 0 : 5}`;
    strip.position.set(x, topY - 0.005, g.fieldCenterZ);
    strip.receiveShadow = true;
    group.add(strip);
    shiftMeshes.push(strip);

    // 与常驻台面之间的分界线。
    const divider = new THREE.PlaneGeometry(DIVIDER_WIDTH, g.fieldLength);
    divider.rotateX(-Math.PI / 2);
    divider.translate(Math.sign(x) * (g.width / 2 + 0.001), topY + 0.0006, g.fieldCenterZ);
    const dividerMesh = new THREE.Mesh(divider, shiftDividerMaterial);
    dividerMesh.renderOrder = 2;
    group.add(dividerMesh);
    shiftMeshes.push(dividerMesh);

    if (params.showBand) {
      const halo = new THREE.PlaneGeometry(outerLaneWidth * 0.98, g.bandLength);
      halo.rotateX(-Math.PI / 2);
      halo.translate(x, topY + 0.0005, g.bandZ);
      const haloMesh = new THREE.Mesh(halo, shiftBandMaterial);
      haloMesh.renderOrder = 2;
      group.add(haloMesh);
      shiftMeshes.push(haloMesh);

      const core = new THREE.PlaneGeometry(outerLaneWidth * 0.94, 0.008);
      core.rotateX(-Math.PI / 2);
      core.translate(x, topY + 0.0008, g.bandZ);
      const coreMesh = new THREE.Mesh(core, shiftBandCoreMaterial);
      coreMesh.renderOrder = 3;
      group.add(coreMesh);
      shiftMeshes.push(coreMesh);
    }

    if (params.showLaneNumbers) {
      const digit = new THREE.PlaneGeometry(0.018, 0.018);
      digit.rotateX(-Math.PI / 2);
      digit.translate(x, topY + 0.0011, g.nearZ - 0.02);
      const digitMesh = new THREE.Mesh(digit, shiftDigitMaterials[index]!);
      digitMesh.renderOrder = 3;
      group.add(digitMesh);
      shiftMeshes.push(digitMesh);
    }
  });

  function setShift(value: number): void {
    const t = THREE.MathUtils.clamp(value, 0, 1);
    shiftLaneMaterial.opacity = t * 0.85;
    shiftDividerMaterial.opacity = t * 0.72;
    shiftBandMaterial.opacity = t * 0.3;
    shiftBandCoreMaterial.opacity = t * 0.16;
    for (const material of shiftDigitMaterials) material.opacity = t * 0.85;
    for (const mesh of shiftMeshes) mesh.visible = t > 0.002;
  }
  setShift(0);

  return {
    group,
    geometry: g,
    setShift,
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
