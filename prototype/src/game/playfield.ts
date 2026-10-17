import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

import type { TableGeometry, TableParams } from '../config';
import type { MaterialLibrary } from '../materials/library';
import type { HandSample, HandSide } from './hands';
import type { Grade } from './judgement';
import { createJudgementPopup, type JudgementPopup } from './popup';
import { createShatter, type Shatter } from './shatter';

/**
 * 打击练习场：一波 drag 楼梯，一波 hold，交替出现。
 *
 * 判定沿用 `parallax-idea.md` 2「判定输入」：只看手的**位移速度 / 位移距离 / 时间窗口**。
 *
 * 这一版有两条规则：
 * - drag / hold **只有 PERFECT 与 MISS**：接上物量就是完美，接不上就是漏（§2，没有 good）；
 * - hold 是「按住」：手要一直留在片子里，片子扫过去的过程中，手在片内的时间占比够一半才算接上。
 *
 * 没有谱面、没有计分、没有左右手——先验证手感。
 */

export interface PlayfieldSettings {
  enabled: boolean;
  /** 谱面流速（米 / 秒）。 */
  flowSpeed: number;
  /** drag 楼梯里两条冰条的时间差（秒）。 */
  interval: number;
  /** dev：自动打（一个虚拟手按拍子扫 / 按住），用来验证判定与反馈。 */
  auto: boolean;
}

export interface PlayfieldStats {
  perfect: number;
  good: number;
  miss: number;
  lastGrade: Grade | null;
  lastOffsetMs: number | null;
}

export interface PlayfieldHooks {
  /** 每判定一条时回调：手别 + 等级 + 时间偏移（毫秒）。 */
  onJudge?(side: HandSide, grade: Grade, offsetMs: number): void;
}

export interface Playfield {
  group: THREE.Group;
  settings: PlayfieldSettings;
  readonly stats: PlayfieldStats;
  /** 冰条中心高度（手要扫过的高度）。 */
  readonly barY: number;
  update(dt: number, hands: HandSample[]): void;
  restart(): void;
  dispose(): void;
}

type NoteKind = 'drag' | 'hold';

interface Note {
  kind: NoteKind;
  lane: number;
  laneX: number;
  group: THREE.Group;
  /** 头部（靠近玩家的一端）到达判定带的时刻。 */
  arriveAt: number;
  /** hold 的按住时长；drag 为 0。 */
  duration: number;
  /** hold 的世界长度（= 流速 × 时长）。 */
  length: number;
  sheet?: THREE.Mesh;
  strip?: THREE.Mesh;
  /** hold 已经按住的时间。 */
  heldTime: number;
  resolved: boolean;
}

/** 冰条离台面的高度（和键型预览一致）。 */
const BAR_HEIGHT = 0.07;
/** drag 判定盒（半尺寸，米）。第一版偏严，整体放宽了一档。 */
const HIT_HALF_X = 0.13;
const HIT_HALF_Y = 0.26;
const HIT_HALF_Z = 0.16;
/** 手要有多快才算「扫过」（米 / 秒）。 */
const MIN_SWEEP_SPEED = 0.4;
/** drag 只有离判定带这么近才可打（防止提前伸手抓远处的键）。 */
const CATCH_WINDOW = 0.5;
/** drag 越过判定带这么远还没碎 = 漏。 */
const MISS_DISTANCE = 0.55;
/** hold 的接触盒（x / y）；z 用片子本身的 z 范围。 */
const HOLD_HALF_X = 0.13;
const HOLD_HALF_Y = 0.26;
/** hold 的按住占比达到这个值就算接上。 */
const HOLD_REQUIRED = 0.5;
/** hold 的尾端完全越过判定带这么远才结算。 */
const HOLD_MISS_MARGIN = 0.6;
/** 第一颗键从出生到判定带的飞行时间（秒）。 */
const LEAD_IN = 1.35;
/** 一波结束后到下一波的间隔（秒）。 */
const WAVE_PAUSE = 1.3;
/** hold 的按住时长（秒）。 */
const HOLD_DURATION = 0.8;

export function createPlayfield(
  params: TableParams,
  geometry: TableGeometry,
  lib: MaterialLibrary,
  settings: PlayfieldSettings,
  hooks: PlayfieldHooks = {},
): Playfield {
  const stats: PlayfieldStats = { perfect: 0, good: 0, miss: 0, lastGrade: null, lastOffsetMs: null };

  const group = new THREE.Group();
  group.name = 'playfield';
  const barY = params.tableHeight + BAR_HEIGHT;
  const laneCount = geometry.laneX.length;
  const leftLane = geometry.laneX[0] ?? 0;
  const rightLane = geometry.laneX[laneCount - 1] ?? 0;

  const notes: Note[] = [];
  let clock = 0;
  let nextWaveAt = 0.35;
  let waveActive = false;
  let waveCount = 0;
  let waveStart = 0;
  let waveEnd = 0;

  // 共享几何：同类键只有位置不同。
  const barGeometry = new RoundedBoxGeometry(0.195, 0.011, 0.022, 2, 0.0035);
  const glowGeometry = new THREE.PlaneGeometry(0.3, 0.12);
  const holdSheetGeometry = new RoundedBoxGeometry(0.21, 0.006, 1, 2, 0.0025);
  const holdStripGeometry = new THREE.BoxGeometry(0.09, 0.0025, 1);

  const shatter: Shatter = createShatter();
  group.add(shatter.group);

  const popup: JudgementPopup = createJudgementPopup();
  group.add(popup.group);

  // —— 自动打的虚拟手 ——
  const ghost = new THREE.Mesh(
    new THREE.SphereGeometry(0.022, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xa8e8ff, transparent: true, opacity: 0.75, toneMapped: false }),
  );
  ghost.name = 'play-ghost-hand';
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

  const popupPosition = new THREE.Vector3();

  function removeNote(note: Note): void {
    group.remove(note.group);
    note.group.clear();
  }

  function notePerfect(note: Note, side: HandSide, offsetMs: number): void {
    note.resolved = true;
    stats.perfect += 1;
    stats.lastGrade = 'perfect';
    stats.lastOffsetMs = offsetMs;

    popupPosition.set(note.laneX, barY + 0.1, THREE.MathUtils.clamp(note.group.position.z, geometry.bandZ - 0.25, geometry.bandZ + 0.25));
    popup.spawn('perfect', popupPosition);
    hooks.onJudge?.(side, 'perfect', offsetMs);
  }

  function noteMiss(note: Note): void {
    note.resolved = true;
    stats.miss += 1;
    stats.lastGrade = 'miss';
    stats.lastOffsetMs = null;

    popupPosition.set(note.laneX, barY + 0.1, geometry.bandZ + 0.1);
    popup.spawn('miss', popupPosition);
    hooks.onJudge?.('none', 'miss', 0);
  }

  function spawnDragStaircase(): void {
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

      notes.push({
        kind: 'drag',
        lane,
        laneX,
        group: noteGroup,
        arriveAt,
        duration: 0,
        length: 0,
        heldTime: 0,
        resolved: false,
      });
    }
  }

  function spawnHold(): void {
    waveStart = clock + LEAD_IN;
    waveEnd = waveStart + HOLD_DURATION;

    const lane = (waveCount / 2) % 2 === 1 ? 2 : 1;
    const laneX = geometry.laneX[lane] ?? 0;
    const length = Math.max(settings.flowSpeed * HOLD_DURATION, 0.6);

    const noteGroup = new THREE.Group();
    noteGroup.name = `hold-lane${lane + 1}`;
    noteGroup.position.set(laneX, params.tableHeight + 0.004, geometry.bandZ - settings.flowSpeed * (waveStart - clock));

    const sheet = new THREE.Mesh(holdSheetGeometry, lib.clearGlass);
    sheet.scale.z = length;
    sheet.position.z = length / 2;
    noteGroup.add(sheet);

    const strip = new THREE.Mesh(holdStripGeometry, lib.holdFill);
    strip.position.set(0, 0.0045, 0);
    strip.visible = false;
    noteGroup.add(strip);

    group.add(noteGroup);

    notes.push({
      kind: 'hold',
      lane,
      laneX,
      group: noteGroup,
      arriveAt: waveStart,
      duration: HOLD_DURATION,
      length,
      sheet,
      strip,
      heldTime: 0,
      resolved: false,
    });
  }

  function spawnWave(): void {
    waveActive = true;
    waveCount += 1;
    if (waveCount % 2 === 1) spawnDragStaircase();
    else spawnHold();
  }

  function handInLane(hand: HandSample, laneX: number, halfY: number): boolean {
    return (
      hand.active &&
      Math.abs(hand.position.x - laneX) <= HOLD_HALF_X &&
      Math.abs(hand.position.y - barY) <= halfY
    );
  }

  function judgeDrag(note: Note, samples: HandSample[]): void {
    const z = note.group.position.z;
    const distance = z - geometry.bandZ;

    if (distance > MISS_DISTANCE) {
      noteMiss(note);
      return;
    }
    if (Math.abs(distance) > CATCH_WINDOW) return;

    for (const hand of samples) {
      if (!hand.active || hand.velocity.length() < MIN_SWEEP_SPEED) continue;
      if (Math.abs(hand.position.x - note.laneX) > HIT_HALF_X) continue;
      if (Math.abs(hand.position.y - barY) > HIT_HALF_Y) continue;
      if (Math.abs(hand.position.z - z) > HIT_HALF_Z) continue;

      const offsetMs = Math.round((distance / settings.flowSpeed) * 1000);
      notePerfect(note, hand.side, offsetMs);

      shatterDirection.copy(hand.velocity);
      if (shatterDirection.lengthSq() < 1e-6) shatterDirection.set(0, 0.6, -1);
      shatter.spawn(note.group.position, shatterDirection, 0xcfefff, 12);

      removeNote(note);
      return;
    }
  }

  function updateHold(note: Note, dt: number, samples: HandSample[]): void {
    const headZ = geometry.bandZ + settings.flowSpeed * (clock - note.arriveAt);
    const tailZ = headZ - note.length;
    note.group.position.z = tailZ;

    // 片子滑过近端就裁掉：不然它会一直伸到玩家身后去。
    const clipNear = geometry.nearZ + 0.02;
    const visibleHead = Math.min(headZ, clipNear);
    const visibleLength = Math.max(visibleHead - tailZ, 0);

    const sheet = note.sheet;
    if (sheet) {
      sheet.scale.z = Math.max(visibleLength, 0.0001);
      sheet.position.z = visibleLength / 2;
    }

    // 已经越过判定带的部分 = 被「吃掉」的部分，从判定带向头部发光。
    const litStart = Math.max(geometry.bandZ, tailZ);
    const litLength = Math.max(visibleHead - litStart, 0);
    const strip = note.strip;
    if (strip) {
      strip.visible = litLength > 0.01;
      strip.scale.z = Math.max(litLength, 0.0001);
      strip.position.z = litStart - tailZ + litLength / 2;
    }

    // 接触：手在轨道内，且手的 z 落在片子覆盖的范围里。
    const inContact = samples.some(
      (hand) =>
        handInLane(hand, note.laneX, HOLD_HALF_Y) &&
        hand.position.z >= tailZ - 0.05 &&
        hand.position.z <= headZ + 0.05,
    );
    if (inContact && clock >= note.arriveAt - 0.1) note.heldTime += dt;

    // 尾端完全过去才结算。
    if (tailZ > geometry.bandZ + HOLD_MISS_MARGIN) {
      const ratio = Math.min(note.heldTime / note.duration, 1);
      if (ratio >= HOLD_REQUIRED) notePerfect(note, 'none', 0);
      else noteMiss(note);
      removeNote(note);
    }
  }

  function updateGhost(dt: number): HandSample | null {
    if (!settings.auto) {
      ghost.visible = false;
      ghostPrev.set(leftLane, barY, geometry.bandZ);
      return null;
    }

    let targetX = ghostPosition.x;
    const hold = notes.find((note) => note.kind === 'hold' && !note.resolved);
    if (hold) {
      targetX = hold.laneX;
    } else if (clock >= waveStart && clock <= waveEnd) {
      const t = (clock - waveStart) / Math.max(waveEnd - waveStart, 1e-3);
      targetX = leftLane + (rightLane - leftLane) * t;
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
        popup.update(dt);
        return;
      }

      if (clock >= nextWaveAt && !waveActive) spawnWave();

      for (const note of notes) {
        if (note.resolved) continue;
        if (note.kind === 'drag') {
          note.group.position.z = geometry.bandZ - settings.flowSpeed * (note.arriveAt - clock);
        }
      }

      const auto = updateGhost(dt);
      const samples = auto ? [...hands, auto] : hands;

      for (const note of notes) {
        if (note.resolved) continue;
        if (note.kind === 'drag') judgeDrag(note, samples);
        else updateHold(note, dt, samples);
      }

      // 收拾已经滑出近端的键（漏掉的也要滑出去）。
      for (let i = notes.length - 1; i >= 0; i -= 1) {
        const note = notes[i]!;
        if (note.group.position.z > geometry.nearZ + 0.6) {
          removeNote(note);
          notes.splice(i, 1);
        }
      }

      if (waveActive && notes.every((note) => note.resolved)) {
        waveActive = false;
        nextWaveAt = clock + WAVE_PAUSE;
      }

      shatter.update(dt);
      popup.update(dt);
    },

    restart(): void {
      for (const note of notes) removeNote(note);
      notes.length = 0;
      stats.perfect = 0;
      stats.good = 0;
      stats.miss = 0;
      stats.lastGrade = null;
      stats.lastOffsetMs = null;
      waveActive = false;
      waveCount = 0;
      waveStart = 0;
      waveEnd = 0;
      clock = 0;
      nextWaveAt = 0.35;
    },

    dispose(): void {
      for (const note of notes) removeNote(note);
      notes.length = 0;
      barGeometry.dispose();
      glowGeometry.dispose();
      holdSheetGeometry.dispose();
      holdStripGeometry.dispose();
      shatter.dispose();
      popup.dispose();
      ghost.geometry.dispose();
      (ghost.material as THREE.Material).dispose();
      group.clear();
    },
  };
}
