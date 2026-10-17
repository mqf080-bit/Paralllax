import * as THREE from 'three';

import type { ArcPoint } from '../chart/schema';
import { createFresnelGlowMaterial } from '../materials/glow';
import type { MaterialLibrary } from '../materials/library';
import { HAND_LEFT, HAND_RIGHT } from '../materials/palette';
import { createGlowTexture } from '../materials/textures';
import type { HandSample, HandSide } from './hands';

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
  laneWidth: number;
  tableHeight: number;
  bandZ: number;
  clipZ: number;
  baseSpeed: number;
  /** 滚动积分（倍率·毫秒）。 */
  scroll(timeMs: number): number;
}

export interface ArcNote {
  group: THREE.Group;
  hand: HandSide;
  ticks: ArcTick[];
  update(clockMs: number, hands: HandSample[]): ArcEvent[];
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

function easeValue(easing: ArcPoint['easing'], u: number): number {
  const t = Math.min(1, Math.max(0, u));
  switch (easing) {
    case 'linear':
      return t;
    case 'sine':
      return Math.sin((t * Math.PI) / 2);
    case 'cosine':
      return 1 - Math.cos((t * Math.PI) / 2);
    case 'bezier':
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
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
        const eased = easeValue(next.easing, u);
        return {
          x: toWorldX(previous.x + (next.x - previous.x) * eased),
          y: toWorldY(previous.y + (next.y - previous.y) * eased),
        };
      }
      previous = next;
    }
    return { x: toWorldX(previous.x), y: toWorldY(previous.y) };
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
  const curve = new THREE.CatmullRomCurve3(samples);

  const clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, 0, -1), spec.clipZ)];

  const shellMaterial = (spec.hand === 'left' ? lib.clearGlassLeft : lib.clearGlassRight).clone();
  shellMaterial.emissive.setHex(colors.emissive);
  shellMaterial.emissiveIntensity = 0;
  shellMaterial.opacity = 0.42;
  shellMaterial.clippingPlanes = clippingPlanes;

  const shellGeometry = new THREE.TubeGeometry(curve, CURVE_SEGMENTS, 0.018, 14, false);
  group.add(new THREE.Mesh(shellGeometry, shellMaterial));

  const coreMaterial = (spec.hand === 'left' ? lib.glassCoreLeft : lib.glassCoreRight).clone();
  coreMaterial.clippingPlanes = clippingPlanes;
  const coreGeometry = new THREE.TubeGeometry(curve, CURVE_SEGMENTS, 0.007, 8, false);
  group.add(new THREE.Mesh(coreGeometry, coreMaterial));

  const glowMaterial = createFresnelGlowMaterial(colors.glow, 0.35, 2.2);
  glowMaterial.clippingPlanes = clippingPlanes;
  const glowGeometry = new THREE.TubeGeometry(curve, CURVE_SEGMENTS, 0.032, 10, false);
  const glowMesh = new THREE.Mesh(glowGeometry, glowMaterial);
  glowMesh.renderOrder = 4;
  group.add(glowMesh);

  const haloMaterial = createFresnelGlowMaterial(colors.core, 0.2, 2.8);
  haloMaterial.clippingPlanes = clippingPlanes;
  const haloGeometry = new THREE.TubeGeometry(curve, CURVE_SEGMENTS, 0.055, 10, false);
  const haloMesh = new THREE.Mesh(haloGeometry, haloMaterial);
  haloMesh.renderOrder = 3;
  group.add(haloMesh);

  // —— 光点 ——
  const headGeometry = new THREE.SphereGeometry(0.02, 16, 16);
  const headMaterial = new THREE.MeshBasicMaterial({ color: colors.core, toneMapped: false });
  const head = new THREE.Mesh(headGeometry, headMaterial);
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
  group.add(headHalo);

  // —— 关键物量的黄铜珠 ——
  const beadGeometry = new THREE.SphereGeometry(0.016, 16, 16);
  const beadMaterial = new THREE.MeshStandardMaterial({
    color: 0xc9a05a,
    metalness: 0.9,
    roughness: 0.25,
    emissive: 0x3a2a10,
    emissiveIntensity: 0.5,
  });
  beadMaterial.clippingPlanes = clippingPlanes;
  for (const key of spec.keyObjects) {
    const bead = new THREE.Mesh(beadGeometry, beadMaterial);
    bead.position.copy(localAt(key));
    group.add(bead);
  }

  // —— 物量 ——
  const ticks: ArcTick[] = [];
  const normalCount = Math.max(2, Math.round((duration / 1000) * spec.notesPerSecond));
  for (let i = 0; i < normalCount; i += 1) {
    ticks.push({ time: start + ((i + 0.5) / normalCount) * duration, key: false, held: false, resolved: false });
  }
  for (const key of spec.keyObjects) {
    if (key >= 0 && key <= duration) ticks.push({ time: start + key, key: true, held: false, resolved: false });
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

    update(clockMs: number, hands: HandSample[]): ArcEvent[] {
      const events: ArcEvent[] = [];
      const tRel = THREE.MathUtils.clamp(clockMs - start, 0, duration);
      const local = localAt(tRel);

      group.position.z = spec.bandZ + ((spec.scroll(clockMs) - spec.scroll(start)) * spec.baseSpeed) / 1000;
      head.position.copy(local);
      headHalo.position.copy(local);

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
