import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

import {
  CHART_DEFAULTS,
  type ArcNote as ChartArcNote,
  type Chart,
  type DragNote as ChartDragNote,
  type HitNote as ChartHitNote,
  type HoldNote as ChartHoldNote,
} from '../chart/schema';
import { createTimeline, type Timeline } from '../chart/timeline';
import type { TableGeometry, TableParams } from '../config';
import type { MaterialLibrary } from '../materials/library';
import { createArcNote, type ArcEvent, type ArcNote } from './arc';
import type { HandSample, HandSide } from './hands';
import type { Grade } from './judgement';
import { createJudgementPopup, type JudgementPopup } from './popup';
import { createScore, type ScoreState, type ScoreView } from './scoring';
import { createShatter, type Shatter } from './shatter';

/**
 * 谱面播放器：时间轴来自 `chart`，位置来自速度积分。
 *
 * - 判定只看 note 的绝对时间（毫秒窗口）；
 * - 视觉位置 = 判定带 − ∫速度 dt（支持 0 / 负数 / 极端 SV）；
 * - 轨号是绝对的 0–5，shift 只影响台面，不改写谱面。
 */

export interface PlayerSettings {
  enabled: boolean;
  /** 基准流速（米 / 秒）：谱面的 SV 倍率乘在它上面。 */
  flowSpeed: number;
  /** dev：自动打。 */
  auto: boolean;
}

export interface PlayerStats {
  perfect: number;
  good: number;
  miss: number;
  lastGrade: Grade | null;
  lastOffsetMs: number | null;
}

export interface PlayerHooks {
  onJudge?(side: HandSide, grade: Grade, offsetMs: number): void;
}

export interface Player {
  group: THREE.Group;
  settings: PlayerSettings;
  readonly stats: PlayerStats;
  readonly score: ScoreView;
  /** 所有物量都判完了（或血量归零）。 */
  readonly finished: boolean;
  /** 当前窗口值（-1 / 0 / 1 之间），来自谱面的 shift 事件。 */
  readonly windowValue: number;
  update(dt: number, hands: HandSample[]): void;
  restart(): void;
  dispose(): void;
}

/** 判定窗口（毫秒）——与流速无关。 */
const HIT_PERFECT_MS = 80;
const HIT_GOOD_MS = 160;
const DRAG_WINDOW_MS = 120;
/** 手在 z 方向离判定带多远还算在判定带上。 */
const HAND_ZONE = 0.4;
const HIT_HALF_X = 0.13;
const HIT_HALF_Y = 0.26;
/** drag 的扫过门槛（手速）。 */
const MIN_SWEEP_SPEED = 0.4;
/** hit 的挥击门槛：速度 + 120ms 内的位移。 */
const HIT_GOOD_SPEED = 1.4;
const HIT_MIN_SWING = 0.15;
/** hold 的物量窗口。 */
const HOLD_MIN_WINDOW = 0.2;
const HOLD_MAX_WINDOW = 0.6;
/** 冰条离台面的高度。 */
const BAR_HEIGHT = 0.07;
/** 超过这个时间还没判定就记漏。 */
const MISS_MS = 200;

type RuntimeNote =
  | { kind: 'hit'; chart: ChartHitNote; laneX: number; group: THREE.Group; resolved: boolean }
  | { kind: 'drag'; chart: ChartDragNote; laneX: number; group: THREE.Group; resolved: boolean }
  | {
      kind: 'hold';
      chart: ChartHoldNote;
      laneX: number;
      group: THREE.Group;
      sheet: THREE.Mesh;
      sheetMaterial: THREE.MeshPhysicalMaterial;
      strip: THREE.Mesh;
      stripMaterial: THREE.MeshBasicMaterial;
      aura: THREE.Mesh;
      auraMaterial: THREE.MeshBasicMaterial;
      ticks: Array<{ time: number; held: boolean; resolved: boolean }>;
      tickWindow: number;
      glow: number;
      resolved: boolean;
    }
  | { kind: 'arc'; chart: ChartArcNote; arc: ArcNote; resolved: boolean };

export function createPlayer(
  params: TableParams,
  geometry: TableGeometry,
  lib: MaterialLibrary,
  chart: Chart,
  settings: PlayerSettings,
  hooks: PlayerHooks = {},
): Player {
  const timeline: Timeline = createTimeline(chart);
  const group = new THREE.Group();
  group.name = 'player';
  const barY = params.tableHeight + BAR_HEIGHT;
  const baseSpeed = () => settings.flowSpeed;

  const stats: PlayerStats = { perfect: 0, good: 0, miss: 0, lastGrade: null, lastOffsetMs: null };
  let score: ScoreState = createScore(1);
  let finished = false;

  const shatter: Shatter = createShatter();
  group.add(shatter.group);
  const popup: JudgementPopup = createJudgementPopup();
  group.add(popup.group);

  // —— 共享几何 ——
  const hitGeometry = new RoundedBoxGeometry(0.21, 0.055, 0.075, 3, 0.008);
  const dragGeometry = new RoundedBoxGeometry(0.195, 0.011, 0.022, 2, 0.0035);
  const dragGlowGeometry = new THREE.PlaneGeometry(0.3, 0.12);
  const holdSheetGeometry = new RoundedBoxGeometry(0.21, 0.006, 1, 2, 0.0025);
  const holdStripGeometry = new THREE.BoxGeometry(0.09, 0.0025, 1);
  const holdAuraGeometry = new THREE.PlaneGeometry(1, 1);

  const runtime: RuntimeNote[] = [];
  let clockMs = 0;
  let windowValue = 0;

  const popupPosition = new THREE.Vector3();
  const shatterDirection = new THREE.Vector3();

  /** 任意时间的滚动位置（米）。 */
  function zAt(timeMs: number, nowMs: number): number {
    return geometry.bandZ - ((timeline.scrollDistance(timeMs) - timeline.scrollDistance(nowMs)) * baseSpeed()) / 1000;
  }

  const laneX = (lane: number): number => geometry.laneX6[lane] ?? 0;

  function disposeNote(note: RuntimeNote): void {
    if (note.kind === 'arc') {
      group.remove(note.arc.group);
      note.arc.dispose();
      return;
    }
    group.remove(note.group);
    if (note.kind === 'hold') {
      note.sheetMaterial.dispose();
      note.stripMaterial.dispose();
      note.auraMaterial.dispose();
    } else {
      note.group.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
    }
    note.group.clear();
  }

  // —— 从谱面构建全部运行时物件 ——
  for (const note of chart.notes) {
    if (note.type === 'arc') {
      const arc = createArcNote(
        {
          points: note.points,
          startTime: note.time,
          hand: note.hand,
          keyObjects: note.keyObjects ?? [],
          notesPerSecond: note.notesPerSecond ?? CHART_DEFAULTS.arcNotesPerSecond,
          laneWidth: geometry.laneWidth,
          tableHeight: params.tableHeight,
          bandZ: geometry.bandZ,
          clipZ: geometry.bandZ + 0.1,
          baseSpeed: baseSpeed(),
          scroll: (ms) => timeline.scrollDistance(ms),
        },
        lib,
      );
      group.add(arc.group);
      runtime.push({ kind: 'arc', chart: note, arc, resolved: false });
      continue;
    }

    const x = laneX(note.lane);
    const noteGroup = new THREE.Group();
    group.add(noteGroup);

    if (note.type === 'hit') {
      const material =
        note.hand === 'left' ? lib.ceramicLeft : note.hand === 'right' ? lib.ceramicRight : lib.ceramic;
      const bar = new THREE.Mesh(hitGeometry, material);
      bar.castShadow = true;
      noteGroup.add(bar);
      runtime.push({ kind: 'hit', chart: note, laneX: x, group: noteGroup, resolved: false });
    } else if (note.type === 'drag') {
      const bar = new THREE.Mesh(dragGeometry, lib.iceBar);
      bar.castShadow = true;
      noteGroup.add(bar);
      const glow = new THREE.Mesh(dragGlowGeometry, lib.dragGlow);
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = 0.002;
      glow.renderOrder = 4;
      noteGroup.add(glow);
      runtime.push({ kind: 'drag', chart: note, laneX: x, group: noteGroup, resolved: false });
    } else {
      const sheetMaterial = lib.clearGlass.clone();
      sheetMaterial.emissive.setHex(0x1c6f86);
      sheetMaterial.emissiveIntensity = 0;
      const sheet = new THREE.Mesh(holdSheetGeometry, sheetMaterial);
      noteGroup.add(sheet);

      const stripMaterial = lib.holdFill.clone();
      const strip = new THREE.Mesh(holdStripGeometry, stripMaterial);
      strip.position.y = 0.0045;
      strip.visible = false;
      noteGroup.add(strip);

      const auraMaterial = lib.glowLeft.clone();
      auraMaterial.opacity = 0;
      const aura = new THREE.Mesh(holdAuraGeometry, auraMaterial);
      aura.rotation.x = -Math.PI / 2;
      aura.position.y = 0.002;
      aura.visible = false;
      noteGroup.add(aura);

      const duration = note.duration;
      const objects = Math.max(1, Math.round(note.objects ?? (duration / 1000) * (note.notesPerSecond ?? CHART_DEFAULTS.holdNotesPerSecond)));
      const spacing = duration / objects;
      const ticks = Array.from({ length: objects }, (_, index) => ({
        time: note.time + (index + 0.5) * spacing,
        held: false,
        resolved: false,
      }));
      const tickWindow = THREE.MathUtils.clamp(spacing / 1000, HOLD_MIN_WINDOW, HOLD_MAX_WINDOW);

      runtime.push({
        kind: 'hold',
        chart: note,
        laneX: x,
        group: noteGroup,
        sheet,
        sheetMaterial,
        strip,
        stripMaterial,
        aura,
        auraMaterial,
        ticks,
        tickWindow,
        glow: 0,
        resolved: false,
      });
    }
  }

  // 物量总数：hit / drag 各 1，hold 与 arc 按 tick 数。
  const totalObjects = runtime.reduce((sum, note) => {
    if (note.kind === 'arc') return sum + note.arc.ticks.length;
    if (note.kind === 'hold') return sum + note.ticks.length;
    return sum + 1;
  }, 0);
  score = createScore(totalObjects);

  function notePerfect(side: HandSide, offsetMs: number, at: THREE.Vector3, scale = 1): void {
    score.judge('perfect');
    stats.perfect += 1;
    stats.lastGrade = 'perfect';
    stats.lastOffsetMs = Math.round(offsetMs);
    popupPosition.copy(at);
    popup.spawn('perfect', popupPosition, { scale: scale * 0.62, life: 0.32 });
    hooks.onJudge?.(side, 'perfect', offsetMs);
  }

  function noteMiss(at: THREE.Vector3): void {
    score.judge('miss');
    stats.miss += 1;
    stats.lastGrade = 'miss';
    stats.lastOffsetMs = null;
    popupPosition.copy(at);
    popup.spawn('miss', popupPosition);
    hooks.onJudge?.('none', 'miss', 0);
  }

  function handleArcEvent(event: ArcEvent): void {
    if (event.type === 'held') {
      notePerfect(event.side, 0, event.position, event.key ? 0.78 : 1);
      shatterDirection.set(0, 1, 0);
      shatter.spawn(event.position, shatterDirection, 0xbfe9ff, event.key ? 7 : 3);
    } else {
      noteMiss(event.position);
    }
  }

  function judgeHit(note: Extract<RuntimeNote, { kind: 'hit' }>, hands: HandSample[]): void {
    const offsetMs = clockMs - note.chart.time;
    if (offsetMs > HIT_GOOD_MS) {
      note.resolved = true;
      noteMiss(new THREE.Vector3(note.laneX, barY, geometry.bandZ));
      note.group.visible = false;
      return;
    }
    if (offsetMs < -HIT_GOOD_MS) return;

    for (const hand of hands) {
      if (!hand.active) continue;
      if (note.chart.hand && hand.side !== note.chart.hand) continue;
      if (Math.abs(hand.position.x - note.laneX) > HIT_HALF_X) continue;
      if (Math.abs(hand.position.y - barY) > HIT_HALF_Y) continue;
      if (Math.abs(hand.position.z - geometry.bandZ) > HAND_ZONE) continue;
      if (hand.velocity.length() < HIT_GOOD_SPEED) continue;
      if (hand.swing < HIT_MIN_SWING) continue;

      note.resolved = true;
      note.group.visible = false;
      const grade: Grade = Math.abs(offsetMs) <= HIT_PERFECT_MS ? 'perfect' : 'good';
      stats.lastGrade = grade;
      stats.lastOffsetMs = Math.round(offsetMs);
      score.judge(grade);
      if (grade === 'perfect') stats.perfect += 1;
      else stats.good += 1;
      popup.spawn(grade, popupPosition.set(note.laneX, barY + 0.1, geometry.bandZ));
      shatterDirection.copy(hand.velocity);
      shatter.spawn(new THREE.Vector3(note.laneX, barY, geometry.bandZ), shatterDirection, 0xdfefff, 14);
      hooks.onJudge?.(hand.side, grade, offsetMs);
      return;
    }
  }

  function judgeDrag(note: Extract<RuntimeNote, { kind: 'drag' }>, hands: HandSample[]): void {
    const offsetMs = clockMs - note.chart.time;
    if (offsetMs > DRAG_WINDOW_MS) {
      note.resolved = true;
      note.group.visible = false;
      noteMiss(new THREE.Vector3(note.laneX, barY, geometry.bandZ));
      return;
    }
    if (offsetMs < -DRAG_WINDOW_MS) return;

    for (const hand of hands) {
      if (!hand.active || hand.velocity.length() < MIN_SWEEP_SPEED) continue;
      if (Math.abs(hand.position.x - note.laneX) > HIT_HALF_X) continue;
      if (Math.abs(hand.position.y - barY) > HIT_HALF_Y) continue;
      if (Math.abs(hand.position.z - geometry.bandZ) > HAND_ZONE) continue;

      note.resolved = true;
      note.group.visible = false;
      notePerfect(hand.side, offsetMs, new THREE.Vector3(note.laneX, barY, geometry.bandZ));
      shatterDirection.copy(hand.velocity);
      shatter.spawn(new THREE.Vector3(note.laneX, barY, geometry.bandZ), shatterDirection, 0xcfefff, 12);
      return;
    }
  }

  function updateHold(note: Extract<RuntimeNote, { kind: 'hold' }>, dt: number, hands: HandSample[]): void {
    const headZ = zAt(note.chart.time, clockMs);
    const tailZ = zAt(note.chart.time + note.chart.duration, clockMs);
    const far = Math.min(headZ, tailZ);
    const near = Math.max(headZ, tailZ);

    note.group.position.set(note.laneX, params.tableHeight + 0.004, far);
    note.group.rotation.z = 0;

    // 片子：从 far 到 near。
    const visibleNear = Math.min(near, geometry.nearZ + 0.02);
    const visibleLength = Math.max(visibleNear - far, 0.001);
    note.sheet.scale.z = visibleLength;
    note.sheet.position.z = visibleLength / 2;

    const litStart = Math.max(geometry.bandZ, far);
    const litLength = Math.max(visibleNear - litStart, 0);
    note.strip.visible = litLength > 0.01;
    note.strip.scale.z = Math.max(litLength, 0.001);
    note.strip.position.z = litStart - far + litLength / 2;

    const contact = hands.find(
      (hand) =>
        hand.pressed &&
        hand.active &&
        Math.abs(hand.position.x - note.laneX) <= 0.13 &&
        Math.abs(hand.position.y - barY) <= 0.26 &&
        hand.position.z >= far - 0.05 &&
        hand.position.z <= near + 0.05,
    );

    const targetGlow = contact ? 1 : 0;
    note.glow += (targetGlow - note.glow) * Math.min(1, dt * 12);
    note.sheetMaterial.emissiveIntensity = note.glow * 2.0;
    note.sheetMaterial.opacity = 0.45 + 0.25 * note.glow;
    note.stripMaterial.opacity = 0.5 + 0.4 * note.glow;
    note.auraMaterial.opacity = 0.55 * note.glow;
    note.aura.visible = note.glow > 0.02;
    note.aura.scale.set(0.36, Math.max(visibleLength, 0.001), 1);
    note.aura.position.z = visibleLength / 2;

    for (const tick of note.ticks) {
      if (tick.resolved) continue;
      const windowMs = note.tickWindow * 1000;
      const offsetMs = clockMs - tick.time;
      if (Math.abs(offsetMs) <= windowMs / 2) {
        if (!tick.held && contact) {
          tick.held = true;
          notePerfect(contact.side, 0, new THREE.Vector3(note.laneX, barY, geometry.bandZ), 1);
          shatterDirection.set(0, 1, 0);
          shatter.spawn(new THREE.Vector3(note.laneX, params.tableHeight + 0.03, geometry.bandZ), shatterDirection, 0xbfe9ff, 4);
        }
      } else if (offsetMs > windowMs / 2) {
        tick.resolved = true;
        if (!tick.held) noteMiss(new THREE.Vector3(note.laneX, barY - 0.02, geometry.bandZ));
      }
    }

    if (clockMs > note.chart.time + note.chart.duration + MISS_MS) {
      note.resolved = true;
      note.group.visible = false;
    }
  }

  function updateVisibility(note: RuntimeNote): void {
    if (note.kind === 'arc') {
      note.arc.group.visible = true;
      return;
    }
    if (note.resolved) return;

    const z = note.kind === 'hold' ? zAt(note.chart.time, clockMs) : zAt(note.chart.time, clockMs);
    if (note.kind !== 'hold') note.group.position.set(note.laneX, barY, z);
    note.group.visible = z < geometry.nearZ + 1.2 && z > geometry.farZ - 2;
  }

  // —— 自动演示 ——
  const ghost = new THREE.Mesh(
    new THREE.SphereGeometry(0.022, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xa8e8ff, transparent: true, opacity: 0.75, toneMapped: false }),
  );
  ghost.visible = false;
  group.add(ghost);
  const ghostPosition = new THREE.Vector3(0, barY, geometry.bandZ);
  const ghostPrev = new THREE.Vector3().copy(ghostPosition);
  const ghostVelocity = new THREE.Vector3();
  const autoSample: HandSample = {
    side: 'none',
    source: 'xr',
    position: ghostPosition,
    velocity: ghostVelocity,
    active: true,
    pressed: true,
    swing: 0.3,
  };

  function updateGhost(dt: number): HandSample | null {
    if (!settings.auto) {
      ghost.visible = false;
      return null;
    }

    // 找下一颗还没判定的、离当前时间最近的物件。
    let best: RuntimeNote | null = null;
    let bestDelta = Infinity;
    for (const note of runtime) {
      if (note.resolved) continue;
      const time = note.kind === 'arc' ? note.chart.time : note.chart.time;
      const delta = time - clockMs;
      if (delta < -200) continue;
      if (Math.abs(delta) < Math.abs(bestDelta)) {
        best = note;
        bestDelta = delta;
      }
    }

    let target: THREE.Vector3 | null = null;
    let side: HandSide = 'none';
    if (best) {
      if (best.kind === 'arc') {
        target = best.arc.pointAt(clockMs);
        side = best.chart.hand;
      } else if (best.kind === 'hold') {
        target = new THREE.Vector3(best.laneX, barY, geometry.bandZ);
        side = 'none';
      } else {
        target = new THREE.Vector3(best.laneX, barY, geometry.bandZ);
        side = best.chart.hand ?? 'none';
      }
    }

    if (target) ghostPosition.lerp(target, Math.min(1, dt * 18));
    ghostVelocity.copy(ghostPosition).sub(ghostPrev).divideScalar(Math.max(dt, 1e-4));
    ghostPrev.copy(ghostPosition);
    autoSample.side = side;
    autoSample.swing = 0.35;

    // dev 演示：到点的一瞬间补一下挥击速度（自动演示不是判定测试）。
    if (best && best.kind !== 'arc' && Math.abs(best.chart.time - clockMs) <= 120) {
      const dx = Math.abs(ghostPosition.x - best.laneX);
      if (dx < 0.1) {
        ghostVelocity.set(0, best.kind === 'hit' ? -3 : 0, best.kind === 'hit' ? 0 : -1.4);
      }
    }

    ghost.visible = true;
    ghost.position.copy(ghostPosition);
    return autoSample;
  }

  return {
    group,
    settings,
    stats,

    get score(): ScoreView {
      return score;
    },

    get finished(): boolean {
      return finished;
    },

    get windowValue(): number {
      return windowValue;
    },

    update(dt: number, hands: HandSample[]): void {
      if (!settings.enabled) {
        finished = false;
        for (const note of runtime) {
          if (note.kind === 'arc') note.arc.group.visible = false;
          else note.group.visible = false;
        }
        shatter.update(dt);
        popup.update(dt);
        return;
      }

      clockMs += dt * 1000;
      windowValue = timeline.windowAt(clockMs);
      const auto = updateGhost(dt);
      const samples = auto ? [...hands, auto] : hands;

      for (const note of runtime) {
        updateVisibility(note);

        if (note.kind === 'arc') {
          for (const event of note.arc.update(clockMs, samples)) handleArcEvent(event);
          const lastTick = note.arc.ticks[note.arc.ticks.length - 1];
          if (lastTick && clockMs > lastTick.time + 300) {
            note.resolved = true;
            note.arc.group.visible = false;
          }
          continue;
        }

        if (note.resolved) continue;
        if (note.kind === 'hit') judgeHit(note, samples);
        else if (note.kind === 'drag') judgeDrag(note, samples);
        else updateHold(note, dt, samples);
      }

      finished = score.failed || runtime.every((note) => note.resolved);

      shatter.update(dt);
      popup.update(dt);
    },

    restart(): void {
      clockMs = 0;
      finished = false;
      score.reset();
      windowValue = timeline.windowAt(0);
      stats.perfect = 0;
      stats.good = 0;
      stats.miss = 0;
      stats.lastGrade = null;
      stats.lastOffsetMs = null;
      for (const note of runtime) {
        note.resolved = false;
        if (note.kind === 'arc') {
          for (const tick of note.arc.ticks) {
            tick.held = false;
            tick.resolved = false;
          }
          note.arc.group.visible = true;
        } else if (note.kind === 'hold') {
          for (const tick of note.ticks) {
            tick.held = false;
            tick.resolved = false;
          }
          note.glow = 0;
          note.group.visible = true;
        } else {
          note.group.visible = true;
        }
      }
    },

    dispose(): void {
      for (const note of runtime) disposeNote(note);
      runtime.length = 0;
      hitGeometry.dispose();
      dragGeometry.dispose();
      dragGlowGeometry.dispose();
      holdSheetGeometry.dispose();
      holdStripGeometry.dispose();
      holdAuraGeometry.dispose();
      shatter.dispose();
      popup.dispose();
      ghost.geometry.dispose();
      (ghost.material as THREE.Material).dispose();
      group.clear();
    },
  };
}
