import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

import type { TableGeometry, TableParams } from '../config';
import type { MaterialLibrary } from '../materials/library';
import { createGlowTexture } from '../materials/textures';
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
  /** hold 里的物量个数；越多密度越高，判定窗口越窄（下限 200ms）。 */
  holdTicks: number;
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

type NoteKind = 'drag' | 'hold' | 'hit';

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
  sheetMaterial?: THREE.MeshPhysicalMaterial;
  strip?: THREE.Mesh;
  stripMaterial?: THREE.MeshBasicMaterial;
  /** 被按住的强度 0–1：用来驱动发光与触点亮斑。 */
  glow?: number;
  aura?: THREE.Mesh;
  auraMaterial?: THREE.MeshBasicMaterial;
  /** hold 里的物量：每个 tick 是一次判定，时间点由物量密度决定。 */
  ticks?: HoldTick[];
  /** 单个 tick 的容错窗口（秒），密度越高越窄，但不窄于 200ms。 */
  tickWindow?: number;
  /** 最后一次「按住」时手的位置，判定提示弹在这里。 */
  lastContact?: THREE.Vector3;
  /** 这一帧是否按住了（只给 hold 用）。 */
  contact?: boolean;
  /** hit 要求的手别；'none' = 中性（任意手）。 */
  hand?: HandSide;
  resolved: boolean;
}

interface HoldTick {
  /** 世界时钟上的时刻（秒）。 */
  time: number;
  held: boolean;
  resolved: boolean;
}

/** hit 的挥击门槛：速度 / 挥击距离。drag 是「扫过」，hit 是「明确挥一下」。 */
const HIT_GOOD_SPEED = 1.4;
const HIT_PERFECT_SPEED = 2.6;
/** 最近 120ms 内手至少要走过这么远，才算一次挥击（不是抖一下）。 */
const HIT_MIN_SWING = 0.15;
/** hit 楼梯里两颗之间的时间差（秒）。挥击比扫过慢，间隔给大一点。 */
const HIT_INTERVAL = 0.38;

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
/** 单个物量的最小容错窗口（秒）：密度再高也不会窄过这个值。 */
const HOLD_MIN_WINDOW = 0.2;
/** 单个物量的最大容错窗口（秒）：密度很低时也不会松到无脑。 */
const HOLD_MAX_WINDOW = 0.6;
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
  const hitBarGeometry = new RoundedBoxGeometry(0.21, 0.055, 0.075, 3, 0.008);
  const holdSheetGeometry = new RoundedBoxGeometry(0.21, 0.006, 1, 2, 0.0025);
  const holdStripGeometry = new THREE.BoxGeometry(0.09, 0.0025, 1);
  const holdAuraGeometry = new THREE.PlaneGeometry(1, 1);

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

  // 按住时手下的光斑：告诉玩家「这一下按对了」，也给片子一点照明感。
  const touchTexture = createGlowTexture(128);
  const touchMaterial = new THREE.SpriteMaterial({
    map: touchTexture,
    color: 0x9fe8ff,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    opacity: 0,
  });
  const touchGlow = new THREE.Sprite(touchMaterial);
  touchGlow.name = 'hold-touch-glow';
  touchGlow.visible = false;
  touchGlow.renderOrder = 6;
  group.add(touchGlow);

  const ghostPosition = new THREE.Vector3(leftLane, barY, geometry.bandZ);
  const ghostVelocity = new THREE.Vector3();
  const ghostPrev = new THREE.Vector3().copy(ghostPosition);
  const autoSample: HandSample = {
    side: 'none',
    source: 'xr',
    position: ghostPosition,
    velocity: ghostVelocity,
    active: true,
    pressed: true,
    swing: 0,
  };
  const shatterDirection = new THREE.Vector3();

  const popupPosition = new THREE.Vector3();

  function removeNote(note: Note): void {
    group.remove(note.group);
    note.group.clear();
    note.sheetMaterial?.dispose();
    note.stripMaterial?.dispose();
    note.auraMaterial?.dispose();
  }

  function notePerfect(note: Note, side: HandSide, offsetMs: number, at?: THREE.Vector3): void {
    note.resolved = true;
    stats.perfect += 1;
    stats.lastGrade = 'perfect';
    stats.lastOffsetMs = offsetMs;

    if (at) {
      popupPosition.copy(at);
    } else {
      popupPosition.set(
        note.laneX,
        barY + 0.1,
        THREE.MathUtils.clamp(note.group.position.z, geometry.bandZ - 0.25, geometry.bandZ + 0.25),
      );
    }
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

  /** hold 的物量被按住：当场蹦出碎屑 + 一个小小的 PERFECT。 */
  function tickHeld(position: THREE.Vector3, side: HandSide): void {
    stats.perfect += 1;
    stats.lastGrade = 'perfect';
    stats.lastOffsetMs = null;
    shatterDirection.set(0, 1, -0.15);
    shatter.spawn(position, shatterDirection, 0xbfe9ff, 4);
    popup.spawn('perfect', position, { scale: 0.62, life: 0.32 });
    hooks.onJudge?.(side, 'perfect', 0);
  }

  /** hold 的物量漏了：立刻在原地弹一个 MISS，不等 hold 结束。 */
  function tickMissed(note: Note): void {
    stats.miss += 1;
    stats.lastGrade = 'miss';
    stats.lastOffsetMs = null;
    popupPosition.set(note.laneX, barY - 0.02, geometry.bandZ);
    popup.spawn('miss', popupPosition);
    hooks.onJudge?.('none', 'miss', 0);
  }

  /** hit 的测试串：左右手交替、左右两侧各两下。 */
  const HIT_RUN: ReadonlyArray<{ lane: number; hand: HandSide }> = [
    { lane: 0, hand: 'left' },
    { lane: 3, hand: 'right' },
    { lane: 1, hand: 'left' },
    { lane: 2, hand: 'right' },
  ];

  function spawnHitRun(): void {
    waveStart = clock + LEAD_IN;
    waveEnd = waveStart + (HIT_RUN.length - 1) * HIT_INTERVAL;

    for (let index = 0; index < HIT_RUN.length; index += 1) {
      const spec = HIT_RUN[index]!;
      const arriveAt = waveStart + index * HIT_INTERVAL;
      const laneX = geometry.laneX[spec.lane]!;

      const noteGroup = new THREE.Group();
      noteGroup.name = `hit-lane${spec.lane + 1}-${spec.hand}`;

      const material =
        spec.hand === 'left' ? lib.ceramicLeft : spec.hand === 'right' ? lib.ceramicRight : lib.ceramic;
      const bar = new THREE.Mesh(hitBarGeometry, material);
      bar.castShadow = true;
      noteGroup.add(bar);

      noteGroup.position.set(laneX, barY, geometry.bandZ - settings.flowSpeed * (arriveAt - clock));
      group.add(noteGroup);

      notes.push({
        kind: 'hit',
        lane: spec.lane,
        laneX,
        group: noteGroup,
        arriveAt,
        duration: 0,
        length: 0,
        hand: spec.hand,
        resolved: false,
      });
    }
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
        resolved: false,
      });
    }
  }

  function spawnHold(): void {
    waveStart = clock + LEAD_IN;
    waveEnd = waveStart + HOLD_DURATION;

    const lane = Math.floor(waveCount / 3) % 2 === 0 ? 1 : 2;
    const laneX = geometry.laneX[lane] ?? 0;
    const length = Math.max(settings.flowSpeed * HOLD_DURATION, 0.6);

    const noteGroup = new THREE.Group();
    noteGroup.name = `hold-lane${lane + 1}`;
    noteGroup.position.set(laneX, params.tableHeight + 0.004, geometry.bandZ - settings.flowSpeed * (waveStart - clock));

    // 每条 hold 用自己的材质副本：被按住时整片要发光，不能改到共享材质。
    const sheetMaterial = lib.clearGlass.clone();
    sheetMaterial.emissive.setHex(0x1c6f86);
    sheetMaterial.emissiveIntensity = 0;

    const sheet = new THREE.Mesh(holdSheetGeometry, sheetMaterial);
    sheet.scale.z = length;
    sheet.position.z = length / 2;
    noteGroup.add(sheet);

    const stripMaterial = lib.holdFill.clone();
    const strip = new THREE.Mesh(holdStripGeometry, stripMaterial);
    strip.position.set(0, 0.0045, 0);
    strip.visible = false;
    noteGroup.add(strip);

    // 按住时片子底下透出来的光。
    const auraMaterial = lib.glowLeft.clone();
    auraMaterial.opacity = 0;
    const aura = new THREE.Mesh(holdAuraGeometry, auraMaterial);
    aura.rotation.x = -Math.PI / 2;
    aura.position.y = 0.002;
    aura.visible = false;
    noteGroup.add(aura);

    group.add(noteGroup);

    // 物量：hold 里均匀分布若干个 tick。密度 = 个数 / 时长 → 窗口随密度收紧，
    // 但最窄就是 200ms（`parallax-idea.md` 的容忍度规则）。
    const tickCount = Math.max(1, Math.round(settings.holdTicks));
    const spacing = HOLD_DURATION / tickCount;
    const tickWindow = THREE.MathUtils.clamp(spacing, HOLD_MIN_WINDOW, HOLD_MAX_WINDOW);
    const ticks: HoldTick[] = Array.from({ length: tickCount }, (_, index) => ({
      time: waveStart + (index + 0.5) * spacing,
      held: false,
      resolved: false,
    }));

    notes.push({
      kind: 'hold',
      lane,
      laneX,
      group: noteGroup,
      arriveAt: waveStart,
      duration: HOLD_DURATION,
      length,
      sheet,
      sheetMaterial,
      strip,
      stripMaterial,
      aura,
      auraMaterial,
      glow: 0,
      ticks,
      tickWindow,
      lastContact: new THREE.Vector3(laneX, barY, geometry.bandZ),
      resolved: false,
    });
  }

  function spawnWave(): void {
    waveActive = true;
    waveCount += 1;
    const kind = waveCount % 3;
    if (kind === 1) spawnHitRun();
    else if (kind === 2) spawnDragStaircase();
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

  function judgeHit(note: Note, samples: HandSample[]): void {
    const z = note.group.position.z;
    const distance = z - geometry.bandZ;

    if (distance > MISS_DISTANCE) {
      noteMiss(note);
      return;
    }
    if (Math.abs(distance) > CATCH_WINDOW) return;

    for (const hand of samples) {
      if (!hand.active) continue;
      if (note.hand !== 'none' && hand.side !== note.hand) continue;
      if (Math.abs(hand.position.x - note.laneX) > HIT_HALF_X) continue;
      if (Math.abs(hand.position.y - barY) > HIT_HALF_Y) continue;
      if (Math.abs(hand.position.z - z) > HIT_HALF_Z) continue;

      const speed = hand.velocity.length();
      if (speed < HIT_GOOD_SPEED) continue;
      if (hand.swing < HIT_MIN_SWING) continue;

      const grade: Grade = speed >= HIT_PERFECT_SPEED ? 'perfect' : 'good';
      const offsetMs = Math.round((distance / settings.flowSpeed) * 1000);

      note.resolved = true;
      if (grade === 'perfect') stats.perfect += 1;
      else stats.good += 1;
      stats.lastGrade = grade;
      stats.lastOffsetMs = offsetMs;

      popupPosition.copy(note.group.position);
      popup.spawn(grade, popupPosition);

      shatterDirection.copy(hand.velocity);
      shatter.spawn(note.group.position, shatterDirection, 0xdfefff, 14);
      removeNote(note);
      hooks.onJudge?.(hand.side, grade, offsetMs);
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

    // 按住 = 按键按着 + 手在轨道里 + 手的 z 落在片子范围内。
    const contact = samples.find(
      (hand) =>
        hand.pressed &&
        handInLane(hand, note.laneX, HOLD_HALF_Y) &&
        hand.position.z >= tailZ - 0.05 &&
        hand.position.z <= headZ + 0.05,
    );
    if (contact) note.lastContact?.copy(contact.position);
    note.contact = Boolean(contact);

    // 被按住：整片玻璃发光 + 亮带变实 + 手下出现光斑，三者一起。
    const targetGlow = contact ? 1 : 0;
    const glow = (note.glow ?? 0) + (targetGlow - (note.glow ?? 0)) * Math.min(1, dt * 12);
    note.glow = glow;

    if (note.sheetMaterial) {
      note.sheetMaterial.emissiveIntensity = glow * (2.0 + Math.sin(clock * 14) * 0.35);
      note.sheetMaterial.opacity = 0.45 + 0.25 * glow;
    }
    if (note.stripMaterial) {
      note.stripMaterial.opacity = 0.5 + 0.4 * glow + Math.sin(clock * 12) * 0.06 * glow;
    }
    if (note.aura && note.auraMaterial) {
      note.auraMaterial.opacity = 0.55 * glow;
      note.aura.visible = glow > 0.02 && visibleLength > 0.02;
      note.aura.scale.set(0.36, Math.max(visibleLength, 0.001), 1);
      note.aura.position.z = visibleLength / 2;
    }

    if (contact) {
      touchGlow.position.copy(contact.position);
      touchGlow.position.y += 0.012;
    }
    touchGlow.visible = glow > 0.02;
    touchMaterial.opacity = 0.75 * glow;
    const halo = 0.22 + Math.sin(clock * 12) * 0.03;
    touchGlow.scale.set(halo, halo, 1);


    // 物量像溪流一样逐个结算：按住就当场蹦出来，漏了也当场弹 MISS。
    const tickWindow = note.tickWindow ?? HOLD_MIN_WINDOW;
    for (const tick of note.ticks ?? []) {
      if (tick.resolved) continue;

      if (Math.abs(clock - tick.time) <= tickWindow / 2) {
        if (contact && !tick.held) {
          tick.held = true;
          // 物量从片子表面蹦出来，而不是从手心。
          popupPosition.set(contact.position.x, params.tableHeight + 0.03, contact.position.z);
          tickHeld(popupPosition, contact.side);
        }
      } else if (clock > tick.time + tickWindow / 2) {
        tick.resolved = true;
        if (!tick.held) tickMissed(note);
      }
    }

    // 尾端完全过去就收掉片子；物量已经逐个结算过了，这里不再弹总结提示。
    if (tailZ > geometry.bandZ + HOLD_MISS_MARGIN) {
      note.resolved = true;
      touchGlow.visible = false;
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
    let targetHand: HandSide = 'none';

    const hold = notes.find((note) => note.kind === 'hold' && !note.resolved);
    const hit = notes.find((note) => note.kind === 'hit' && !note.resolved);

    if (hold) {
      targetX = hold.laneX;
    } else if (hit) {
      targetX = hit.laneX;
      targetHand = hit.hand ?? 'none';
    } else if (clock >= waveStart && clock <= waveEnd) {
      const t = (clock - waveStart) / Math.max(waveEnd - waveStart, 1e-3);
      targetX = leftLane + (rightLane - leftLane) * t;
    }

    ghostPosition.set(targetX, barY + 0.006, geometry.bandZ);
    ghostVelocity.copy(ghostPosition).sub(ghostPrev).divideScalar(Math.max(dt, 1e-4));
    ghostPrev.copy(ghostPosition);

    // dev 演示：命中窗口里直接把速度/挥击距离补足（自动演示不是判定测试）。
    autoSample.side = targetHand;
    if (hit && Math.abs(hit.group.position.z - geometry.bandZ) < 0.3) {
      ghostVelocity.set(0, -2.9, 0);
      autoSample.swing = 0.32;
    } else {
      autoSample.swing = 0;
    }

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
          touchGlow.visible = false;
        shatter.update(dt);
        popup.update(dt);
        return;
      }

      if (clock >= nextWaveAt && !waveActive) spawnWave();

      // 已经判过的 drag / hit 也要继续滑出去——漏掉的键不是停在原地。
      for (const note of notes) {
        if (note.kind === 'drag' || note.kind === 'hit') {
          note.group.position.z = geometry.bandZ - settings.flowSpeed * (note.arriveAt - clock);
        }
      }

      const auto = updateGhost(dt);
      const samples = auto ? [...hands, auto] : hands;

      for (const note of notes) {
        if (note.resolved) continue;
        if (note.kind === 'drag') judgeDrag(note, samples);
        else if (note.kind === 'hit') judgeHit(note, samples);
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
      touchGlow.visible = false;
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
      hitBarGeometry.dispose();
      holdSheetGeometry.dispose();
      holdStripGeometry.dispose();
      holdAuraGeometry.dispose();
      shatter.dispose();
      popup.dispose();
      ghost.geometry.dispose();
      (ghost.material as THREE.Material).dispose();
      touchTexture.dispose();
      touchMaterial.dispose();
      group.clear();
    },
  };
}
