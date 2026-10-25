import * as THREE from 'three';

import type { BackgroundPalette, BackgroundSpec, PaletteKey } from './spec';

/**
 * 程序化背景：天空球 + 体素台地 + 菱形巨构。
 *
 * 设计定稿在 `design/bg-lab/`（Blender），这里是逐条搬过来的实现：
 * 全部是顶点色 + `MeshBasicMaterial`，**不需要灯光、雾、贴图、后处理**。
 *
 * 坐标：Blender (x, y, z) → three (x, z, −y)。相机同游戏：(0, 1.62, 0.52)、竖直 FOV 58°。
 * 注意：天空球半径 = `geometry.domeRadius`，相机 far 必须 ≥ 它。
 */

type RGB = [number, number, number];
type Vec3 = RGB;

const DEG = Math.PI / 180;

const CAM_POS: Vec3 = [0, 1.62, 0.52];
const CAM_EYE_Y = CAM_POS[1];

/** 地平线附近的环最密：0.2° 一级，往上逐渐稀疏。 */
const SKY_RINGS: number[] = [
  -90, -75, -60, -48, -38, -30, -24, -19, -15, -12,
  -9.5, -7.5, -6, -4.8, -3.8, -3, -2.4, -1.9, -1.55, -1.25, -1, -0.78,
  -0.58, -0.4, -0.22, 0, 0.22, 0.42, 0.65, 0.92, 1.25, 1.65, 2.15, 2.75,
  3.5, 4.4, 5.5, 7, 8.8, 11, 13.8, 17, 21, 26, 32, 39, 47,
  56, 66, 77, 90,
];
const SKY_SEG = 96;

const SKY_STOPS: Array<[number, PaletteKey]> = [
  [90, 'skyZenith'],
  [38, 'skyHigh'],
  [14, 'skyMid'],
  [4, 'skyNear'],
  [0.4, 'skyBand'],
  [-1.6, 'skyUnder1'],
  [-6, 'skyUnder2'],
  [-22, 'skyDeep'],
  [-90, 'skyDeep'],
];

const TABLE_TOP = 0.95;
const TABLE_NEAR_Z = 0.34;
const TABLE_FAR_Z = -9.66;
const TABLE_HALF_W = 0.81;

// ---------------------------------------------------------------- 小工具

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** 每个配色的线性色缓存（THREE.Color 已经做过 sRGB → 线性）。 */
const RGB_CACHE = new WeakMap<BackgroundPalette, Map<PaletteKey, RGB>>();

function rgbOf(palette: BackgroundPalette, key: PaletteKey): RGB {
  let table = RGB_CACHE.get(palette);
  if (!table) {
    table = new Map();
    RGB_CACHE.set(palette, table);
  }
  const cached = table.get(key);
  if (cached) return cached;
  const color = new THREE.Color(palette[key]);
  const out: RGB = [color.r, color.g, color.b];
  table.set(key, out);
  return out;
}

function mixRGB(a: RGB, b: RGB, t: number): RGB {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function scaleRGB(c: RGB, k: number): RGB {
  return [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)];
}

// ---------------------------------------------------------------- 几何累加器

class MeshBuilder {
  private readonly pos: number[] = [];
  private readonly col: number[] = [];

  tri(a: Vec3, b: Vec3, c: Vec3, ca: RGB, cb: RGB, cc: RGB): void {
    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.col.push(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2], cc[0], cc[1], cc[2]);
  }

  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, col: RGB): void {
    this.tri(a, b, c, col, col, col);
    this.tri(a, c, d, col, col, col);
  }

  quadGradient(a: Vec3, b: Vec3, c: Vec3, d: Vec3, ca: RGB, cb: RGB, cc: RGB, cd: RGB): void {
    this.tri(a, b, c, ca, cb, cc);
    this.tri(a, c, d, ca, cc, cd);
  }

  build(name: string, material: THREE.Material): THREE.Mesh | null {
    if (this.pos.length === 0) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    return mesh;
  }
}

// ---------------------------------------------------------------- 天空

function catmull(p0: RGB, p1: RGB, p2: RGB, p3: RGB, t: number): RGB {
  const t2 = t * t;
  const t3 = t2 * t;
  const out: RGB = [0, 0, 0];
  for (let i = 0; i < 3; i += 1) {
    const a = p0[i] ?? 0;
    const b = p1[i] ?? 0;
    const c = p2[i] ?? 0;
    const d = p3[i] ?? 0;
    out[i] = clamp01(0.5 * (
      2 * b +
      (-a + c) * t +
      (2 * a - 5 * b + 4 * c - d) * t2 +
      (-a + 3 * b - 3 * c + d) * t3
    ));
  }
  return out;
}

function skyColor(palette: BackgroundPalette, elev: number): RGB {
  const first = SKY_STOPS[0];
  const last = SKY_STOPS[SKY_STOPS.length - 1];
  if (!first || !last) return [0, 0, 0];
  if (elev >= first[0]) return rgbOf(palette, first[1]);
  if (elev <= last[0]) return rgbOf(palette, last[1]);

  for (let i = 0; i < SKY_STOPS.length - 1; i += 1) {
    const s1 = SKY_STOPS[i];
    const s2 = SKY_STOPS[i + 1];
    if (!s1 || !s2) continue;
    const [e1, k1] = s1;
    const [e2, k2] = s2;
    if (elev > e1 || elev < e2) continue;
    const t = (e1 - elev) / (e1 - e2);
    const prev = SKY_STOPS[Math.max(0, i - 1)] ?? s1;
    const next = SKY_STOPS[Math.min(SKY_STOPS.length - 1, i + 2)] ?? s2;
    return catmull(
      rgbOf(palette, prev[1]),
      rgbOf(palette, k1),
      rgbOf(palette, k2),
      rgbOf(palette, next[1]),
      t,
    );
  }
  return rgbOf(palette, last[1]);
}

function buildSky(spec: BackgroundSpec, into: MeshBuilder): void {
  const { domeRadius } = spec.geometry;
  const point = (elevDeg: number, azimuth: number): Vec3 => {
    const elev = elevDeg * DEG;
    const radius = Math.cos(elev) * domeRadius;
    return [
      CAM_POS[0] + Math.cos(azimuth) * radius,
      CAM_POS[1] + Math.sin(elev) * domeRadius,
      CAM_POS[2] + Math.sin(azimuth) * radius,
    ];
  };

  for (let r = 0; r < SKY_RINGS.length - 1; r += 1) {
    const e0 = SKY_RINGS[r] ?? 0;
    const e1 = SKY_RINGS[r + 1] ?? 0;
    const c0 = skyColor(spec.palette, e0);
    const c1 = skyColor(spec.palette, e1);
    for (let s = 0; s < SKY_SEG; s += 1) {
      const a0 = (2 * Math.PI * s) / SKY_SEG;
      const a1 = (2 * Math.PI * (s + 1)) / SKY_SEG;
      into.quadGradient(
        point(e0, a0), point(e1, a0), point(e1, a1), point(e0, a1),
        c0, c1, c1, c0,
      );
    }
  }
}

// ---------------------------------------------------------------- 体素台地

function hash2(ix: number, iz: number): number {
  let h = (ix * 374761393 + iz * 668265263) >>> 0;
  h = ((h ^ (h >>> 13)) * 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) & 0xffff) / 65535;
}

function noise2(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return (a * (1 - sx) + b * sx) * (1 - sz) + (c * (1 - sx) + d * sx) * sz;
}

/** z 是 Blender 的前向距离（= three 的 −z）。前方被切出一个楔形缺口。 */
function terrainExists(x: number, z: number): boolean {
  if (z <= 0.9) return true;
  return Math.abs(x) > 1.25 + (z - 0.9) * 0.6;
}

function buildTerrain(spec: BackgroundSpec, into: MeshBuilder): void {
  const { cell, step, floor, xExtent, zEnd } = spec.geometry.terrain;
  const base = rgbOf(spec.palette, 'terrain');
  const haze = rgbOf(spec.palette, 'terrainHaze');

  const heightOf = (x: number, z: number): number => {
    const inner = 1.25 + Math.max(0, z - 0.9) * 0.6;
    const k = Math.max(0, Math.abs(x) - inner);
    let h = floor + 1.15 * (1 - Math.exp(-k / 1.6));
    h += (noise2(x * 0.35, z * 0.35) - 0.5) * 0.3;
    return Math.round(h / step) * step;
  };

  const colorOf = (x: number, z: number, top: boolean): RGB => {
    const d = Math.hypot(x, z);
    const t = smoothstep(4, 14, d) * 0.3;
    const k = (top ? 1.1 : 0.6) * (0.94 + 0.12 * noise2(x * 0.7 + 9, z * 0.7 + 3));
    return scaleRGB(mixRGB(base, haze, t), k);
  };

  const heights = new Map<string, number>();
  for (let ix = -xExtent; ix <= xExtent; ix += 1) {
    for (let iz = -8; iz <= zEnd; iz += 1) {
      const x = ix * cell;
      const z = iz * cell;
      if (!terrainExists(x, z)) continue;
      heights.set(`${ix},${iz}`, heightOf(x, z));
    }
  }

  const half = cell / 2;
  for (const [key, h] of heights) {
    const [ixText, izText] = key.split(',');
    const ix = Number(ixText);
    const iz = Number(izText);
    const x = ix * cell;
    const z = iz * cell;
    const zc = -z;

    into.quad(
      [x - half, h, zc + half], [x + half, h, zc + half],
      [x + half, h, zc - half], [x - half, h, zc - half],
      colorOf(x, z, true),
    );

    const neighbours: Array<[number, number, number, number]> = [
      [1, 0, half, 0], [-1, 0, -half, 0], [0, 1, 0, half], [0, -1, 0, -half],
    ];
    for (const [dx, dz, ax, az] of neighbours) {
      const nh = heights.get(`${ix + dx},${iz + dz}`);
      if (nh !== undefined && nh >= h) continue;
      const low = nh === undefined ? h - 4 : nh;
      const col = colorOf(x, z, false);
      if (ax !== 0) {
        const xx = x + ax;
        into.quad(
          [xx, low, zc + half], [xx, low, zc - half],
          [xx, h, zc - half], [xx, h, zc + half],
          col,
        );
      } else {
        const zz = zc + az;
        into.quad(
          [x - half, low, zz], [x + half, low, zz],
          [x + half, h, zz], [x - half, h, zz],
          col,
        );
      }
    }
  }
}

// ---------------------------------------------------------------- 菱形巨构

function buildDiamond(spec: BackgroundSpec, into: MeshBuilder): void {
  const { dist, apexElevDeg, slope, halfH, rim, depth } = spec.geometry.diamond;
  const tipBottomY = CAM_EYE_Y + dist * Math.tan(apexElevDeg * DEG);
  const waistY = tipBottomY + halfH;
  const tipTopY = waistY + halfH;
  const halfW = halfH * slope;
  const z = -dist;

  const cBottom = rgbOf(spec.palette, 'megaBottom');
  const cTop = rgbOf(spec.palette, 'megaTop');
  const cTipTop = mixRGB(cTop, cBottom, 0.25);
  const cRim = rgbOf(spec.palette, 'megaRim');

  const tipB: Vec3 = [0, tipBottomY, z];
  const left: Vec3 = [-halfW, waistY, z];
  const right: Vec3 = [halfW, waistY, z];
  const tipT: Vec3 = [0, tipTopY, z];

  into.tri(tipB, left, right, cBottom, cTop, cTop);
  into.tri(left, tipT, right, cTop, cTipTop, cTop);

  // 厚度：四条边各一片侧面
  const zBack = -(dist + depth);
  const edges: Array<[Vec3, Vec3]> = [
    [tipB, left], [left, tipT], [tipT, right], [right, tipB],
  ];
  for (const [a, b] of edges) {
    into.quad(
      [a[0], a[1], z], [b[0], b[1], z],
      [b[0], b[1], zBack], [a[0], a[1], zBack],
      cBottom,
    );
  }

  // 等宽边线：贴在面的前方 5cm
  const zRim = -(dist - 0.05);
  const midZ = (tipBottomY + tipTopY) / 2;
  const corners: Array<[number, number]> = [
    [0, tipBottomY], [-halfW, waistY], [0, tipTopY], [halfW, waistY],
  ];
  for (let i = 0; i < corners.length; i += 1) {
    const p1 = corners[i];
    const p2 = corners[(i + 1) % corners.length];
    if (!p1 || !p2) continue;
    const dx = p2[0] - p1[0];
    const dz = p2[1] - p1[1];
    const len = Math.hypot(dx, dz) || 1;
    let nx = -dz / len;
    let nz = dx / len;
    const mx = (p1[0] + p2[0]) / 2;
    const mz = (p1[1] + p2[1]) / 2;
    if (mx * nx + (mz - midZ) * nz < 0) {
      nx = -nx;
      nz = -nz;
    }
    into.quad(
      [p1[0], p1[1], zRim], [p2[0], p2[1], zRim],
      [p2[0] + nx * rim, p2[1] + nz * rim, zRim],
      [p1[0] + nx * rim, p1[1] + nz * rim, zRim],
      cRim,
    );
  }
}

// ---------------------------------------------------------------- 台面 / 假 note（只在 lab 用）

function buildStage(spec: BackgroundSpec, material: THREE.Material): THREE.Mesh | null {
  const b = new MeshBuilder();
  b.quad(
    [-TABLE_HALF_W, TABLE_TOP, TABLE_NEAR_Z], [TABLE_HALF_W, TABLE_TOP, TABLE_NEAR_Z],
    [TABLE_HALF_W, TABLE_TOP, TABLE_FAR_Z], [-TABLE_HALF_W, TABLE_TOP, TABLE_FAR_Z],
    rgbOf(spec.palette, 'stage'),
  );
  b.quad(
    [-TABLE_HALF_W, TABLE_TOP, TABLE_FAR_Z + 0.01], [TABLE_HALF_W, TABLE_TOP, TABLE_FAR_Z + 0.01],
    [TABLE_HALF_W, TABLE_TOP + 0.006, TABLE_FAR_Z + 0.01],
    [-TABLE_HALF_W, TABLE_TOP + 0.006, TABLE_FAR_Z + 0.01],
    rgbOf(spec.palette, 'stageEdge'),
  );
  return b.build('bg-stage', material);
}

function buildNotes(spec: BackgroundSpec, material: THREE.Material): THREE.Mesh | null {
  const b = new MeshBuilder();
  const col = rgbOf(spec.palette, 'note');
  const xs = [-0.405, -0.135, 0.135, 0.405];
  const rows: Array<[number, number]> = [
    [2.1, 0], [2.9, 2], [3.6, 1], [4.5, 3], [5.6, 0], [6.4, 2], [7.3, 1], [8.2, 3],
  ];
  for (const [z, lane] of rows) {
    const x = xs[lane] ?? 0;
    const y = TABLE_TOP + 0.02;
    b.quad(
      [x - 0.11, y, -z + 0.05], [x + 0.11, y, -z + 0.05],
      [x + 0.11, y, -z - 0.05], [x - 0.11, y, -z - 0.05],
      col,
    );
  }
  return b.build('bg-notes', material);
}

// ---------------------------------------------------------------- 组装

export interface BackgroundOptions {
  /** 画一块台面代用品（实验台用；游戏里台面是另外的东西）。 */
  stage?: boolean;
  /** 画假 note（实验台用）。 */
  notes?: boolean;
}

export interface BuiltBackground {
  group: THREE.Group;
  /** 可选网格：实验台要单独开关 note。 */
  notes: THREE.Mesh | null;
  dispose(): void;
}

export function buildBackground(spec: BackgroundSpec, options: BackgroundOptions = {}): BuiltBackground {
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    // 游戏的雾只服务台面 / note 的远端淡出；背景是几百米外的天空，不能吃雾。
    fog: false,
    // 制谱器预览用 ACES 色调映射（为材质调的）；背景是烘焙好的颜色，不该再被它压暗。
    toneMapped: false,
  });

  const builder = new MeshBuilder();
  buildSky(spec, builder);
  buildTerrain(spec, builder);
  buildDiamond(spec, builder);

  const group = new THREE.Group();
  group.name = `background:${spec.id}`;

  const backdrop = builder.build('bg-scene', material);
  if (backdrop) group.add(backdrop);

  let stageMesh: THREE.Mesh | null = null;
  if (options.stage) {
    stageMesh = buildStage(spec, material);
    if (stageMesh) group.add(stageMesh);
  }

  let notesMesh: THREE.Mesh | null = null;
  if (options.notes) {
    notesMesh = buildNotes(spec, material);
    if (notesMesh) group.add(notesMesh);
  }

  return {
    group,
    notes: notesMesh,
    dispose(): void {
      for (const mesh of [backdrop, stageMesh, notesMesh]) {
        if (!mesh) continue;
        group.remove(mesh);
        mesh.geometry.dispose();
      }
      material.dispose();
      group.clear();
    },
  };
}
