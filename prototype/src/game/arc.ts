import * as THREE from 'three';

import { createFresnelGlowMaterial } from '../materials/glow';
import type { MaterialLibrary } from '../materials/library';
import { HAND_LEFT, HAND_RIGHT } from '../materials/palette';
import { createGlowTexture } from '../materials/textures';
import type { HandSample, HandSide } from './hands';

/**
 * arc：一条**滚过来的**弧，手跟着它在判定带上经过的那个点。
 *
 * 借鉴 Arcaea 的算法：
 * - 弧是一组「时间 → (x, y)」的控制点，判定位置随时间沿弧移动（`u = 时间进度`）；
 * - 弧本身画成一条沿时间轴的 3D 管：局部 z = -流速 × (t - 起点)，
 *   整条管按 `bandZ + 流速 × (now - 起点)` 平移——于是它像键一样朝玩家滚过来，
 *   而判定点永远落在判定带上；
 * - 物量：普通物量沿弧均匀分布、可以重连；**关键物量**在谱面指定的位置，
 *   体积更小、窗口更短，必须当场接住。
 *
 * 判定窗口是毫秒，与流速无关（§2）：流速只改视觉滚动，不改任何一个窗口。
 */

export interface ArcTick {
  /** 在弧上的位置（0–1）。 */
  u: number;
  /** 这个物量经过判定带的时刻（绝对时钟，秒）。 */
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
  /** 控制点：只用 x / y（z 由时间轴算出来）。 */
  path: THREE.Vector3[];
  startAt: number;
  duration: number;
  /** 判定带 z。 */
  bandZ: number;
  /** 视觉滚动速度（米 / 秒），只影响弧滚多快，不影响判定。 */
  speed: number;
  /** 近端裁剪面：弧滚过判定带之后就消失，避免穿过玩家。 */
  clipZ: number;
  hand: HandSide;
  normalTicks: number;
  keyUs: number[];
}

export interface ArcNote {
  group: THREE.Group;
  hand: HandSide;
  startAt: number;
  duration: number;
  ticks: ArcTick[];
  /** 某个时刻，判定点在世界里的位置（光点）。 */
  positionAt(time: number): THREE.Vector3;
  update(clock: number, dt: number, hands: HandSample[]): ArcEvent[];
  dispose(): void;
}

/** 手要贴在光点这么大范围内，弧才算「被跟着」（只影响发光）。 */
const FOLLOW_RADIUS = 0.2;
/** 普通物量：判定半径与窗口。放宽过一档。 */
const NORMAL_RADIUS = 0.19;
const NORMAL_WINDOW = 0.2;
/** 关键物量：**判定半径与普通物量相同**——难度只来自更短的窗口，不靠缩小体积。 */
const KEY_RADIUS = NORMAL_RADIUS;
const KEY_WINDOW = 0.12;
/** 手在 z 方向上离判定带多远还算「在判定带上」。 */
const BAND_ZONE = 0.42;

export function createArcNote(spec: ArcSpec, lib: MaterialLibrary): ArcNote {
  const colors = spec.hand === 'left' ? HAND_LEFT : HAND_RIGHT;
  const group = new THREE.Group();
  group.name = 'arc';

  const count = spec.path.length;
  const localPoints = spec.path.map((point, index) => {
    const u = count > 1 ? index / (count - 1) : 0;
    return new THREE.Vector3(point.x, point.y, -spec.speed * spec.duration * u);
  });
  const curve = new THREE.CatmullRomCurve3(localPoints);
  const segments = 96;

  // 近端裁剪：滚过台面边缘的那一段直接剪掉，不让它穿过玩家。
  const clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, 0, -1), spec.clipZ)];

  const shellMaterial = (spec.hand === 'left' ? lib.clearGlassLeft : lib.clearGlassRight).clone();
  shellMaterial.emissive.setHex(colors.emissive);
  shellMaterial.emissiveIntensity = 0;
  shellMaterial.opacity = 0.42;
  shellMaterial.clippingPlanes = clippingPlanes;

  const shellGeometry = new THREE.TubeGeometry(curve, segments, 0.018, 14, false);
  const shell = new THREE.Mesh(shellGeometry, shellMaterial);
  group.add(shell);

  const coreMaterial = (spec.hand === 'left' ? lib.glassCoreLeft : lib.glassCoreRight).clone();
  coreMaterial.clippingPlanes = clippingPlanes;
  const coreGeometry = new THREE.TubeGeometry(curve, segments, 0.007, 8, false);
  const core = new THREE.Mesh(coreGeometry, coreMaterial);
  group.add(core);

  const glowMaterial = createFresnelGlowMaterial(colors.glow, 0.35, 2.2);
  glowMaterial.clippingPlanes = clippingPlanes;
  const glowGeometry = new THREE.TubeGeometry(curve, segments, 0.032, 10, false);
  const glow = new THREE.Mesh(glowGeometry, glowMaterial);
  glow.renderOrder = 4;
  group.add(glow);

  const haloMaterial = createFresnelGlowMaterial(colors.core, 0.2, 2.8);
  haloMaterial.clippingPlanes = clippingPlanes;
  const haloGeometry = new THREE.TubeGeometry(curve, segments, 0.055, 10, false);
  const halo = new THREE.Mesh(haloGeometry, haloMaterial);
  halo.renderOrder = 3;
  group.add(halo);

  // —— 光点（判定点）——
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

  // —— 关键物量：弧上的黄铜珠 ——
  const beadGeometry = new THREE.SphereGeometry(0.016, 16, 16);
  const beadMaterial = new THREE.MeshStandardMaterial({
    color: 0xc9a05a,
    metalness: 0.9,
    roughness: 0.25,
    emissive: 0x3a2a10,
    emissiveIntensity: 0.5,
  });
  beadMaterial.clippingPlanes = clippingPlanes;

  const keyUs = [...spec.keyUs].sort((a, b) => a - b);
  for (const u of keyUs) {
    const bead = new THREE.Mesh(beadGeometry, beadMaterial);
    bead.position.copy(curve.getPoint(u));
    group.add(bead);
  }

  // —— 物量 ——
  const ticks: ArcTick[] = [];
  const normalCount = Math.max(2, Math.round(spec.normalTicks));
  for (let i = 0; i < normalCount; i += 1) {
    const u = (i + 0.5) / normalCount;
    ticks.push({ u, time: spec.startAt + u * spec.duration, key: false, held: false, resolved: false });
  }
  for (const u of keyUs) {
    ticks.push({ u, time: spec.startAt + u * spec.duration, key: true, held: false, resolved: false });
  }
  ticks.sort((a, b) => a.time - b.time);

  let following = 0;

  const note: ArcNote = {
    group,
    hand: spec.hand,
    startAt: spec.startAt,
    duration: spec.duration,
    ticks,

    positionAt(time: number): THREE.Vector3 {
      const progress = THREE.MathUtils.clamp((time - spec.startAt) / spec.duration, 0, 1);
      const point = curve.getPoint(progress);
      return new THREE.Vector3(point.x, point.y, spec.bandZ);
    },

    update(clock: number, dt: number, hands: HandSample[]): ArcEvent[] {
      const events: ArcEvent[] = [];

      const progress = THREE.MathUtils.clamp((clock - spec.startAt) / spec.duration, 0, 1);
      const local = curve.getPoint(progress);

      // 整条弧朝玩家滚：局部 z=0 的那一点正好落在判定带上。
      group.position.z = spec.bandZ + spec.speed * (clock - spec.startAt);

      head.position.copy(local);
      headHalo.position.copy(local);

      const findHand = (radius: number): HandSample | null => {
        for (const hand of hands) {
          if (!hand.active) continue;
          if (spec.hand !== 'none' && hand.side !== spec.hand) continue;
          const dx = hand.position.x - local.x;
          const dy = hand.position.y - local.y;
          if (Math.hypot(dx, dy) > radius) continue;
          if (Math.abs(hand.position.z - spec.bandZ) > BAND_ZONE) continue;
          return hand;
        }
        return null;
      };

      const holder = findHand(FOLLOW_RADIUS);
      following += ((holder ? 1 : 0) - following) * Math.min(1, dt * 10);

      shellMaterial.emissiveIntensity = following * 1.8;
      glowMaterial.uniforms.uIntensity!.value = 0.35 + following * 0.55;
      haloMaterial.uniforms.uIntensity!.value = 0.2 + following * 0.32;
      headHaloMaterial.opacity = 0.4 + following * 0.35;
      headHalo.scale.setScalar(0.15 * (1 + following * 0.25));

      for (const tick of ticks) {
        if (tick.resolved) continue;

        const window = tick.key ? KEY_WINDOW : NORMAL_WINDOW;
        const radius = tick.key ? KEY_RADIUS : NORMAL_RADIUS;

        if (Math.abs(clock - tick.time) <= window / 2) {
          if (tick.held) continue;
          const hand = findHand(radius);
          if (!hand) continue;
          tick.held = true;
          events.push({ type: 'held', key: tick.key, position: hand.position.clone(), side: hand.side });
        } else if (clock > tick.time + window / 2) {
          tick.resolved = true;
          if (!tick.held) {
            const tickPoint = curve.getPoint(tick.u);
            events.push({
              type: 'miss',
              key: tick.key,
              position: new THREE.Vector3(tickPoint.x, tickPoint.y, spec.bandZ),
              side: spec.hand,
            });
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

  return note;
}
