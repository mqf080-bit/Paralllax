import * as THREE from 'three';

import { easeValue } from '../chart/easing';
import { arcPointZ, type ArcPoint, type ArcTickSpec } from '../chart/schema';
import { applyDistanceFade } from '../materials/distanceFade';
import { createFresnelGlowMaterial } from '../materials/glow';
import type { MaterialLibrary } from '../materials/library';
import { HAND_LEFT, HAND_RIGHT } from '../materials/palette';
import { createGlowTexture } from '../materials/textures';
import type { HandSample, HandSide } from './hands';

/** 和 player 一样：note 必须画在台面（transparent、mesh 在原点、排序偏前）之后。 */
const ORDER_BODY = 5;
const ORDER_GLOW = 6;

/**
 * 谱面驱动的 arc：形状来自谱面的点列，位置由**速度积分**决定。
 *
 * 局部 z = -（滚动距离差）× 基准流速 / 1000，整条管再按「当前滚动距离」平移。
 * 于是 SV 变化时弧会被拉长 / 压扁 / 倒流，而判定点始终落在判定带上。
 */

export interface ArcTick {
  /** 绝对谱面时间（毫秒）。 */
  time: number;
  key: boolean;
  held: boolean;
  resolved: boolean;
}

export interface ArcEvent {
  type: 'held' | 'miss';
  key: boolean;
  position: THREE.Vector3;
  side: HandSide;
}

export interface ArcSpec {
  points: ArcPoint[];
  /** 绝对谱面时间（毫秒）。 */
  startTime: number;
  hand: HandSide;
  keyObjects: number[];
  notesPerSecond: number;
  /** 显式物量：存在时忽略关键物量 / 均匀生成的普通物量。 */
  ticks?: ArcTickSpec[];
  laneWidth: number;
  tableHeight: number;
  bandZ: number;
  clipZ: number;
  baseSpeed: number;
  /** 视距淡出：超过这个 z 完全透明（台面远端）。 */
  fadeFar: number;
  fadeSpan: number;
  /** 滚动积分（倍率·毫秒）。 */
  scroll(timeMs: number): number;
}

export interface ArcNote {
  group: THREE.Group;
  hand: HandSide;
  ticks: ArcTick[];
  update(clockMs: number, hands: HandSample[], auto?: boolean): ArcEvent[];
  /** 自动演示用：当前判定点的世界坐标。 */
  pointAt(clockMs: number): THREE.Vector3;
  dispose(): void;
}

/** 跟随判定半径（只影响发光）。 */
const FOLLOW_RADIUS = 0.2;
/** 普通物量：判定半径与窗口。 */
const NORMAL_RADIUS = 0.19;
const NORMAL_WINDOW_MS = 200;
/** 关键物量：半径与普通相同，只收窗口。 */
const KEY_RADIUS = NORMAL_RADIUS;
const KEY_WINDOW_MS = 80;
/** 手在 z 方向离判定带多远还算在判定带上。 */
const BAND_ZONE = 0.42;
/** 构建管几何时的采样数。 */
const SEGMENTS = 160;
const CURVE_SEGMENTS = 128;

/**
 * 折线curve：按样本点线性插值，**不会把直角磨圆**。
 * 旧版用 CatmullRomCurve3，即使谱面写的是 linear，拐角也会被平滑成圆弧。
 */
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

export function createArcNote(spec: ArcSpec, lib: MaterialLibrary): ArcNote {
  const colors = spec.hand === 'left' ? HAND_LEFT : HAND_RIGHT;
  const group = new THREE.Group();
  group.name = 'arc';

  const points = [...spec.points].sort((a, b) => a.time - b.time);
  const duration = points[points.length - 1]?.time ?? 0;
  const start = spec.startTime;

  const toWorldX = (lane: number): number => (lane - 2.5) * spec.laneWidth;
  const toWorldY = (height: number): number => spec.tableHeight + height;

  /** 相对时间 → 世界 x / y（判定带上）。 */
  function xyAt(tRel: number): { x: number; y: number } {
    const t = Math.min(Math.max(tRel, 0), duration);
    let previous = points[0]!;
    for (let i = 1; i < points.length; i += 1) {
      const next = points[i]!;
      if (t <= next.time) {
        const span = next.time - previous.time;
        const u = span > 0 ? (t - previous.time) / span : 1;
        const easedX = easeValue(next.easing, u);
        const easedZ = easeValue(next.easingZ ?? next.easing, u);
        return {
          x: toWorldX(previous.x + (next.x - previous.x) * easedX),
          y: toWorldY(arcPointZ(previous) + (arcPointZ(next) - arcPointZ(previous)) * easedZ),
        };
      }
      previous = next;
    }
    return { x: toWorldX(previous.x), y: toWorldY(arcPointZ(previous)) };
  }

  /** 相对时间 → 局部空间坐标（z 由滚动积分决定）。 */
  function localAt(tRel: number): THREE.Vector3 {
    const t = Math.min(Math.max(tRel, 0), duration);
    const xy = xyAt(t);
    const z = -((spec.scroll(start + t) - spec.scroll(start)) * spec.baseSpeed) / 1000;
    return new THREE.Vector3(xy.x, xy.y, z);
  }

  // —— 几何：按时间等分采样，z 跟着速度积分走 ——
  const samples: THREE.Vector3[] = [];
  for (let i = 0; i <= SEGMENTS; i += 1) samples.push(localAt((i / SEGMENTS) * duration));
  const curve = new PolylineCurve3(samples);

  const clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, 0, -1), spec.clipZ)];
  // arc 比 note 长得多：淡入拉长一点，整条管子才是「慢慢长出来」而不是一闪。
  const arcFade = { far: spec.fadeFar, span: spec.fadeSpan * 1.2, power: 0.8 };

  const shellMaterial = applyDistanceFade((spec.hand === 'left' ? lib.clearGlassLeft : lib.clearGlassRight).clone(), arcFade);
  shellMaterial.emissive.setHex(colors.emissive);
  shellMaterial.emissiveIntensity = 0;
  shellMaterial.opacity = 0.42;
  shellMaterial.clippingPlanes = clippingPlanes;

  const shellGeometry = new THREE.TubeGeometry(curve, CURVE_SEGMENTS, 0.018, 14, false);
  const shellMesh = new THREE.Mesh(shellGeometry, shellMaterial);
  shellMesh.renderOrder = ORDER_BODY;
  group.add(shellMesh);

  const coreMaterial = applyDistanceFade((spec.hand === 'left' ? lib.glassCoreLeft : lib.glassCoreRight).clone(), arcFade);
  coreMaterial.clippingPlanes = clippingPlanes;
  const coreGeometry = new THREE.TubeGeometry(curve, CURVE_SEGMENTS, 0.007, 8, false);
  const coreMesh = new THREE.Mesh(coreGeometry, coreMaterial);
  coreMesh.renderOrder = ORDER_BODY;
  group.add(coreMesh);

  const glowMaterial = createFresnelGlowMaterial(colors.glow, 0.35, 2.2, arcFade);
  glowMaterial.clippingPlanes = clippingPlanes;
  const glowGeometry = new THREE.TubeGeometry(curve, CURVE_SEGMENTS, 0.032, 10, false);
  const glowMesh = new THREE.Mesh(glowGeometry, glowMaterial);
  glowMesh.renderOrder = ORDER_GLOW;
  group.add(glowMesh);

  const haloMaterial = createFresnelGlowMaterial(colors.core, 0.2, 2.8, arcFade);
  haloMaterial.clippingPlanes = clippingPlanes;
  const haloGeometry = new THREE.TubeGeometry(curve, CURVE_SEGMENTS, 0.055, 10, false);
  const haloMesh = new THREE.Mesh(haloGeometry, haloMaterial);
  haloMesh.renderOrder = ORDER_GLOW;
  group.add(haloMesh);

  // —— 光点 ——
  const headGeometry = new THREE.SphereGeometry(0.02, 16, 16);
  const headMaterial = new THREE.MeshBasicMaterial({ color: colors.core, toneMapped: false, transparent: true });
  const head = new THREE.Mesh(headGeometry, headMaterial);
  head.renderOrder = ORDER_BODY;
  group.add(head);

  const headGlowTexture = createGlowTexture(128);
  const headHaloMaterial = new THREE.SpriteMaterial({
    map: headGlowTexture,
    color: colors.glow,
    transparent: true,
    opacity: 0.45,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const headHalo = new THREE.Sprite(headHaloMaterial);
  headHalo.scale.set(0.15, 0.15, 1);
  headHalo.renderOrder = ORDER_GLOW + 1;
  group.add(headHalo);

  // —— 关键物量的黄铜珠 ——
  const beadGeometry = new THREE.SphereGeometry(0.016, 16, 16);
  const beadMaterial = applyDistanceFade(
    new THREE.MeshStandardMaterial({
      color: 0xc9a05a,
      metalness: 0.9,
      roughness: 0.25,
      emissive: 0x3a2a10,
      emissiveIntensity: 0.5,
    }),
    arcFade,
  );
  beadMaterial.clippingPlanes = clippingPlanes;
  const keyTimes = spec.ticks
    ? spec.ticks.filter((tick) => tick.key === true).map((tick) => tick.time)
    : spec.keyObjects;
  for (const key of keyTimes) {
    const bead = new THREE.Mesh(beadGeometry, beadMaterial);
    bead.renderOrder = ORDER_BODY;
    bead.position.copy(localAt(key));
    group.add(bead);
  }

  // —— 物量 ——
  const ticks: ArcTick[] = [];
  if (spec.ticks) {
    for (const tick of spec.ticks) {
      if (tick.time < 0 || tick.time > duration) continue;
      ticks.push({ time: start + tick.time, key: tick.key === true, held: false, resolved: false });
    }
  } else {
    const normalCount = Math.max(2, Math.round((duration / 1000) * spec.notesPerSecond));
    for (let i = 0; i < normalCount; i += 1) {
      ticks.push({ time: start + ((i + 0.5) / normalCount) * duration, key: false, held: false, resolved: false });
    }
    for (const key of spec.keyObjects) {
      if (key >= 0 && key <= duration) ticks.push({ time: start + key, key: true, held: false, resolved: false });
    }
  }
  ticks.sort((a, b) => a.time - b.time);

  let following = 0;

  return {
    group,
    hand: spec.hand,
    ticks,

    pointAt(clockMs: number): THREE.Vector3 {
      const tRel = Math.min(Math.max(clockMs - start, 0), duration);
      const xy = xyAt(tRel);
      return new THREE.Vector3(xy.x, xy.y, spec.bandZ);
    },

    update(clockMs: number, hands: HandSample[], auto = false): ArcEvent[] {
      const events: ArcEvent[] = [];
      const tRel = THREE.MathUtils.clamp(clockMs - start, 0, duration);
      const local = localAt(tRel);

      group.position.z = spec.bandZ + ((spec.scroll(clockMs) - spec.scroll(start)) * spec.baseSpeed) / 1000;
      head.position.copy(local);
      headHalo.position.copy(local);

      // 轨道和光点也要按距离淡出：arc 还没到的时候，光点会停在「管子的起点」，
      // 那是台面之外很远的地方 —— 不淡掉就是一颗悬在黑暗里的红点。
      const headFade = THREE.MathUtils.clamp(
        (group.position.z + local.z - arcFade.far) / arcFade.span,
        0,
        1,
      );
      headMaterial.opacity = headFade;
      headHaloMaterial.opacity = 0.45 * headFade;
      head.visible = headFade > 0.01;
      headHalo.visible = headFade > 0.01;

      const findHand = (radius: number): HandSample | null => {
        for (const hand of hands) {
          if (!hand.active) continue;
          if (spec.hand !== 'none' && hand.side !== spec.hand) continue;
          if (Math.hypot(hand.position.x - local.x, hand.position.y - local.y) > radius) continue;
          if (Math.abs(hand.position.z - spec.bandZ) > BAND_ZONE) continue;
          return hand;
        }
        return null;
      };

      const holder = findHand(FOLLOW_RADIUS);
      following += ((holder ? 1 : 0) - following) * 0.12;
      shellMaterial.emissiveIntensity = following * 1.8;
      glowMaterial.uniforms.uIntensity!.value = 0.35 + following * 0.55;
      haloMaterial.uniforms.uIntensity!.value = 0.2 + following * 0.32;
      headHaloMaterial.opacity = 0.4 + following * 0.35;

      for (const tick of ticks) {
        if (tick.resolved) continue;
        if (auto) {
          // 自动演示不模拟手：物量到达判定线就直接 PERFECT。
          if (clockMs < tick.time) continue;
          tick.held = true;
          tick.resolved = true;
          const at = xyAt(tick.time - start);
          events.push({
            type: 'held',
            key: tick.key,
            position: new THREE.Vector3(at.x, at.y, spec.bandZ),
            side: spec.hand,
          });
          continue;
        }
        const windowMs = tick.key ? KEY_WINDOW_MS : NORMAL_WINDOW_MS;
        const radius = tick.key ? KEY_RADIUS : NORMAL_RADIUS;
        const offsetMs = clockMs - tick.time;

        if (Math.abs(offsetMs) <= windowMs / 2) {
          if (tick.held) continue;
          const hand = findHand(radius);
          if (!hand) continue;
          tick.held = true;
          events.push({ type: 'held', key: tick.key, position: hand.position.clone(), side: hand.side });
        } else if (offsetMs > windowMs / 2) {
          tick.resolved = true;
          if (!tick.held) {
            const missed = new THREE.Vector3(xyAt(tick.time - start).x, xyAt(tick.time - start).y, spec.bandZ);
            events.push({ type: 'miss', key: tick.key, position: missed, side: spec.hand });
          }
        }
      }

      return events;
    },

    dispose(): void {
      shellGeometry.dispose();
      shellMaterial.dispose();
      coreGeometry.dispose();
      coreMaterial.dispose();
      glowGeometry.dispose();
      glowMaterial.dispose();
      haloGeometry.dispose();
      haloMaterial.dispose();
      headGeometry.dispose();
      headMaterial.dispose();
      headGlowTexture.dispose();
      headHaloMaterial.dispose();
      beadGeometry.dispose();
      beadMaterial.dispose();
      group.clear();
    },
  };
}
