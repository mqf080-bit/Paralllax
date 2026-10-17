import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

import type { TableGeometry, TableParams } from '../config';
import type { MaterialLibrary } from '../materials/library';
import type { HandSample, HandSide } from './hands';
import { createShatter, type Shatter } from './shatter';

/**
 * drag 的打击练习：4 条轨依次飘来一条冰条，形成楼梯。
 *
 * 判定沿用 `parallax-idea.md` 2「判定输入」：只看手的**位移速度 / 位移距离 / 时间窗口**，
 * 不检测力、不要求方向。drag 的门槛比 hit 松：手扫过去就行。
 *
 * 具体实现：
 * - 冰条按时间表从远端飘向判定带，4 条之间差 `interval` 秒，于是排成楼梯；
 * - 手进入冰条周围的一个扁盒子（x 半宽 0.11 / y 半高 0.14 / z 半深 0.10）且速度够 → 碎；
 * - 冰条越过判定带 0.5m 还没碎 → 记为漏，继续滑出去。
 *
 * 这一版没有谱面、没有计分、没有左右手——只验证「扫过去能碎」这件事。
 */

export interface DragWaveSettings {
  enabled: boolean;
  /** 谱面流速（米 / 秒）。 */
  flowSpeed: number;
  /** 同一次楼梯里两条冰条的时间差（秒）。 */
  interval: number;
  /** dev：自动扫（一个虚拟手按拍子扫过 1–4 轨），用来验证判定与反馈。 */
  auto: boolean;
}

export interface DragWaveStats {
  hits: number;
  misses: number;
  lastOffsetMs: number | null;
  lastGrade: string | null;
}

export interface DragWave {
  group: THREE.Group;
  settings: DragWaveSettings;
  readonly stats: DragWaveStats;
  /** 冰条中心高度（手要扫过的高度）。 */
  readonly barY: number;
  update(dt: number, hands: HandSample[]): void;
  restart(): void;
  dispose(): void;
}

interface Note {
  lane: number;
  laneX: number;
  /** 到达判定带的时刻（秒，局部时钟）。 */
  arriveAt: number;
  resolved: boolean;
  group: THREE.Group;
}

/** 冰条离台面的高度（和键型预览一致）。 */
const BAR_HEIGHT = 0.07;
/** 判定盒（半尺寸，米）。x 小于半轨宽，y 给手腕留余量。 */
const HIT_HALF_X = 0.11;
const HIT_HALF_Y = 0.2;
const HIT_HALF_Z = 0.1;
/** 手要有多快才算「扫过」（米 / 秒）。低于这个速度只是碰到，不算。 */
const MIN_SWEEP_SPEED = 0.45;
/** 冰条只有离判定带这么近才可打（防止提前伸手抓远处的键）。 */
const CATCH_WINDOW = 0.45;
/** 越过判定带这么远还没碎 = 漏。 */
const MISS_DISTANCE = 0.5;
/** 第一颗冰条从出生到判定带的飞行时间（秒）。 */
const LEAD_IN = 1.35;
/** 一波结束后到下一波的间隔（秒）。 */
const WAVE_PAUSE = 1.3;

export interface DragWaveHooks {
  /** 每扫碎一条时回调：手别 + 判定偏移（毫秒）。 */
  onHit?(side: HandSide, offsetMs: number): void;
}

export function createDragWave(
  params: TableParams,
  geometry: TableGeometry,
  lib: MaterialLibrary,
  settings: DragWaveSettings,
  hooks: DragWaveHooks = {},
): DragWave {
  const stats: DragWaveStats = { hits: 0, misses: 0, lastOffsetMs: null, lastGrade: null };

  const group = new THREE.Group();
  group.name = 'drag-wave';
  const barY = params.tableHeight + BAR_HEIGHT;
  const laneCount = geometry.laneX.length;
  const leftLane = geometry.laneX[0] ?? 0;
  const rightLane = geometry.laneX[laneCount - 1] ?? 0;

  const notes: Note[] = [];
  let clock = 0;
  let nextWaveAt = 0.35;
  let waveActive = false;
  let waveStart = 0;
  let waveEnd = 0;

  // 共享几何：每条冰条只有位置不同。
  const barGeometry = new RoundedBoxGeometry(0.195, 0.011, 0.022, 2, 0.0035);
  const glowGeometry = new THREE.PlaneGeometry(0.3, 0.12);

  const shatter: Shatter = createShatter();
  group.add(shatter.group);

  // —— 自动扫的虚拟手 ——
  const ghost = new THREE.Mesh(
    new THREE.SphereGeometry(0.022, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xa8e8ff, transparent: true, opacity: 0.75, toneMapped: false }),
  );
  ghost.name = 'drag-ghost-hand';
  ghost.visible = false;
  group.add(ghost);

  const ghostPosition = new THREE.Vector3(leftLane, barY, geometry.bandZ);
  const ghostVelocity = new THREE.Vector3();
  const ghostPrev = new THREE.Vector3().copy(ghostPosition);
  const autoSample: HandSample = {
    side: 'none',
    source: 'xr',
    position: ghostPosition,
    velocity: ghostVelocity,
    active: true,
  };
  const shatterDirection = new THREE.Vector3();

  function noteZ(note: Note): number {
    return geometry.bandZ - settings.flowSpeed * (note.arriveAt - clock);
  }

  function spawnWave(): void {
    waveActive = true;
    waveStart = clock + LEAD_IN;
    waveEnd = waveStart + (laneCount - 1) * settings.interval;

    for (let lane = 0; lane < laneCount; lane += 1) {
      const arriveAt = waveStart + lane * settings.interval;
      const noteGroup = new THREE.Group();
      noteGroup.name = `drag-lane${lane + 1}`;

      const bar = new THREE.Mesh(barGeometry, lib.iceBar);
      bar.castShadow = true;
      noteGroup.add(bar);

      const glow = new THREE.Mesh(glowGeometry, lib.dragGlow);
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = 0.002;
      glow.renderOrder = 4;
      noteGroup.add(glow);

      const laneX = geometry.laneX[lane]!;
      noteGroup.position.set(laneX, barY, geometry.bandZ - settings.flowSpeed * (arriveAt - clock));
      group.add(noteGroup);

      notes.push({ lane, laneX, arriveAt, resolved: false, group: noteGroup });
    }
  }

  function removeNote(note: Note): void {
    group.remove(note.group);
    note.group.clear();
  }

  function resolveHit(note: Note, hand: HandSample): void {
    note.resolved = true;
    stats.hits += 1;

    const offsetMs = Math.round(((note.group.position.z - geometry.bandZ) / settings.flowSpeed) * 1000);
    stats.lastOffsetMs = offsetMs;
    const abs = Math.abs(offsetMs);
    stats.lastGrade = abs <= 90 ? '完美' : abs <= 200 ? '好' : '命中';

    shatterDirection.copy(hand.velocity);
    if (shatterDirection.lengthSq() < 1e-6) shatterDirection.set(0, 0.6, -1);
    shatter.spawn(note.group.position, shatterDirection, 0xcfefff, 12);

    removeNote(note);
    hooks.onHit?.(hand.side, offsetMs);
  }

  function resolveMiss(note: Note): void {
    note.resolved = true;
    stats.misses += 1;
    stats.lastGrade = '漏';
  }

  function judge(samples: HandSample[]): void {
    for (const note of notes) {
      if (note.resolved) continue;

      const z = note.group.position.z;
      const distance = z - geometry.bandZ;

      if (distance > MISS_DISTANCE) {
        resolveMiss(note);
        continue;
      }
      if (Math.abs(distance) > CATCH_WINDOW) continue;

      for (const hand of samples) {
        if (!hand.active) continue;
        if (hand.velocity.length() < MIN_SWEEP_SPEED) continue;
        if (Math.abs(hand.position.x - note.laneX) > HIT_HALF_X) continue;
        if (Math.abs(hand.position.y - barY) > HIT_HALF_Y) continue;
        if (Math.abs(hand.position.z - z) > HIT_HALF_Z) continue;

        resolveHit(note, hand);
        break;
      }
    }
  }

  function updateGhost(dt: number): HandSample | null {
    if (!settings.auto) {
      ghost.visible = false;
      ghostPrev.set(leftLane, barY, geometry.bandZ);
      return null;
    }

    let targetX = leftLane;
    if (clock >= waveStart && clock <= waveEnd) {
      const t = (clock - waveStart) / Math.max(waveEnd - waveStart, 1e-3);
      targetX = leftLane + (rightLane - leftLane) * t;
    } else if (clock > waveEnd) {
      targetX = rightLane;
    }

    ghostPosition.set(targetX, barY + 0.006, geometry.bandZ);
    ghostVelocity.copy(ghostPosition).sub(ghostPrev).divideScalar(Math.max(dt, 1e-4));
    ghostPrev.copy(ghostPosition);

    ghost.visible = true;
    ghost.position.copy(ghostPosition);
    return autoSample;
  }

  return {
    group,
    settings,
    stats,
    barY,

    update(dt: number, hands: HandSample[]): void {
      clock += dt;

      if (!settings.enabled) {
        for (const note of notes) removeNote(note);
        notes.length = 0;
        ghost.visible = false;
        shatter.update(dt);
        return;
      }

      if (clock >= nextWaveAt && !waveActive) spawnWave();

      // 冰条的 z 由「到达时刻」反推：改流速不会让已经在飞的键突然跳位置。
      for (const note of notes) note.group.position.z = noteZ(note);

      const auto = updateGhost(dt);
      judge(auto ? [...hands, auto] : hands);

      // 收拾已经滑出近端的键（漏掉的也要滑出去）。
      for (let i = notes.length - 1; i >= 0; i -= 1) {
        const note = notes[i]!;
        if (note.group.position.z > geometry.nearZ + 0.35) {
          removeNote(note);
          notes.splice(i, 1);
        }
      }

      // 一波结束：所有键都判过了，就排下一波。
      if (waveActive && notes.every((note) => note.resolved)) {
        waveActive = false;
        nextWaveAt = clock + WAVE_PAUSE;
      }

      shatter.update(dt);
    },

    restart(): void {
      for (const note of notes) removeNote(note);
      notes.length = 0;
      stats.hits = 0;
      stats.misses = 0;
      stats.lastOffsetMs = null;
      stats.lastGrade = null;
      waveActive = false;
      clock = 0;
      nextWaveAt = 0.35;
      waveStart = 0;
      waveEnd = 0;
    },

    dispose(): void {
      for (const note of notes) removeNote(note);
      notes.length = 0;
      barGeometry.dispose();
      glowGeometry.dispose();
      shatter.dispose();
      ghost.geometry.dispose();
      (ghost.material as THREE.Material).dispose();
      group.clear();
    },
  };
}
