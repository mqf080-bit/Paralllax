import * as THREE from 'three';

import { createFresnelGlowMaterial } from '../materials/glow';
import { createGlowTexture } from '../materials/textures';
import type { MaterialLibrary } from '../materials/library';
import { HAND_LEFT, HAND_RIGHT } from '../materials/palette';
import type { HandSample, HandSide } from './hands';

/**
 * arc：一条固定在世界里的弧，一个光点沿着它走，手跟着光点。
 *
 * 这是「跟随」而不是「击中」：手不需要挥，只要在光点经过的时候贴在上面。
 * 借鉴 Arcaea 的部分是**物量结构**：
 * - 普通物量：沿弧均匀分布，中途断开可以从容重连（窗口内贴回来就行）；
 * - **关键物量**：谱面指定的关键位置，体积更小、窗口更短——必须当场接住，
 *   断开重连补不回来，漏了就损失那份物量。
 *
 * 判定窗口是**毫秒**，与流速无关（§2）。弧的形状固定，流速只影响别的键。
 */

export interface ArcTick {
  /** 在弧上的位置（0–1，按弧长）。 */
  u: number;
  /** 光点走到这里的时刻（绝对时钟，秒）。 */
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
  points: THREE.Vector3[];
  startAt: number;
  duration: number;
  hand: HandSide;
  /** 普通物量的个数（均匀分布）。 */
  normalTicks: number;
  /** 关键物量的位置（0–1）。 */
  keyUs: number[];
}

export interface ArcNote {
  group: THREE.Group;
  hand: HandSide;
  startAt: number;
  duration: number;
  ticks: ArcTick[];
  /** 某个时刻光点的位置（自动演示用）。 */
  positionAt(time: number): THREE.Vector3;
  update(clock: number, dt: number, hands: HandSample[]): ArcEvent[];
  dispose(): void;
}

/** 手要贴在光点这么大范围内，弧才算「被跟着」（只影响发光）。 */
const FOLLOW_RADIUS = 0.2;
/** 普通物量：判定半径与窗口。 */
const NORMAL_RADIUS = 0.16;
const NORMAL_WINDOW = 0.2;
/** 关键物量：更小的体积、更短的窗口——必须当场接住。 */
const KEY_RADIUS = 0.1;
const KEY_WINDOW = 0.12;

export function createArcNote(spec: ArcSpec, lib: MaterialLibrary): ArcNote {
  const colors = spec.hand === 'left' ? HAND_LEFT : HAND_RIGHT;
  const group = new THREE.Group();
  group.name = 'arc';

  const curve = new THREE.CatmullRomCurve3(spec.points);
  const segments = 96;

  const shellMaterial = (spec.hand === 'left' ? lib.clearGlassLeft : lib.clearGlassRight).clone();
  shellMaterial.emissive.setHex(colors.emissive);
  shellMaterial.emissiveIntensity = 0;
  shellMaterial.opacity = 0.42;

  const shellGeometry = new THREE.TubeGeometry(curve, segments, 0.018, 14, false);
  const shell = new THREE.Mesh(shellGeometry, shellMaterial);
  group.add(shell);

  const coreGeometry = new THREE.TubeGeometry(curve, segments, 0.007, 8, false);
  const core = new THREE.Mesh(coreGeometry, spec.hand === 'left' ? lib.glassCoreLeft : lib.glassCoreRight);
  group.add(core);

  const glowMaterial = createFresnelGlowMaterial(colors.glow, 0.35, 2.2);
  const glowGeometry = new THREE.TubeGeometry(curve, segments, 0.032, 10, false);
  const glow = new THREE.Mesh(glowGeometry, glowMaterial);
  glow.renderOrder = 4;
  group.add(glow);

  const haloMaterial = createFresnelGlowMaterial(colors.core, 0.2, 2.8);
  const haloGeometry = new THREE.TubeGeometry(curve, segments, 0.055, 10, false);
  const halo = new THREE.Mesh(haloGeometry, haloMaterial);
  halo.renderOrder = 3;
  group.add(halo);

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
  headHalo.scale.set(0.16, 0.16, 1);
  group.add(headHalo);

  // —— 关键物量：弧上的一枚黄铜珠，看得见「这里有关键点」——
  const beadGeometry = new THREE.SphereGeometry(0.016, 16, 16);
  const beadMaterial = new THREE.MeshStandardMaterial({
    color: 0xc9a05a,
    metalness: 0.9,
    roughness: 0.25,
    emissive: 0x3a2a10,
    emissiveIntensity: 0.5,
  });
  const keyUs = [...spec.keyUs].sort((a, b) => a - b);
  for (const u of keyUs) {
    const bead = new THREE.Mesh(beadGeometry, beadMaterial);
    bead.position.copy(curve.getPointAt(u));
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
  const headPosition = new THREE.Vector3();

  const note: ArcNote = {
    group,
    hand: spec.hand,
    startAt: spec.startAt,
    duration: spec.duration,
    ticks,

    positionAt(time: number): THREE.Vector3 {
      const progress = THREE.MathUtils.clamp((time - spec.startAt) / spec.duration, 0, 1);
      return curve.getPointAt(progress);
    },

    update(clock: number, dt: number, hands: HandSample[]): ArcEvent[] {
      const events: ArcEvent[] = [];

      const progress = THREE.MathUtils.clamp((clock - spec.startAt) / spec.duration, 0, 1);
      curve.getPointAt(progress, headPosition);
      head.position.copy(headPosition);
      headHalo.position.copy(headPosition);

      const findHand = (radius: number): HandSample | null => {
        for (const hand of hands) {
          if (!hand.active) continue;
          if (spec.hand !== 'none' && hand.side !== spec.hand) continue;
          if (hand.position.distanceTo(headPosition) <= radius) return hand;
        }
        return null;
      };

      const holder = findHand(FOLLOW_RADIUS);
      following += ((holder ? 1 : 0) - following) * Math.min(1, dt * 10);

      // 跟着的时候整条弧亮起来：玻璃自发光 + 外层光晕一起加。
      shellMaterial.emissiveIntensity = following * 1.8;
      glowMaterial.uniforms.uIntensity!.value = 0.35 + following * 0.55;
      haloMaterial.uniforms.uIntensity!.value = 0.2 + following * 0.32;
      headHaloMaterial.opacity = 0.4 + following * 0.35;
      headHalo.scale.setScalar(0.16 * (1 + following * 0.25));

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
            events.push({ type: 'miss', key: tick.key, position: curve.getPointAt(tick.u), side: spec.hand });
          }
        }
      }

      return events;
    },

    dispose(): void {
      shellGeometry.dispose();
      shellMaterial.dispose();
      coreGeometry.dispose();
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
