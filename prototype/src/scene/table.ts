import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { deriveGeometry, type TableGeometry, type TableParams } from '../config';
import type { MaterialLibrary } from '../materials/library';

/**
 * 台面：6 条铣出的导轨槽 + 轨间凸起导轨 + 近端/右侧剖切。
 *
 * 五条硬性限制里，这一层直接相关的是：
 * - 判定带相对槽底不动（5.1）：判定带是贴槽底的一段发光面，不随任何东西动。
 * - 可打区无障碍物（5.2）：台面上除了槽、导轨、盖板，没有任何「看起来可打」的东西。
 *
 * 尺寸全部从 TableParams 派生，重建时整组换掉，材质与贴图复用。
 */

export interface TableBuild {
  group: THREE.Group;
  geometry: TableGeometry;
  dispose(): void;
}

const PLATE_BEVEL = 0.002;
const FLOOR_THICKNESS = 0.006;
const CAVITY_DEPTH = 0.09;
const BASE_THICKNESS = 0.008;
/** 判定带在 z 方向的厚度（米）。 */
const BAND_THICKNESS = 0.16;
/** 槽口 AO 带的宽度（米）。 */
const RIM_BAND = 0.012;

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
  const plateThickness = params.slotDepth;
  const floorTop = topY - plateThickness;
  const cavityTop = floorTop - FLOOR_THICKNESS;
  const cavityBottom = cavityTop - CAVITY_DEPTH;
  const zCenter = (g.nearZ + g.farZ) / 2;

  // —— 顶板：外轮廓 + 6 个槽孔 ——
  // 形状坐标系 (x, y) 经过 rotateX(+90°) 后 y 直接映射到世界 z，挤出方向朝下。
  const outer = new THREE.Shape();
  roundedRect(outer, 0, zCenter, g.width, g.depth, 0.01);

  const holes = g.laneX.map((x) => {
    const hole = new THREE.Path();
    roundedRect(hole, x, g.slotCenterZ, params.slotWidth, g.slotLength, 0.008);
    return hole;
  });
  outer.holes.push(...holes);

  // 注意：ExtrudeGeometry 的 bevel 会向 z 两端各多长出一段 bevelThickness。
  // 所以挤出深度要减掉两头，再把几何体往下挪一段，顶面才真正落在 topY。
  const plateGeometry = new THREE.ExtrudeGeometry(outer, {
    depth: plateThickness - PLATE_BEVEL * 2,
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
  group.add(plate);

  // —— 槽底：一整块连续板，同时充当腔体顶盖 ——
  const floor = new THREE.Mesh(
    box(g.width - 0.02, FLOOR_THICKNESS, g.depth - 0.02, 0, floorTop - FLOOR_THICKNESS / 2, zCenter),
    lib.slotFloor,
  );
  floor.name = 'slot-floor';
  group.add(floor);

  // —— 槽内壁衬板：比顶板暗，负责把槽「压下去」——
  const wallGeometries: THREE.BufferGeometry[] = [];
  const wallHeight = plateThickness - 0.0015;
  const wallY = topY - 0.0015 - wallHeight / 2;
  for (const x of g.laneX) {
    const halfW = params.slotWidth / 2 - 0.0004;
    const halfL = g.slotLength / 2 - 0.0004;
    wallGeometries.push(
      box(0.0012, wallHeight, g.slotLength, x - halfW, wallY, g.slotCenterZ),
      box(0.0012, wallHeight, g.slotLength, x + halfW, wallY, g.slotCenterZ),
      box(params.slotWidth, wallHeight, 0.0012, x, wallY, g.slotCenterZ - halfL),
      box(params.slotWidth, wallHeight, 0.0012, x, wallY, g.slotCenterZ + halfL),
    );
  }
  const wallGeometry = mergeAll(wallGeometries);
  if (wallGeometry) {
    const walls = new THREE.Mesh(wallGeometry, lib.slotWall);
    walls.name = 'slot-walls';
    group.add(walls);
  }

  // —— 隐藏轨的盲板：默认盖住 0 / 5 ——
  if (!params.revealHidden) {
    const hiddenLanes = g.laneX.map((_, i) => i).filter((i) => !g.visibleLanes.includes(i));
    const coverGeometries = hiddenLanes.map((lane) => {
      const shape = new THREE.Shape();
      roundedRect(shape, g.laneX[lane]!, g.slotCenterZ, params.slotWidth + 0.006, g.slotLength + 0.006, 0.009);
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: 0.0012,
        bevelEnabled: true,
        bevelThickness: 0.0004,
        bevelSize: 0.0004,
        bevelSegments: 1,
        curveSegments: 6,
      });
      geometry.rotateX(Math.PI / 2);
      geometry.translate(0, topY + 0.0016, 0);
      return geometry;
    });
    const coverGeometry = mergeAll(coverGeometries);
    if (coverGeometry) {
      // 盖板底下先垫一圈板缝，让「这块能拆」读得出来。
      const seamGeometries = hiddenLanes.map((lane) => {
        const plane = new THREE.PlaneGeometry(params.slotWidth + 0.016, g.slotLength + 0.016);
        plane.rotateX(-Math.PI / 2);
        plane.translate(g.laneX[lane]!, topY + 0.0006, g.slotCenterZ);
        return plane;
      });
      const seamGeometry = mergeAll(seamGeometries);
      if (seamGeometry) {
        const seam = new THREE.Mesh(seamGeometry, lib.seam);
        seam.name = 'blanking-seams';
        seam.renderOrder = 1;
        group.add(seam);
      }

      const covers = new THREE.Mesh(coverGeometry, lib.blankingPlate);
      covers.name = 'blanking-plates';
      covers.renderOrder = 2;
      group.add(covers);
    }
  }

  // —— 轨间凸起导轨 + 镜面倒角条 ——
  if (params.railHeight > 0.0002) {
    const railWidth = Math.min(0.018, params.lanePitch - params.slotWidth - 0.006);
    if (railWidth > 0.004) {
      const railGeometries: THREE.BufferGeometry[] = [];
      const chamferGeometries: THREE.BufferGeometry[] = [];
      for (let i = 0; i < g.laneX.length - 1; i += 1) {
        const x = (g.laneX[i]! + g.laneX[i + 1]!) / 2;
        railGeometries.push(box(railWidth, params.railHeight, g.slotLength, x, topY + params.railHeight / 2, g.slotCenterZ));
        chamferGeometries.push(
          box(railWidth * 0.4, 0.0007, g.slotLength - 0.002, x, topY + params.railHeight + 0.00035, g.slotCenterZ),
        );
      }
      const railGeometry = mergeAll(railGeometries);
      if (railGeometry) {
        const rails = new THREE.Mesh(railGeometry, lib.rail);
        rails.name = 'rails';
        group.add(rails);
      }
      const chamferGeometry = mergeAll(chamferGeometries);
      if (chamferGeometry) {
        const chamfers = new THREE.Mesh(chamferGeometry, lib.railChamfer);
        chamfers.name = 'rail-chamfers';
        group.add(chamfers);
      }
    }
  }

  // —— 槽口 AO：贴着台面的渐变带，把槽沿压暗 ——
  // 四条边各一条；u=0 是暗端，靠旋转把暗端始终朝向槽内。
  const aoGeometries: THREE.BufferGeometry[] = [];
  for (const lane of g.visibleLanes) {
    const x = g.laneX[lane]!;
    const halfW = params.slotWidth / 2;
    const halfL = g.slotLength / 2;
    const rimY = topY + 0.0004;

    const strips: Array<{ cx: number; cz: number; w: number; l: number; angle: number }> = [
      { cx: x - halfW - RIM_BAND / 2, cz: g.slotCenterZ, w: RIM_BAND, l: g.slotLength, angle: Math.PI },
      { cx: x + halfW + RIM_BAND / 2, cz: g.slotCenterZ, w: RIM_BAND, l: g.slotLength, angle: 0 },
      { cx: x, cz: g.slotCenterZ + halfL + RIM_BAND / 2, w: RIM_BAND, l: params.slotWidth + 0.012, angle: -Math.PI / 2 },
      { cx: x, cz: g.slotCenterZ - halfL - RIM_BAND / 2, w: RIM_BAND, l: params.slotWidth + 0.012, angle: Math.PI / 2 },
    ];

    for (const strip of strips) {
      const plane = new THREE.PlaneGeometry(strip.w, strip.l);
      plane.rotateX(-Math.PI / 2);
      plane.rotateY(strip.angle);
      plane.translate(strip.cx, rimY, strip.cz);
      aoGeometries.push(plane);
    }
  }
  const aoGeometry = mergeAll(aoGeometries);
  if (aoGeometry) {
    const ao = new THREE.Mesh(aoGeometry, lib.edgeFade);
    ao.name = 'slot-rim-ao';
    ao.renderOrder = 1;
    group.add(ao);
  }

  // —— 判定带：槽底被照亮的一段带，静态，贴槽底 ——
  // 两层：柔光晕 + 细芯线。只有这么多——它不是「浮线」，也不参与演出。
  if (params.showBand) {
    const haloGeometries: THREE.BufferGeometry[] = [];
    const coreGeometries: THREE.BufferGeometry[] = [];
    for (const lane of g.visibleLanes) {
      const halo = new THREE.PlaneGeometry(params.slotWidth, BAND_THICKNESS);
      halo.rotateX(-Math.PI / 2);
      halo.translate(g.laneX[lane]!, floorTop + 0.0004, g.bandZ);
      haloGeometries.push(halo);

      const core = new THREE.PlaneGeometry(params.slotWidth - 0.02, 0.009);
      core.rotateX(-Math.PI / 2);
      core.translate(g.laneX[lane]!, floorTop + 0.0007, g.bandZ);
      coreGeometries.push(core);
    }

    const haloGeometry = mergeAll(haloGeometries);
    if (haloGeometry) {
      const halo = new THREE.Mesh(haloGeometry, lib.band);
      halo.name = 'judgement-band-halo';
      halo.renderOrder = 2;
      group.add(halo);
    }

    const coreGeometry = mergeAll(coreGeometries);
    if (coreGeometry) {
      const core = new THREE.Mesh(coreGeometry, lib.bandCore);
      core.name = 'judgement-band-core';
      core.renderOrder = 3;
      group.add(core);
    }
  }

  // —— 剖切腔体：近端 + 右侧敞开，露出层叠与驱动结构 ——
  // 三层：顶板（带槽）→ 槽底板 → 腔体（中层甲板 + 纵筋 + 轴承）→ 承力底板。
  // 只有「层」读得出来，剖切才不是「一个空盒子」。
  const cutParts: THREE.BufferGeometry[] = [];

  // 外壳：左侧、远端、右侧的远半段封闭；只有近端与右侧近半段被剖开。
  cutParts.push(box(0.012, CAVITY_DEPTH, g.depth - 0.012, -g.width / 2 + 0.006, cavityBottom + CAVITY_DEPTH / 2, zCenter));
  cutParts.push(box(g.width - 0.012, CAVITY_DEPTH, 0.012, 0, cavityBottom + CAVITY_DEPTH / 2, g.farZ + 0.006));
  cutParts.push(box(0.012, CAVITY_DEPTH, g.depth / 2 - 0.012, g.width / 2 - 0.006, cavityBottom + CAVITY_DEPTH / 2, g.farZ + g.depth / 4));

  // 承力底板。
  cutParts.push(box(g.width - 0.024, BASE_THICKNESS, g.depth - 0.024, 0, cavityBottom + BASE_THICKNESS / 2, zCenter));

  const cutSkinGeometry = mergeAll(cutParts);
  if (cutSkinGeometry) {
    const skin = new THREE.Mesh(cutSkinGeometry, lib.cavity);
    skin.name = 'cavity-skin';
    group.add(skin);
  }

  // 中层甲板：从开口看进去的第二层。
  const deckY = cavityBottom + 0.038;
  const deckParts: THREE.BufferGeometry[] = [];
  deckParts.push(box(g.width - 0.06, 0.006, 0.52, 0, deckY, g.farZ + 0.46));
  deckParts.push(box(g.width * 0.34, 0.006, 0.42, g.width * 0.2, deckY, zCenter + 0.1));
  for (const x of [-0.42, 0.12]) {
    deckParts.push(box(0.01, deckY - (cavityBottom + BASE_THICKNESS), 0.52, x, (deckY + cavityBottom + BASE_THICKNESS) / 2, g.farZ + 0.46));
  }
  const deckGeometry = mergeAll(deckParts);
  if (deckGeometry) {
    const deck = new THREE.Mesh(deckGeometry, lib.machinedEdge);
    deck.name = 'cavity-deck';
    group.add(deck);
  }

  // 纵向筋：从底板撑到槽底板，端面在近端开口处露出来。
  const ribParts: THREE.BufferGeometry[] = [];
  const ribBottom = cavityBottom + BASE_THICKNESS;
  const ribHeight = cavityTop - ribBottom - 0.004;
  for (const x of [-0.5, -0.17, 0.17, 0.5]) {
    ribParts.push(box(0.014, ribHeight, g.depth - 0.05, x, ribBottom + ribHeight / 2, zCenter));
  }
  // 横向梁。
  for (const z of [g.farZ + 0.36, zCenter - 0.1]) {
    ribParts.push(box(g.width - 0.06, 0.03, 0.012, 0, cavityTop - 0.026, z));
  }
  const ribGeometry = mergeAll(ribParts);
  if (ribGeometry) {
    const ribs = new THREE.Mesh(ribGeometry, lib.rib);
    ribs.name = 'cavity-ribs';
    group.add(ribs);
  }

  // 驱动：轴承座 + 轴，放在中层甲板上，靠近近端开口。
  const steelParts: THREE.BufferGeometry[] = [];
  for (const x of [-0.32, 0, 0.32]) {
    steelParts.push(box(0.046, 0.036, 0.028, x, deckY + 0.021, g.farZ + 0.36));
    const shaft = new THREE.CylinderGeometry(0.009, 0.009, 0.062, 12);
    shaft.rotateZ(Math.PI / 2);
    shaft.translate(x, deckY + 0.021, g.farZ + 0.36);
    steelParts.push(shaft);
  }
  const steelGeometry = mergeAll(steelParts);
  if (steelGeometry) {
    const drives = new THREE.Mesh(steelGeometry, lib.steel);
    drives.name = 'drives';
    group.add(drives);
  }

  // 走线：贴着底板走，从远端到近端开口。
  const wireParts: THREE.BufferGeometry[] = [];
  for (const [index, x] of [-0.26, 0.06, 0.3].entries()) {
    const points: THREE.Vector3[] = [];
    const segments = 7;
    for (let i = 0; i <= segments; i += 1) {
      const t = i / segments;
      const z = g.farZ + 0.1 + (g.nearZ - 0.08 - (g.farZ + 0.1)) * t;
      const wobble = Math.sin(t * Math.PI * (2 + index)) * 0.012;
      points.push(new THREE.Vector3(x + wobble, cavityBottom + 0.018 + (index === 1 ? 0.004 : 0), z));
    }
    const curve = new THREE.CatmullRomCurve3(points);
    wireParts.push(new THREE.TubeGeometry(curve, 56, 0.0038, 5, false));
  }
  const wireGeometry = mergeAll(wireParts);
  if (wireGeometry) {
    const wires = new THREE.Mesh(wireGeometry, lib.wire);
    wires.name = 'wiring';
    group.add(wires);
  }

  // 剖切面的倒角框：把两个开口「框」出来，读成切开的截面，而不是缺了一块。
  const edgeParts: THREE.BufferGeometry[] = [];
  const frame = 0.006;
  const nearHalfZ = g.nearZ - g.depth / 4;

  // 近端开口：整面敞开。
  edgeParts.push(box(g.width, frame, frame, 0, cavityTop - frame / 2, g.nearZ - frame / 2));
  edgeParts.push(box(g.width, frame, frame, 0, cavityBottom + frame / 2, g.nearZ - frame / 2));
  edgeParts.push(box(frame, CAVITY_DEPTH, frame, -g.width / 2 + frame / 2, cavityBottom + CAVITY_DEPTH / 2, g.nearZ - frame / 2));
  edgeParts.push(box(frame, CAVITY_DEPTH, frame, g.width / 2 - frame / 2, cavityBottom + CAVITY_DEPTH / 2, g.nearZ - frame / 2));

  // 右侧开口：只有近半段被切开。
  edgeParts.push(box(frame, frame, g.depth / 2, g.width / 2 - frame / 2, cavityTop - frame / 2, nearHalfZ));
  edgeParts.push(box(frame, frame, g.depth / 2, g.width / 2 - frame / 2, cavityBottom + frame / 2, nearHalfZ));
  // 切口在哪收住的立边。
  edgeParts.push(box(frame, CAVITY_DEPTH, frame, g.width / 2 - frame / 2, cavityBottom + CAVITY_DEPTH / 2, zCenter + frame / 2));

  // 切面上的端头：筋、甲板、底板的断面。有了这三样，开口才像「切开」而不是「缺一块」。
  for (const x of [-0.5, -0.17, 0.17, 0.5]) {
    edgeParts.push(box(0.015, ribHeight, 0.0025, x, ribBottom + ribHeight / 2, g.nearZ - 0.0012));
  }
  edgeParts.push(box(g.width - 0.06, 0.007, 0.0025, g.width * 0.2, deckY, g.nearZ - 0.0012));
  edgeParts.push(box(g.width - 0.024, 0.0025, 0.0025, 0, cavityBottom + BASE_THICKNESS / 2, g.nearZ - 0.0012));

  const edgeGeometry = mergeAll(edgeParts);
  if (edgeGeometry) {
    const edges = new THREE.Mesh(edgeGeometry, lib.machinedEdge);
    edges.name = 'cut-edges';
    group.add(edges);
  }

  // 检修灯带：腔体必须有光，否则剖切读成一个黑洞。
  const lampParts: THREE.BufferGeometry[] = [];
  lampParts.push(box(g.width - 0.08, 0.0032, 0.0032, 0, cavityTop - 0.008, g.nearZ - 0.045));
  lampParts.push(box(0.0032, 0.0032, g.depth / 2 - 0.05, g.width / 2 - 0.028, cavityTop - 0.008, nearHalfZ));
  const lampGeometry = mergeAll(lampParts);
  if (lampGeometry) {
    const lamps = new THREE.Mesh(lampGeometry, lib.serviceLight);
    lamps.name = 'service-lights';
    lamps.renderOrder = 1;
    group.add(lamps);
  }

  // 黄铜：近端台面上的螺钉。唯一暖金属强调，数量必须少。
  const brassParts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i += 1) {
    const x = (i - 2.5) * (g.width / 7);
    const screw = new THREE.CylinderGeometry(0.0042, 0.0042, 0.0026, 12);
    screw.translate(x, topY + 0.0013, g.nearZ - 0.024);
    brassParts.push(screw);
    // 螺钉压在一条细细的凹槽里。
    brassParts.push(box(0.028, 0.0012, 0.0016, x, topY - 0.0002, g.nearZ - 0.024));
  }
  const brassGeometry = mergeAll(brassParts);
  if (brassGeometry) {
    const brass = new THREE.Mesh(brassGeometry, lib.brass);
    brass.name = 'brass-details';
    group.add(brass);
  }

  // 底座：台面不能悬空。
  const pedestal = new THREE.Group();
  pedestal.name = 'pedestal';
  const columnHeight = cavityBottom;
  const column = new THREE.Mesh(
    box(0.17, columnHeight, 0.17, 0, columnHeight / 2, zCenter),
    lib.machinedEdge,
  );
  pedestal.add(column);

  const collar = new THREE.Mesh(box(0.2, 0.008, 0.2, 0, columnHeight - 0.06, zCenter), lib.brass);
  pedestal.add(collar);

  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.29, 0.018, 24), lib.cavity);
  foot.position.set(0, 0.009, zCenter);
  pedestal.add(foot);
  group.add(pedestal);

  // —— 轨号（调试）——
  if (params.showLaneNumbers) {
    for (const lane of g.visibleLanes) {
      const plane = new THREE.PlaneGeometry(0.03, 0.03);
      plane.rotateX(-Math.PI / 2);
      plane.translate(g.laneX[lane]!, topY + 0.0011, g.nearZ - 0.075);
      const digit = new THREE.Mesh(plane, lib.laneDigits[lane]!);
      digit.name = `lane-number-${lane}`;
      digit.renderOrder = 3;
      group.add(digit);
    }
  }

  return {
    group,
    geometry: g,
    dispose(): void {
      group.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) {
          object.geometry.dispose();
        }
      });
      group.clear();
    },
  };
}
