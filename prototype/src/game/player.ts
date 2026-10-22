import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

import {
  CHART_DEFAULTS,
  arcPointZ,
  chartLimits,
  noteHeight,
  noteX,
  type ArcNote as ChartArcNote,
  type Chart,
  type DragNote as ChartDragNote,
  type HitNote as ChartHitNote,
  type HoldNote as ChartHoldNote,
} from '../chart/schema';
import { createTimeline, type Timeline } from '../chart/timeline';
import type { TableGeometry, TableParams } from '../config';
import { applyDistanceFade } from '../materials/distanceFade';
import type { MaterialLibrary } from '../materials/library';
import { createArcNote, type ArcEvent, type ArcNote } from './arc';
import { createJudgementGuide, GUIDE_START_MS, type GuideHit } from './guide';
import type { HandSample, HandSide } from './hands';
import { createHitVisualFactory, hitFragmentColor } from './hitVisual';
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
  /** dev：hit 判定盒 X 倍率（只改空间体积，不改时间窗）。 */
  hitboxX: number;
  /** dev：hit 判定盒 Z 倍率（只改空间体积，不改时间窗）。 */
  hitboxZ: number;
}

export interface PlayerStats {
  perfect: number;
  good: number;
  miss: number;
  lastGrade: Grade | null;
  lastOffsetMs: number | null;
}

export interface PlayerHooks {
  onJudge?(side: HandSide, grade: Grade, offsetMs: number, source: 'hit' | 'drag' | 'hold' | 'arc'): void;
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
  /** 当前谱面时间（毫秒）。 */
  readonly timeMs: number;
  /** 当前是否有手正在 sustain hold / 跟随 arc；给手部短棒控制透明度。 */
  readonly sustain: { left: boolean; right: boolean };
  /** 谱面总时长（毫秒）。 */
  readonly duration: number;
  /** 物量总数（hit / drag 各 1，hold 与 arc 按 tick 数）。 */
  readonly totalObjects: number;
  /** 用外部时钟（音频）驱动；传 null 退回「每帧累加 dt」。 */
  setTimeSource(source: (() => number) | null): void;
  /** 只改 3D 视觉流速，不动谱面 SV / 判定。 */
  setFlowSpeed(speed: number): void;
  update(dt: number, hands: HandSample[]): void;
  restart(): void;
  dispose(): void;
}

/**
 * 渲染顺序。台面 / 分割线 / 判定带都是 transparent（shift 时要交叉淡入淡出），
 * 而它们的 mesh 位置在原点（几何被 translate 过），按距离排序时会被当成「离相机最近」，
 * 于是排在所有 note 之后画 —— 不写深度的冰条 / 玻璃片就被台面整个盖掉了。
 * 把 note 抬到它们上面；glow 再高一层，保证光在实体之上。
 */
const ORDER_BODY = 5;
const ORDER_GLOW = 6;
const ORDER_AURA = 7;

/** 判定窗口（毫秒）——与流速无关。perfect 允许更早，good 两侧仍为 160ms。 */
const HIT_PERFECT_EARLY_MS = 100;
const HIT_PERFECT_LATE_MS = 80;
const HIT_GOOD_EARLY_MS = 140;
const HIT_GOOD_LATE_MS = 160;
const DRAG_WINDOW_MS = 120;
/** 手在 z 方向离判定带多远还算在判定带上。 */
const HAND_ZONE = 0.4;
/** hit 的 z 容差做成不对称：靠玩家的一侧收紧，减少提前挥入就结算。 */
const HIT_ZONE_NEAR = 0.22;
const HIT_ZONE_FAR = 0.38;
const HIT_HALF_X = 0.13;
const HIT_HALF_Y = 0.26;

/** 调参面板显示用：hit 判定盒的默认半宽 / 前后深度。 */
export const HIT_JUDGE_BOX = {
  halfX: HIT_HALF_X,
  near: HIT_ZONE_NEAR,
  far: HIT_ZONE_FAR,
} as const;
/** drag 的扫过门槛（手速）。 */
const MIN_SWEEP_SPEED = 0.4;
/** hit 的挥击门槛：速度 + 120ms 内的位移。 */
const HIT_GOOD_SPEED = 1.4;
const HIT_MIN_SWING = 0.15;
/** hold 的物量窗口。 */
const HOLD_MIN_WINDOW = 0.2;
const HOLD_MAX_WINDOW = 0.6;
/** 超过这个时间还没判定就记漏。 */
const MISS_MS = 200;
/**
 * 视距淡出：note 在「可见距离」内用这段距离逐渐显形（米）。
 * 台面本身吃在雾里，但 note 是自发光的小物件，直接 pop-in 很显眼。
 */
const FAR_FADE_SPAN = 4.0;

type RuntimeNote =
  | { kind: 'hit'; chart: ChartHitNote; group: THREE.Group; resolved: boolean }
  | {
      kind: 'drag';
      chart: ChartDragNote;
      group: THREE.Group;
      bar: THREE.Mesh;
      resolved: boolean;
    }
  | {
      kind: 'hold';
      chart: ChartHoldNote;
      group: THREE.Group;
      sheet: THREE.Mesh;
      sheetMaterial: THREE.MeshPhysicalMaterial;
      headBar: THREE.Mesh;
      headBarMaterial: THREE.MeshPhysicalMaterial;
      rails: THREE.Mesh[];
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
  const limits = chartLimits(chart);
  const group = new THREE.Group();
  group.name = 'player';
  const baseSpeed = () => settings.flowSpeed;
  const guide = createJudgementGuide(params, geometry);
  group.add(guide.group);

  /** 连续横向位置（轨号单位）→ 世界 x。 */
  const worldX = (x: number): number => (x - 2.5) * geometry.laneWidth;
  /** 地面键的有效位置：x 连续、y = 台面 + note 高度。 */
  const xOf = (note: ChartHitNote | ChartDragNote | ChartHoldNote): number => worldX(noteX(note));
  const yOf = (note: ChartHitNote | ChartDragNote | ChartHoldNote): number =>
    params.tableHeight + noteHeight(note);

  const stats: PlayerStats = { perfect: 0, good: 0, miss: 0, lastGrade: null, lastOffsetMs: null };
  const sustain = { left: false, right: false };
  let score: ScoreState = createScore(1);
  let finished = false;

  const shatter: Shatter = createShatter();
  group.add(shatter.group);
  const popup: JudgementPopup = createJudgementPopup();
  group.add(popup.group);

  // —— 共享几何 ——
  const dragGeometry = new RoundedBoxGeometry(0.195, 0.011, 0.022, 2, 0.0035);
  // 辉光片只比冰条深一点：平铺的光片在俯视时被透视拉长，
  // 太深的话远处会变成「一团光、条子看不见」。
  const dragGlowGeometry = new THREE.PlaneGeometry(0.28, 0.05);
  const holdSheetGeometry = new RoundedBoxGeometry(0.21, 0.006, 1, 2, 0.0025);
  const holdStripGeometry = new THREE.BoxGeometry(0.09, 0.0025, 1);
  const holdAuraGeometry = new THREE.PlaneGeometry(1, 1);

  // —— 共享材质（视距淡出烘进 shader，所以不用按颗克隆）——
  // 视距从判定带往前算：默认 7m 之外完全不画（台面再远的部分留给氛围）。
  const fadeFar = geometry.bandZ - params.visibleRange;
  const fadeSpan = FAR_FADE_SPAN;
  const hitFactory = createHitVisualFactory(lib, { fade: { far: fadeFar, span: fadeSpan } });
  const dragBarMaterial = applyDistanceFade(lib.iceBar.clone(), { far: fadeFar, span: fadeSpan, power: 0.65 });
  // 冰条在远处只剩 1–2 px：自发光调成偏白青、亮度抬高，别被加法辉光盖过去。
  dragBarMaterial.emissive.setHex(0x9fe4ff);
  dragBarMaterial.emissiveIntensity = 1.1;
  // 辉光是加法混合，感知上比实体亮得多：让它淡得比条子快，
  // 否则远处会变成「只剩一团光、条子看不见」。
  const dragGlowMaterial = applyDistanceFade(lib.dragGlow.clone(), { far: fadeFar, span: fadeSpan, power: 2.4 });
  dragGlowMaterial.opacity = 0.7;

  // hold 的「头」：一小段冰条，压在片子的近端。
  // 玻璃片在远处太淡，会变成「到跟前才突然出现」；有了这条亮边，
  // hold 在远端就能读成「一条线 + 一条拖尾」，也顺便标出该从哪里按下去。
  const holdHeadGeometry = new RoundedBoxGeometry(0.2, 0.014, 0.034, 2, 0.004);
  const holdHeadMaterialBase = applyDistanceFade(lib.iceBar.clone(), { far: fadeFar, span: fadeSpan, power: 0.6 });
  holdHeadMaterialBase.emissive.setHex(0x9fe4ff);
  holdHeadMaterialBase.emissiveIntensity = 1.3;

  // 片子的两条侧边（亮线）。玻璃片本身在远处对比度太低，
  // 只靠「头」会读成「一条线突然变成一片」；两条边从远处就把这片的结构交代清楚。
  const holdRailGeometry = new THREE.BoxGeometry(0.03, 0.03, 1);
  const holdRailMaterial = applyDistanceFade(lib.iceBar.clone(), { far: fadeFar, span: fadeSpan, power: 0.6 });
  holdRailMaterial.emissive.setHex(0x9fe4ff);
  holdRailMaterial.emissiveIntensity = 2.2;

  const runtime: RuntimeNote[] = [];
  let clockMs = 0;
  let windowValue = 0;
  /** 外部时间源（音频时钟）。为 null 时退回每帧累加 dt。 */
  let timeSource: (() => number) | null = null;

  const popupPosition = new THREE.Vector3();
  const shatterDirection = new THREE.Vector3();

  /** 任意时间的滚动位置（米）。 */
  function zAt(timeMs: number, nowMs: number): number {
    return geometry.bandZ - ((timeline.scrollDistance(timeMs) - timeline.scrollDistance(nowMs)) * baseSpeed()) / 1000;
  }

  function disposeNote(note: RuntimeNote): void {
    if (note.kind === 'arc') {
      group.remove(note.arc.group);
      note.arc.dispose();
      return;
    }
    group.remove(note.group);
    // hit / drag 用共享材质（视距淡出在 shader 里），只有 hold 每颗自己克隆。
    if (note.kind === 'hold') {
      note.sheetMaterial.dispose();
      note.stripMaterial.dispose();
      note.auraMaterial.dispose();
    }
    note.group.clear();
  }

  // —— 从谱面构建全部运行时物件 ——
  for (const note of chart.notes) {
    if (note.type === 'arc') {
      // 高度上限：超出的 note 不生成（判定、物量、回收都不参与）。
      const arcHeight = note.points.reduce((max, point) => Math.max(max, arcPointZ(point)), 0);
      if (arcHeight > limits.maxHeight) {
        if (import.meta.env.DEV) {
          console.warn(
            `[chart] arc@${note.time} 高度 ${arcHeight.toFixed(2)}m 超过上限 ${limits.maxHeight}m，跳过`,
          );
        }
        continue;
      }

      const arc = createArcNote(
        {
          points: note.points,
          startTime: note.time,
          hand: note.hand,
          keyObjects: note.keyObjects ?? [],
          notesPerSecond: note.notesPerSecond ?? CHART_DEFAULTS.arcNotesPerSecond,
          ticks: note.ticks,
          laneWidth: geometry.laneWidth,
          tableHeight: params.tableHeight,
          bandZ: geometry.bandZ,
          clipZ: geometry.bandZ + 0.1,
          baseSpeed: baseSpeed(),
          fadeFar,
          fadeSpan,
          scroll: (ms) => timeline.scrollDistance(ms),
        },
        lib,
      );
      arc.group.userData.chartNote = note;
      arc.group.traverse((object) => {
        object.userData.chartNote = note;
      });
      group.add(arc.group);
      runtime.push({ kind: 'arc', chart: note, arc, resolved: false });
      continue;
    }

    // 高度上限对四种键型一视同仁：超限的 note 不生成。
    if (noteHeight(note) > limits.maxHeight) {
      if (import.meta.env.DEV) {
        console.warn(
          `[chart] ${note.type}@${note.time} 高度 ${noteHeight(note).toFixed(2)}m 超过上限 ${limits.maxHeight}m，跳过`,
        );
      }
      continue;
    }

    const noteGroup = new THREE.Group();
    noteGroup.userData.chartNote = note;
    group.add(noteGroup);
    const tagChildren = (): void => {
      noteGroup.traverse((object) => {
        object.userData.chartNote = note;
      });
    };

    if (note.type === 'hit') {
      // 视觉体积变大，但判定盒仍是上方的 HIT_HALF_X / HIT_ZONE_*，不跟着造型走。
      const visual = hitFactory.create(note.hand);
      noteGroup.add(visual);
      tagChildren();
      runtime.push({ kind: 'hit', chart: note, group: noteGroup, resolved: false });
    } else if (note.type === 'drag') {
      const bar = new THREE.Mesh(dragGeometry, dragBarMaterial);
      bar.renderOrder = ORDER_BODY;
      bar.frustumCulled = false;
      bar.userData.chartNote = note;
      noteGroup.add(bar);
      const glow = new THREE.Mesh(dragGlowGeometry, dragGlowMaterial);
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = 0.002;
      glow.renderOrder = ORDER_GLOW;
      glow.frustumCulled = false;
      noteGroup.add(glow);
      tagChildren();
      runtime.push({ kind: 'drag', chart: note, group: noteGroup, bar, resolved: false });
    } else {
      // 片子和亮边用同一个淡入长度：远处整条一起渐显，不会「只有头、身体后出现」。
      const holdSpan = fadeSpan;
      // power < 1：先保持不透明、快到视距边缘才掉下去。
      // 「远处的物件应该看得见，只是渐隐」——而不是一路半透明到化掉。
      const holdFade = { far: fadeFar, span: holdSpan, power: 0.6 };
      const sheetMaterial = applyDistanceFade(lib.clearGlass.clone(), holdFade);
      // 玻璃片贴着台面，颜色和台面太接近；稍微提亮 + 一点冷色自发光，远处才有对比度。
      sheetMaterial.color.setHex(0xe4f4ff);
      sheetMaterial.emissive.setHex(0x2c7f9e);
      sheetMaterial.emissiveIntensity = 0;
      const sheet = new THREE.Mesh(holdSheetGeometry, sheetMaterial);
      sheet.renderOrder = ORDER_BODY;
      sheet.frustumCulled = false;
      noteGroup.add(sheet);

      const headBarMaterial = holdHeadMaterialBase;
      const headBar = new THREE.Mesh(holdHeadGeometry, headBarMaterial);
      headBar.position.y = 0.004;
      headBar.renderOrder = ORDER_BODY;
      headBar.frustumCulled = false;
      noteGroup.add(headBar);

      const rails: THREE.Mesh[] = [];
      for (const side of [-1, 1]) {
        const rail = new THREE.Mesh(holdRailGeometry, holdRailMaterial);
        rail.position.set(side * 0.095, 0.008, 0);
        rail.renderOrder = ORDER_BODY;
        rail.frustumCulled = false;
        noteGroup.add(rail);
        rails.push(rail);
      }

      const stripMaterial = applyDistanceFade(lib.holdFill.clone(), holdFade);
      const strip = new THREE.Mesh(holdStripGeometry, stripMaterial);
      strip.position.y = 0.0045;
      strip.visible = false;
      strip.renderOrder = ORDER_GLOW;
      strip.frustumCulled = false;
      noteGroup.add(strip);

      const auraMaterial = applyDistanceFade(lib.glowLeft.clone(), { far: fadeFar, span: holdSpan, power: 1.6 });
      auraMaterial.opacity = 0;
      const aura = new THREE.Mesh(holdAuraGeometry, auraMaterial);
      aura.rotation.x = -Math.PI / 2;
      aura.position.y = 0.002;
      aura.visible = false;
      aura.renderOrder = ORDER_AURA;
      aura.frustumCulled = false;
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

      tagChildren();
      runtime.push({
        kind: 'hold',
        chart: note,
        group: noteGroup,
        sheet,
        sheetMaterial,
        headBar,
        headBarMaterial,
        rails,
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

  function notePerfect(
    side: HandSide,
    offsetMs: number,
    at: THREE.Vector3,
    scale = 1,
    source: 'hit' | 'drag' | 'hold' | 'arc' = 'hit',
  ): void {
    score.judge('perfect');
    stats.perfect += 1;
    stats.lastGrade = 'perfect';
    stats.lastOffsetMs = Math.round(offsetMs);
    popupPosition.copy(at);
    popup.spawn('perfect', popupPosition, { scale: scale * 0.62, life: 0.32 });
    hooks.onJudge?.(side, 'perfect', offsetMs, source);
  }

  function noteMiss(at: THREE.Vector3, source: 'hit' | 'drag' | 'hold' | 'arc' = 'hit'): void {
    score.judge('miss');
    stats.miss += 1;
    stats.lastGrade = 'miss';
    stats.lastOffsetMs = null;
    popupPosition.copy(at);
    popup.spawn('miss', popupPosition);
    hooks.onJudge?.('none', 'miss', 0, source);
  }

  function handleArcEvent(event: ArcEvent): void {
    if (event.type === 'held') {
      notePerfect(event.side, 0, event.position, event.key ? 0.78 : 1, 'arc');
      shatterDirection.set(0, 1, 0);
      shatter.spawn(event.position, shatterDirection, 0xbfe9ff, event.key ? 7 : 3, { size: 0.55, life: 0.8 });
    } else {
      noteMiss(event.position, 'arc');
    }
  }

  /**
   * 地面 / 空中 hit 的命中反馈：直接碎成陶瓷片，不再加 2D 冲击环。
   * 碎片颜色取釉面基色，避免一整团纯白；霜雾保留，负责“粉尘”这一层。
   */
  function spawnHitFeedback(
    hand: HandSide,
    grade: Grade,
    x: number,
    y: number,
    direction: THREE.Vector3,
  ): void {
    shatterDirection.copy(direction);
    if (shatterDirection.lengthSq() < 1e-6) shatterDirection.set(0, 1, 0);
    shatter.spawn(
      new THREE.Vector3(x, y, geometry.bandZ),
      shatterDirection,
      hitFragmentColor(hand),
      grade === 'perfect' ? 18 : 14,
      { size: 1.3, life: 1.35, spread: 2 },
    );
  }

  function judgeHit(note: Extract<RuntimeNote, { kind: 'hit' }>, hands: HandSample[]): void {
    const x = xOf(note.chart);
    const y = yOf(note.chart);
    const offsetMs = clockMs - note.chart.time;
    if (offsetMs > HIT_GOOD_LATE_MS) {
      note.resolved = true;
      noteMiss(new THREE.Vector3(x, y, geometry.bandZ));
      note.group.visible = false;
      return;
    }
    if (offsetMs < -HIT_GOOD_EARLY_MS) return;

    // 只缩放空间判定盒；时间窗仍由上方的不对称窗口决定。
    const halfX = HIT_HALF_X * Math.max(0.1, settings.hitboxX);
    const zoneNear = HIT_ZONE_NEAR * Math.max(0.1, settings.hitboxZ);
    const zoneFar = HIT_ZONE_FAR * Math.max(0.1, settings.hitboxZ);

    for (const hand of hands) {
      if (!hand.active) continue;
      if (note.chart.hand && hand.side !== note.chart.hand) continue;
      if (Math.abs(hand.position.x - x) > halfX) continue;
      if (Math.abs(hand.position.y - y) > HIT_HALF_Y) continue;
      const handZ = hand.position.z - geometry.bandZ;
      if (handZ < -zoneFar || handZ > zoneNear) continue;
      if (hand.velocity.length() < HIT_GOOD_SPEED) continue;
      if (hand.swing < HIT_MIN_SWING) continue;

      note.resolved = true;
      note.group.visible = false;
      const grade: Grade =
        offsetMs >= -HIT_PERFECT_EARLY_MS && offsetMs <= HIT_PERFECT_LATE_MS ? 'perfect' : 'good';
      stats.lastGrade = grade;
      stats.lastOffsetMs = Math.round(offsetMs);
      score.judge(grade, offsetMs);
      if (grade === 'perfect') stats.perfect += 1;
      else stats.good += 1;
      popup.spawn(grade, popupPosition.set(x, y + 0.1, geometry.bandZ));
      spawnHitFeedback(hand.side, grade, x, y, hand.velocity);
      hooks.onJudge?.(hand.side, grade, offsetMs, 'hit');
      return;
    }
  }

  function judgeDrag(note: Extract<RuntimeNote, { kind: 'drag' }>, hands: HandSample[]): void {
    const x = xOf(note.chart);
    const y = yOf(note.chart);
    const offsetMs = clockMs - note.chart.time;
    if (offsetMs > DRAG_WINDOW_MS) {
      note.resolved = true;
      note.group.visible = false;
      noteMiss(new THREE.Vector3(x, y, geometry.bandZ));
      return;
    }
    if (offsetMs < -DRAG_WINDOW_MS) return;

    for (const hand of hands) {
      if (!hand.active || hand.velocity.length() < MIN_SWEEP_SPEED) continue;
      if (Math.abs(hand.position.x - x) > HIT_HALF_X) continue;
      if (Math.abs(hand.position.y - y) > HIT_HALF_Y) continue;
      if (Math.abs(hand.position.z - geometry.bandZ) > HAND_ZONE) continue;

      note.resolved = true;
      note.group.visible = false;
      notePerfect(hand.side, offsetMs, new THREE.Vector3(x, y, geometry.bandZ), 1, 'drag');
      shatterDirection.copy(hand.velocity);
      shatter.spawn(new THREE.Vector3(x, y, geometry.bandZ), shatterDirection, 0xcfefff, 12, {
        size: 0.55,
        life: 0.75,
      });
      return;
    }
  }

  function updateHold(
    note: Extract<RuntimeNote, { kind: 'hold' }>,
    dt: number,
    hands: HandSample[],
    auto = false,
  ): void {
    const x = xOf(note.chart);
    const y = yOf(note.chart);
    const headZ = zAt(note.chart.time, clockMs);
    const tailZ = zAt(note.chart.time + note.chart.duration, clockMs);
    const far = Math.min(headZ, tailZ);
    const near = Math.max(headZ, tailZ);

    note.group.position.set(x, y, far);
    note.group.rotation.z = 0;

    // 片子：从 far 到 near。
    const visibleNear = Math.min(near, geometry.nearZ + 0.02);
    const visibleLength = Math.max(visibleNear - far, 0.001);
    note.sheet.scale.z = visibleLength;
    note.sheet.position.z = visibleLength / 2;

    // 亮边压在片子靠近玩家的那一端；片子被近端裁掉时，亮边跟着留在裁剪边上。
    const headBarZ = Math.min(near, visibleNear) - 0.012;
    note.headBar.visible = headBarZ > far + 0.005;
    note.headBar.position.z = Math.max(headBarZ - far, 0.012);
    const headAhead = Math.max(geometry.bandZ - headBarZ, 0);
    note.headBar.scale.y = THREE.MathUtils.clamp((0.0045 * headAhead) / 0.014, 1, 2.2);

    for (const rail of note.rails) {
      rail.scale.z = visibleLength;
      rail.position.z = visibleLength / 2;
    }

    const litStart = Math.max(geometry.bandZ, far);
    const litLength = Math.max(visibleNear - litStart, 0);
    note.strip.visible = litLength > 0.01;
    note.strip.scale.z = Math.max(litLength, 0.001);
    note.strip.position.z = litStart - far + litLength / 2;

    const contactHand = auto
      ? null
      : hands.find(
          (hand) =>
            hand.pressed &&
            hand.active &&
            Math.abs(hand.position.x - x) <= 0.13 &&
            Math.abs(hand.position.y - y) <= 0.26 &&
            hand.position.z >= far - 0.05 &&
            hand.position.z <= near + 0.05,
        );
    const contact = auto || contactHand !== null;
    const side: HandSide = contactHand?.side ?? note.chart.hand ?? 'none';
    if (contactHand && (contactHand.side === 'left' || contactHand.side === 'right')) {
      sustain[contactHand.side] = true;
    }

    const targetGlow = contact ? 1 : 0;
    note.glow += (targetGlow - note.glow) * Math.min(1, dt * 12);
    // 底光 + 底不透明度：hold 是一整片玻璃，太透的话远处几乎看不见，
    // 会变成「到跟前才突然出现」。留一点自发光，它在远端就能读成一条片子。
    note.sheetMaterial.emissiveIntensity = 0.85 + note.glow * 2.0;
    note.sheetMaterial.opacity = 0.62 + 0.2 * note.glow;
    note.stripMaterial.opacity = 0.5 + 0.4 * note.glow;
    note.auraMaterial.opacity = 0.55 * note.glow;
    note.aura.visible = note.glow > 0.02;
    note.aura.scale.set(0.36, Math.max(visibleLength, 0.001), 1);
    note.aura.position.z = visibleLength / 2;

    for (const tick of note.ticks) {
      if (tick.resolved) continue;
      if (auto) {
        if (clockMs < tick.time) continue;
        tick.held = true;
        tick.resolved = true;
        notePerfect(side, 0, new THREE.Vector3(x, y, geometry.bandZ), 1, 'hold');
        shatterDirection.set(0, 1, 0);
        shatter.spawn(new THREE.Vector3(x, y + 0.026, geometry.bandZ), shatterDirection, 0xbfe9ff, 4, {
          size: 0.4,
          life: 0.8,
        });
        continue;
      }
      const windowMs = note.tickWindow * 1000;
      const offsetMs = clockMs - tick.time;
      if (Math.abs(offsetMs) <= windowMs / 2) {
        if (!tick.held && contact) {
          tick.held = true;
          notePerfect(side, 0, new THREE.Vector3(x, y, geometry.bandZ), 1, 'hold');
          shatterDirection.set(0, 1, 0);
          shatter.spawn(new THREE.Vector3(x, y + 0.026, geometry.bandZ), shatterDirection, 0xbfe9ff, 4, {
            size: 0.4,
            life: 0.8,
          });
        }
      } else if (offsetMs > windowMs / 2) {
        tick.resolved = true;
        if (!tick.held) noteMiss(new THREE.Vector3(x, y - 0.02, geometry.bandZ), 'hold');
      }
    }

    if (clockMs > note.chart.time + note.chart.duration + MISS_MS) {
      note.resolved = true;
      note.group.visible = false;
    }
  }

  /**
   * 视距裁剪 + 淡出。
   *
   * - 远端：进入台面最后 2.4m 里逐渐显形，而不是凭空 pop 出来；
   * - 近端：过了判定带、连「good」窗口都走完的物件就不再画（hold 用它自己的尾端算）。
   */
  function updateVisibility(note: RuntimeNote): void {
    if (note.kind === 'arc') {
      note.arc.group.visible = true;
      return;
    }
    if (note.resolved) return;

    if (note.kind === 'hold') {
      // hold 是一张长片：只要**靠近玩家的那一端**还在台面上就该画。
      // （远端那半截由 shader 按世界 z 淡掉，所以整片不能因为尾端越界就整条消失。）
      const headZ = zAt(note.chart.time, clockMs);
      const tailZ = zAt(note.chart.time + note.chart.duration, clockMs);
      const nearEnd = Math.max(headZ, tailZ);
      const farEnd = Math.min(headZ, tailZ);
      note.group.visible = nearEnd > fadeFar && farEnd <= geometry.nearZ;
      return;
    }

    const z = zAt(note.chart.time, clockMs);
    note.group.position.set(xOf(note.chart), yOf(note.chart), z);

    // 淡出是 shader 逐片元做的；这里只裁掉「整颗物件已经在台面外」的情况。
    // 流速越快，note 过线后还要多留一会儿（good 窗口按时间算，不按距离）。
    const nearLimit = geometry.nearZ + 0.1 + (MISS_MS / 1000) * baseSpeed();
    note.group.visible = z > fadeFar && z <= nearLimit;

    // 细物件在远处会掉到 1–2 px：按距离补一点厚度，让「是一条」这件事撑住。
    if (note.kind === 'drag') {
      const ahead = Math.max(geometry.bandZ - z, 0);
      note.bar.scale.y = THREE.MathUtils.clamp((0.0045 * ahead) / 0.011, 1, 2.6);
    }
  }

  /** 自动演示：到点直接完美，不再模拟手。 */
  function judgeAuto(note: Extract<RuntimeNote, { kind: 'hit' | 'drag' }>): void {
    if (clockMs < note.chart.time) return;
    note.resolved = true;
    note.group.visible = false;
    const at = new THREE.Vector3(xOf(note.chart), yOf(note.chart), geometry.bandZ);
    notePerfect(note.chart.hand ?? 'none', 0, at, 1);
    if (note.kind === 'hit') {
      spawnHitFeedback(note.chart.hand ?? 'none', 'perfect', at.x, at.y, shatterDirection.set(0, 1, 0));
    } else {
      shatterDirection.set(0, 1, 0);
      shatter.spawn(at, shatterDirection, 0xdfefff, 10, { size: 0.55, life: 0.75 });
    }
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

    get timeMs(): number {
      return clockMs;
    },

    get sustain(): { left: boolean; right: boolean } {
      return sustain;
    },

    get duration(): number {
      return timeline.duration;
    },

    get totalObjects(): number {
      return totalObjects;
    },

    setTimeSource(source: (() => number) | null): void {
      timeSource = source;
    },

    setFlowSpeed(speed: number): void {
      settings.flowSpeed = speed;
      for (const note of runtime) {
        if (note.kind === 'arc') note.arc.setSpeed(speed);
      }
    },

    update(dt: number, hands: HandSample[]): void {
      sustain.left = false;
      sustain.right = false;
      if (!settings.enabled) {
        finished = false;
        guide.clear();
        for (const note of runtime) {
          if (note.kind === 'arc') note.arc.group.visible = false;
          else note.group.visible = false;
        }
        shatter.update(dt);
        popup.update(dt);
        return;
      }

      // 时间来自音频时钟（唯一权威）；没有音频时退回逐帧累加。
      clockMs = timeSource ? timeSource() : clockMs + dt * 1000;
      windowValue = timeline.windowAt(clockMs);
      const samples = hands;

      const approaching: GuideHit[] = [];
      for (const note of runtime) {
        if (note.kind !== 'hit' || note.resolved) continue;
        if (Math.abs(clockMs - note.chart.time) > GUIDE_START_MS) continue;
        approaching.push({ x: xOf(note.chart), y: yOf(note.chart), time: note.chart.time });
      }
      guide.update(clockMs, windowValue, approaching);

      for (const note of runtime) {
        updateVisibility(note);

        if (note.kind === 'arc') {
          for (const event of note.arc.update(clockMs, samples, settings.auto)) handleArcEvent(event);
          if (note.arc.connectedSide === 'left' || note.arc.connectedSide === 'right') {
            sustain[note.arc.connectedSide] = true;
          }
          const lastTick = note.arc.ticks[note.arc.ticks.length - 1];
          if (lastTick && clockMs > lastTick.time + 300) {
            note.resolved = true;
            note.arc.group.visible = false;
          }
          continue;
        }

        if (note.resolved) continue;
        if (settings.auto) {
          if (note.kind === 'hold') updateHold(note, dt, samples, true);
          else judgeAuto(note);
          continue;
        }
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
      guide.clear();
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
      hitFactory.dispose();
      dragGeometry.dispose();
      dragGlowGeometry.dispose();
      holdSheetGeometry.dispose();
      holdStripGeometry.dispose();
      holdAuraGeometry.dispose();
      shatter.dispose();
      popup.dispose();
      guide.dispose();
      group.clear();
    },
  };
}
