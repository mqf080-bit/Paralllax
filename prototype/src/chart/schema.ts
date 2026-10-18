/**
 * Parallax 谱面数据格式（v0）。
 *
 * 时间统一用**毫秒**（和 Arcaea 的 AFF 一样），坐标用「轨号 + 米」。
 * 设计目标：能写极端 SV、能写 shift、能把 arc 的钝角 / 直角 / 曲线记下来，
 * 同时尽量贴着 AFF 的概念，减少制谱工具的工作量。
 *
 * AFF 对照：
 * - `AudioOffset`            → `meta.offset`
 * - `timing(t, bpm, beats)`  → `TimingPoint`
 * - `(t, lane)`              → `HitNote`
 * - `hold(t0, t1, lane)`     → `HoldNote`
 * - `arc(t0, t1, x0, x1, easing, y0, y1, …)` + `arctap(t)` → `ArcNote` 的分段 / `keyObjects`
 * - BPM 负数做变速（SV）      → 独立的 `SpeedEvent` 轨道（BPM 只负责小节）
 * - 时间组 `timinggroup()`    → 暂不做（不在 v0 范围）
 */

export type Hand = 'left' | 'right';

/** arc 分段的缓动：linear / sine / cosine / bezier（暂用 cubic 近似）。 */
export type Easing = 'linear' | 'sine' | 'cosine' | 'bezier';

export interface ChartMeta {
  title: string;
  artist: string;
  charter: string;
  difficulty: string;
  /** 音频偏移（毫秒）：正数 = 谱面时间比音频早，和 AFF 的 AudioOffset 同义。 */
  offset: number;
}

/** 小节信息：BPM 只用于画小节线 / 制谱器对齐，不参与滚动速度。 */
export interface TimingPoint {
  time: number;
  bpm: number;
  /** 每小节拍数。 */
  beats: number;
}

/** 制谱器用的段落标记（不参与判定）。 */
export interface Section {
  time: number;
  label: string;
}

/**
 * 视觉流速（SV）。`multiplier` 相对谱面基准流速：
 * 1 = 正常，0 = 停住，负数 = 倒流，可以写极端值（如 8、-2）。
 * `duration` 与 `easing` 描述从上一档过渡到这一档的方式（0 = 瞬变）。
 *
 * 判定不受它影响：判定只看每颗 note 的 `time`。
 */
export interface SpeedEvent {
  time: number;
  multiplier: number;
  easing?: Easing;
  /** 过渡时长（毫秒）。默认 0。 */
  duration?: number;
}

/**
 * 窗口 shift 事件。目标窗口：
 * - normal：1–4
 * - left：0–3
 * - right：2–5
 * `duration` 是窗口滑动的时间（毫秒），也就是「shift 的速度」。
 */
export interface ShiftEvent {
  time: number;
  target: 'normal' | 'left' | 'right';
  duration?: number;
}

interface TimedNote {
  /** 判定时间（毫秒）。 */
  time: number;
}

interface LaneNote extends TimedNote {
  /** 绝对轨号 0–5。谱面必须保证它落在当时的窗口里。 */
  lane: number;
  /** 手别；省略 = 中性（任意手）。 */
  hand?: Hand;
}

export interface HitNote extends LaneNote {
  type: 'hit';
}

export interface DragNote extends LaneNote {
  type: 'drag';
}

export interface HoldNote extends LaneNote {
  type: 'hold';
  /** 按住时长（毫秒）。 */
  duration: number;
  /** hold 内的物量个数；省略时按 `notesPerSecond` 取。 */
  objects?: number;
  /** 物量密度（个 / 秒），默认 5。 */
  notesPerSecond?: number;
}

/**
 * arc 的一个分段端点。
 * - `time`：相对 arc 起点的毫秒；
 * - `x`：轨号（0–5，可带小数，2.5 = 2、3 轨之间）；
 * - `y`：台面上方的高度（米）；
 * - `easing`：从**上一个点**走到这个点用的缓动。
 *
 * 直角 / 钝角：连续两个 `linear` 段在同一个点相接，就会得到硬角；
 * 曲线：用 `sine` / `cosine` / `bezier` 段。
 */
export interface ArcPoint {
  time: number;
  x: number;
  y: number;
  easing: Easing;
}

export interface ArcNote extends TimedNote {
  type: 'arc';
  hand: Hand;
  /** 至少两个点；第一个点的 time 必须是 0。 */
  points: ArcPoint[];
  /** 关键物量：相对起点的时间（毫秒）。必须被体积判定接住，断开重连补不回来。 */
  keyObjects?: number[];
  /** 普通物量密度（个 / 秒），默认 4；均匀分布。 */
  notesPerSecond?: number;
}

export type Note = HitNote | DragNote | HoldNote | ArcNote;

/**
 * 三条高度基准线（米，相对台面）。**只用于制谱**，游戏里不画出来。
 *
 * 台面 0.95m；按 1.75m 的玩家算：
 * - 胸 ≈ 1.28m（台面上 0.33）
 * - 面 ≈ 1.56m（台面上 0.61）
 * - 头顶 ≈ 1.76m（台面上 0.81）
 *
 * 写谱时高度就按这三条线读，不要写「差不多 0.4」这种数。
 */
export const HEIGHT_LEVELS = [
  { id: 'chest', label: 'CHEST', y: 0.33 },
  { id: 'face', label: 'FACE', y: 0.61 },
  { id: 'head', label: 'HEAD', y: 0.81 },
] as const;

/**
 * 谱面硬性限制：运行时会据此裁剪 —— **不满足的 note 不生成**。
 *
 * 高度上限存在的理由：玩家站在台面前，手能舒服够到的高度是有限的。
 * 台面 0.95m，手能稳定挥到 1.55m 左右，再高就要抬手 / 伸肩，
 * 连续交互会明显掉速。0.6m 是「还能当做正常动作」的上限。
 */
export interface ChartLimits {
  /** note 的最大高度（米，相对台面）。默认 0.81（= 头顶基准线）。 */
  maxHeight: number;
}

export interface Chart {
  meta: ChartMeta;
  timing: TimingPoint[];
  sections?: Section[];
  speed: SpeedEvent[];
  shift: ShiftEvent[];
  notes: Note[];
  /** 覆盖默认限制（一般不用写；写错会被校验器拦下）。 */
  limits?: Partial<ChartLimits>;
}

/** 默认限制。制谱器、校验器、运行时共用。 */
export const CHART_LIMITS: ChartLimits = {
  // 头顶那条高度基准线。
  maxHeight: HEIGHT_LEVELS[HEIGHT_LEVELS.length - 1]!.y,
};

/** 谱面实际生效的限制 = 默认值 + 谱面覆盖。 */
export function chartLimits(chart: Chart): ChartLimits {
  return { ...CHART_LIMITS, ...chart.limits };
}

/** 默认值集中在这里，制谱器和运行时都用同一套。 */
export const CHART_DEFAULTS = {
  shiftDuration: 350,
  holdNotesPerSecond: 5,
  arcNotesPerSecond: 4,
} as const;
