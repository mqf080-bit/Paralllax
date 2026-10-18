import * as THREE from 'three';

import { chartLimits, type ArcNote, type Chart } from '../chart/schema';
import { arcDuration, arcTicks, sampleArcPoint } from './model';

/**
 * 3D 里专门给 arc 用的编辑层。
 *
 * 游戏播放器里的 arc 是按时间滚动的静态几何：拖动 arc 的点时它不会重建，
 * 所以 3D 拖动看起来「不跟手」。这一层用同一套滚动公式实时重建：
 *
 * - 白色球 = 控制点（自由拖动 = 同时改 x / z）
 * - 青色球 = 只改 x（横向）
 * - 黄铜球 = 只改 z（高度）
 * - 小珠子 = 物量；点一下直接切 KEY
 *
 * 选中的 arc 会临时隐藏播放器里那条旧几何，避免两条线叠在一起。
 */

const SAMPLE_COUNT = 80;
const BODY_RADIUS = 0.012;
const GLOW_RADIUS = 0.03;

const COLORS = {
  left: 0x6fe3f2,
  right: 0xff7d93,
  point: 0xf4fbff,
  axisX: 0x6fe3f2,
  axisZ: 0xd8b46a,
  tick: 0x6fe3f2,
  key: 0xd8b46a,
};

export type ArcAxis = 'free' | 'x' | 'z';

export type ArcPick =
  | { kind: 'point'; note: ArcNote; index: number; axis: ArcAxis; point: THREE.Vector3 }
  | { kind: 'tick'; note: ArcNote; time: number; key: boolean; point: THREE.Vector3 }
  | { kind: 'body'; note: ArcNote; point: THREE.Vector3 };

export interface ArcEditConfig {
  laneWidth: number;
  tableHeight: number;
  bandZ: number;
  /** 基准流速（米 / 秒），和播放器的 flowSpeed 一致。 */
  baseSpeed: number;
  /** 速度积分（倍率·秒）。 */
  scroll(timeMs: number): number;
}

export interface ArcEditOverlay {
  readonly group: THREE.Group;
  readonly visible: boolean;
  setVisible(visible: boolean): void;
  rebuild(chart: Chart, timeMs: number, note: ArcNote, selectedPoint: number | null): void;
  pick(raycaster: THREE.Raycaster): ArcPick | null;
  worldAt(note: ArcNote, relTime: number, timeMs: number): THREE.Vector3;
  nearestRelTime(note: ArcNote, target: THREE.Vector3, timeMs: number): number;
  dispose(): void;
}

class PolylineCurve3 extends THREE.Curve<THREE.Vector3> {
  constructor(private readonly points: THREE.Vector3[]) {
    super();
  }

  getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const count = this.points.length;
    if (count === 0) return target.set(0, 0, 0);
    if (count === 1) return target.copy(this.points[0]!);
    const scaled = Math.min(1, Math.max(0, t)) * (count - 1);
    const index = Math.floor(scaled);
    const fraction = scaled - index;
    const a = this.points[Math.min(index, count - 1)]!;
    const b = this.points[Math.min(index + 1, count - 1)]!;
    return target.copy(a).lerp(b, fraction);
  }
}

export function createArcEditOverlay(config: ArcEditConfig): ArcEditOverlay {
  const group = new THREE.Group();
  group.name = 'arc-edit-overlay';
  group.visible = false;

  const sharedGeometries = new Set<THREE.BufferGeometry>();
  const sharedMaterials = new Set<THREE.Material>();

  const pointGeometry = new THREE.SphereGeometry(0.019, 14, 14);
  const selectedPointGeometry = new THREE.SphereGeometry(0.028, 16, 16);
  const axisGeometry = new THREE.SphereGeometry(0.015, 12, 12);
  const tickGeometry = new THREE.SphereGeometry(0.011, 10, 10);
  const keyTickGeometry = new THREE.SphereGeometry(0.018, 12, 12);
  const pointHitGeometry = new THREE.SphereGeometry(0.05, 8, 8);
  const tickHitGeometry = new THREE.SphereGeometry(0.028, 8, 8);
  for (const geometry of [
    pointGeometry,
    selectedPointGeometry,
    axisGeometry,
    tickGeometry,
    keyTickGeometry,
    pointHitGeometry,
    tickHitGeometry,
  ]) {
    sharedGeometries.add(geometry);
  }

  const pointMaterial = new THREE.MeshBasicMaterial({
    color: COLORS.point,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    toneMapped: false,
  });
  const selectedPointMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 1,
    depthTest: false,
    toneMapped: false,
  });
  const axisXMaterial = new THREE.MeshBasicMaterial({
    color: COLORS.axisX,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    toneMapped: false,
  });
  const axisZMaterial = new THREE.MeshBasicMaterial({
    color: COLORS.axisZ,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    toneMapped: false,
  });
  const tickMaterial = new THREE.MeshBasicMaterial({
    color: COLORS.tick,
    transparent: true,
    opacity: 0.75,
    depthTest: false,
    toneMapped: false,
  });
  const keyTickMaterial = new THREE.MeshBasicMaterial({
    color: COLORS.key,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    toneMapped: false,
  });
  const hitMaterial = new THREE.MeshBasicMaterial({ visible: false });
  // 不可见的球形命中体：渲染器跳过，Raycaster 仍然能打中。
  for (const material of [
    pointMaterial,
    selectedPointMaterial,
    axisXMaterial,
    axisZMaterial,
    tickMaterial,
    keyTickMaterial,
    hitMaterial,
  ]) {
    sharedMaterials.add(material);
  }

  const axisLineMaterialX = new THREE.LineBasicMaterial({
    color: COLORS.axisX,
    transparent: true,
    opacity: 0.55,
    depthTest: false,
    toneMapped: false,
  });
  const axisLineMaterialZ = new THREE.LineBasicMaterial({
    color: COLORS.axisZ,
    transparent: true,
    opacity: 0.55,
    depthTest: false,
    toneMapped: false,
  });
  sharedMaterials.add(axisLineMaterialX);
  sharedMaterials.add(axisLineMaterialZ);

  let lastNote: ArcNote | null = null;
  let lastKey = '';

  function worldAt(note: ArcNote, relTime: number, timeMs: number): THREE.Vector3 {
    const duration = arcDuration(note);
    const rel = Math.min(duration, Math.max(0, relTime));
    const sample = sampleArcPoint(note.points, rel);
    const x = (sample.x - 2.5) * config.laneWidth;
    const y = config.tableHeight + sample.z;
    const z =
      config.bandZ +
      ((config.scroll(timeMs) - config.scroll(note.time + rel)) * config.baseSpeed) / 1000;
    return new THREE.Vector3(x, y, z);
  }

  function nearestRelTime(note: ArcNote, target: THREE.Vector3, timeMs: number): number {
    const duration = arcDuration(note);
    if (duration <= 0) return 0;
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    const steps = Math.min(480, Math.max(96, Math.ceil(duration / 16)));
    for (let i = 0; i <= steps; i += 1) {
      const t = (i / steps) * duration;
      const distance = worldAt(note, t, timeMs).distanceToSquared(target);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = t;
      }
    }
    let span = duration / steps;
    for (let pass = 0; pass < 4; pass += 1) {
      span /= 2;
      for (const candidate of [best - span, best + span]) {
        const t = Math.min(duration, Math.max(0, candidate));
        const distance = worldAt(note, t, timeMs).distanceToSquared(target);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = t;
        }
      }
    }
    return best;
  }

  function clear(): void {
    group.traverse((object) => {
      if (object === group) return;
      const mesh = object as THREE.Mesh;
      if (mesh.geometry && !sharedGeometries.has(mesh.geometry)) mesh.geometry.dispose();
      const material = (object as THREE.Mesh).material;
      if (Array.isArray(material)) {
        for (const item of material) if (!sharedMaterials.has(item)) item.dispose();
      } else if (material && !sharedMaterials.has(material)) {
        material.dispose();
      }
    });
    group.clear();
  }

  function addHit(
    position: THREE.Vector3,
    pick: Omit<Extract<ArcPick, { kind: 'point' }>, 'point'> | Omit<Extract<ArcPick, { kind: 'tick' }>, 'point'>,
    geometry: THREE.BufferGeometry = pointHitGeometry,
  ): void {
    const hit = new THREE.Mesh(geometry, hitMaterial);
    hit.position.copy(position);
    hit.frustumCulled = false;
    (hit.userData as { arcPick: unknown }).arcPick = pick;
    group.add(hit);
  }

  function addAxisHandle(
    note: ArcNote,
    index: number,
    origin: THREE.Vector3,
    axis: 'x' | 'z',
  ): void {
    const end = origin.clone();
    if (axis === 'x') end.x += 0.08;
    else end.y += 0.08;
    const material = axis === 'x' ? axisXMaterial : axisZMaterial;
    const handle = new THREE.Mesh(axisGeometry, material);
    handle.position.copy(end);
    handle.frustumCulled = false;
    handle.renderOrder = 43;
    group.add(handle);

    const lineGeometry = new THREE.BufferGeometry().setFromPoints([origin, end]);
    const line = new THREE.Line(lineGeometry, axis === 'x' ? axisLineMaterialX : axisLineMaterialZ);
    line.renderOrder = 42;
    group.add(line);

    addHit(end, { kind: 'point', note, index, axis });
  }

  function rebuild(chart: Chart, timeMs: number, note: ArcNote, selectedPoint: number | null): void {
    const key = JSON.stringify([
      timeMs,
      selectedPoint,
      note.hand,
      note.points,
      note.ticks ?? null,
      note.keyObjects ?? null,
      note.notesPerSecond ?? null,
      chartLimits(chart).maxHeight,
    ]);
    if (note === lastNote && key === lastKey && group.visible) return;
    lastNote = note;
    lastKey = key;
    clear();
    const maxHeight = chartLimits(chart).maxHeight;
    const duration = arcDuration(note);
    const color = note.hand === 'left' ? COLORS.left : COLORS.right;

    // —— 弧身 ——
    const samples: THREE.Vector3[] = [];
    for (let i = 0; i <= SAMPLE_COUNT; i += 1) {
      samples.push(worldAt(note, (i / SAMPLE_COUNT) * duration, timeMs));
    }
    const curve = new PolylineCurve3(samples);
    const bodyGeometry = new THREE.TubeGeometry(curve, SAMPLE_COUNT, BODY_RADIUS, 6, false);
    const bodyMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      toneMapped: false,
    });
    const bodyMesh = new THREE.Mesh(bodyGeometry, bodyMaterial);
    bodyMesh.renderOrder = 38;
    bodyMesh.frustumCulled = false;
    (bodyMesh.userData as { arcPick: unknown }).arcPick = { kind: 'body', note };
    group.add(bodyMesh);

    // 不可见的粗命中管：弧身只有 1.2cm 半径，按像素点很难中点。
    const bodyHitGeometry = new THREE.TubeGeometry(curve, SAMPLE_COUNT, 0.032, 4, false);
    const bodyHit = new THREE.Mesh(bodyHitGeometry, hitMaterial);
    bodyHit.frustumCulled = false;
    (bodyHit.userData as { arcPick: unknown }).arcPick = { kind: 'body', note };
    group.add(bodyHit);

    const glowGeometry = new THREE.TubeGeometry(curve, SAMPLE_COUNT, GLOW_RADIUS, 6, false);
    const glowMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    glow.renderOrder = 37;
    glow.frustumCulled = false;
    group.add(glow);

    // —— 控制点 ——
    note.points.forEach((point, index) => {
      const position = worldAt(note, point.time, timeMs);
      const selected = index === selectedPoint;
      const handle = new THREE.Mesh(selected ? selectedPointGeometry : pointGeometry, selected ? selectedPointMaterial : pointMaterial);
      handle.position.copy(position);
      handle.frustumCulled = false;
      handle.renderOrder = 41;
      group.add(handle);
      addHit(position, { kind: 'point', note, index, axis: 'free' });
      if (selected) {
        addAxisHandle(note, index, position, 'x');
        addAxisHandle(note, index, position, 'z');
      }
    });

    // —— 物量珠：点一下切 KEY ——
    const ticks = arcTicks(note).slice(0, 500);
    for (const tick of ticks) {
      if (tick.time < 0 || tick.time > duration) continue;
      const position = worldAt(note, tick.time, timeMs);
      if (position.y > config.tableHeight + maxHeight + 0.05) continue;
      const bead = new THREE.Mesh(tick.key ? keyTickGeometry : tickGeometry, tick.key ? keyTickMaterial : tickMaterial);
      bead.position.copy(position);
      bead.frustumCulled = false;
      bead.renderOrder = 43;
      group.add(bead);
      addHit(position, { kind: 'tick', note, time: tick.time, key: tick.key }, tickHitGeometry);
    }

    group.visible = true;
  }

  function pick(raycaster: THREE.Raycaster): ArcPick | null {
    if (!group.visible) return null;
    const hits = raycaster.intersectObjects(group.children, true);
    let pointPick: ArcPick | null = null;
    let tickPick: ArcPick | null = null;
    let bodyPick: ArcPick | null = null;
    for (const hit of hits) {
      const pickData = (hit.object.userData as { arcPick?: ArcPick }).arcPick;
      if (!pickData) continue;
      const candidate = { ...pickData, point: hit.point.clone() } as ArcPick;
      // 控制点 / 物量珠永远优先于弧身：在急弯处，弧身可能比点更靠近相机，
      // 但白色把手是 depthTest:false 画在最上面的，点击语义必须跟视觉一致。
      if (candidate.kind === 'point') {
        if (!pointPick) pointPick = candidate;
      } else if (candidate.kind === 'tick') {
        if (!tickPick) tickPick = candidate;
      } else if (!bodyPick) {
        bodyPick = candidate;
      }
    }
    return pointPick ?? tickPick ?? bodyPick;
  }

  function dispose(): void {
    clear();
    lastNote = null;
    lastKey = '';
    for (const geometry of sharedGeometries) geometry.dispose();
    for (const material of sharedMaterials) material.dispose();
    sharedGeometries.clear();
    sharedMaterials.clear();
  }

  return {
    group,
    get visible(): boolean {
      return group.visible;
    },
    setVisible(visible: boolean): void {
      group.visible = visible;
    },
    rebuild,
    pick,
    worldAt,
    nearestRelTime,
    dispose,
  };
}
