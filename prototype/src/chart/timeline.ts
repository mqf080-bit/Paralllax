import { CHART_DEFAULTS, type Chart, type Easing, type Section } from './schema';

/**
 * 谱面时间轴：把「时间」翻译成运行时要用的量。
 *
 * - `scrollDistance(t)`：从 0 到 t 的**滚动距离**（单位 = 倍率·秒）。
 *   运行时乘上基准流速就是米。支持 0 / 负数 / 极端 SV——它就是速度的积分。
 * - `windowAt(t)`：4 轨窗口的位置（-1 / 0 / 1 之间的连续值），shift 事件驱动。
 * - `barBeat(t)`：小节 / 拍，给制谱器对齐用。
 *
 * 判定不经过这里：判定只看 note 的绝对时间。
 */

export interface SpeedSegment {
  start: number;
  end: number;
  from: number;
  to: number;
  easing: Easing;
  /** 段起点处的累计滚动距离。 */
  cumulative: number;
}

export interface WindowSegment {
  start: number;
  end: number;
  from: number;
  to: number;
}

export interface BarBeat {
  bar: number;
  beat: number;
  beatsPerBar: number;
  bpm: number;
}

export interface Timeline {
  /** 倍率·秒（乘基准流速 = 米）。 */
  scrollDistance(time: number): number;
  speedAt(time: number): number;
  windowAt(time: number): number;
  barBeat(time: number): BarBeat | null;
  /** 谱面最后一颗 note 的结束时间。 */
  readonly duration: number;
  readonly sections: Section[];
}

function easeValue(easing: Easing, u: number): number {
  const t = Math.min(1, Math.max(0, u));
  switch (easing) {
    case 'linear':
      return t;
    case 'sine':
      return Math.sin((t * Math.PI) / 2);
    case 'cosine':
      return 1 - Math.cos((t * Math.PI) / 2);
    case 'bezier':
      // 近似 cubic ease-in-out。
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
}

function segmentSpeed(segment: SpeedSegment, u: number): number {
  return segment.from + (segment.to - segment.from) * easeValue(segment.easing, u);
}

function integrate(segment: SpeedSegment, to: number): number {
  const from = segment.start;
  const end = Math.min(to, segment.end);
  if (end <= from) return 0;

  const duration = segment.end - segment.start;
  if (duration <= 0 || segment.from === segment.to) {
    return (end - from) * segment.from;
  }

  // 数值积分：极端 SV 下也稳。
  const steps = 16;
  const step = (end - from) / steps;
  let sum = 0;
  for (let i = 0; i < steps; i += 1) {
    const t = from + (i + 0.5) * step;
    sum += segmentSpeed(segment, (t - segment.start) / duration) * step;
  }
  return sum;
}

function buildSpeedSegments(chart: Chart): SpeedSegment[] {
  const events = [...chart.speed].sort((a, b) => a.time - b.time);
  const segments: SpeedSegment[] = [];

  let time = 0;
  let multiplier = 1;

  const push = (start: number, end: number, from: number, to: number, easing: Easing): void => {
    if (end === start && start === Number.POSITIVE_INFINITY) return;
    segments.push({ start, end, from, to, easing, cumulative: 0 });
  };

  for (const event of events) {
    if (event.time > time) push(time, event.time, multiplier, multiplier, 'linear');
    const duration = Math.max(0, event.duration ?? 0);
    if (duration > 0) {
      push(event.time, event.time + duration, multiplier, event.multiplier, event.easing ?? 'linear');
    } else {
      push(event.time, event.time, multiplier, event.multiplier, 'linear');
    }
    time = event.time + duration;
    multiplier = event.multiplier;
  }
  push(time, Number.POSITIVE_INFINITY, multiplier, multiplier, 'linear');

  let cumulative = 0;
  for (const segment of segments) {
    segment.cumulative = cumulative;
    if (Number.isFinite(segment.end)) cumulative += integrate(segment, segment.end);
  }
  return segments;
}

function buildWindowSegments(chart: Chart): WindowSegment[] {
  const events = [...chart.shift].sort((a, b) => a.time - b.time);
  const targetValue = { normal: 0, left: -1, right: 1 } as const;
  const segments: WindowSegment[] = [];

  let time = 0;
  let value = 0;
  for (const event of events) {
    if (event.time > time) segments.push({ start: time, end: event.time, from: value, to: value });
    const duration = Math.max(0, event.duration ?? CHART_DEFAULTS.shiftDuration);
    const target = targetValue[event.target];
    if (duration > 0) {
      segments.push({ start: event.time, end: event.time + duration, from: value, to: target });
    } else {
      segments.push({ start: event.time, end: event.time, from: value, to: target });
    }
    time = event.time + duration;
    value = target;
  }
  segments.push({ start: time, end: Number.POSITIVE_INFINITY, from: value, to: value });
  return segments;
}

function noteEndTime(chart: Chart): number {
  let end = 0;
  for (const note of chart.notes) {
    if (note.type === 'hold') end = Math.max(end, note.time + note.duration);
    else if (note.type === 'arc') {
      const last = note.points[note.points.length - 1];
      if (last) end = Math.max(end, note.time + last.time);
    } else end = Math.max(end, note.time);
  }
  return end;
}

export function createTimeline(chart: Chart): Timeline {
  const speedSegments = buildSpeedSegments(chart);
  const windowSegments = buildWindowSegments(chart);
  const timing = [...chart.timing].sort((a, b) => a.time - b.time);

  function speedAt(time: number): number {
    const first = speedSegments[0];
    // lead-in：谱面从负数时间起播时，按第一档速度往前推。
    if (first && time < first.start) return first.from;
    for (const segment of speedSegments) {
      if (time < segment.start) continue;
      if (time >= segment.end) continue;
      const duration = segment.end - segment.start;
      if (!Number.isFinite(duration) || duration <= 0) return segment.to;
      return segmentSpeed(segment, (time - segment.start) / duration);
    }
    const last = speedSegments[speedSegments.length - 1];
    return last ? last.to : 1;
  }

  function scrollDistance(time: number): number {
    const first = speedSegments[0];
    // 负数时间（lead-in）：从 0 按第一档速度反向外推。
    if (first && time < first.start) return (time - first.start) * first.from;
    let total = 0;
    for (const segment of speedSegments) {
      if (time <= segment.start) break;
      if (Number.isFinite(segment.end) && time >= segment.end) {
        total += integrate(segment, segment.end);
      } else {
        total += integrate(segment, time);
        break;
      }
    }
    return total;
  }

  function windowAt(time: number): number {
    const first = windowSegments[0];
    if (first && time < first.start) return first.from;
    for (const segment of windowSegments) {
      if (time < segment.start) continue;
      if (time >= segment.end) continue;
      const duration = segment.end - segment.start;
      if (!Number.isFinite(duration) || duration <= 0) return segment.to;
      const u = Math.min(1, Math.max(0, (time - segment.start) / duration));
      const eased = u * u * (3 - 2 * u);
      return segment.from + (segment.to - segment.from) * eased;
    }
    const last = windowSegments[windowSegments.length - 1];
    return last ? last.to : 0;
  }

  function barBeat(time: number): BarBeat | null {
    let current = timing[0];
    if (!current) return null;
    for (const point of timing) {
      if (point.time <= time) current = point;
      else break;
    }
    if (!current) return null;

    const beatsPerBar = Math.max(1, current.beats);
    const beats = ((time - current.time) * current.bpm) / 60000;
    const bar = Math.floor(beats / beatsPerBar);
    const beat = beats - bar * beatsPerBar;
    return { bar, beat, beatsPerBar, bpm: current.bpm };
  }

  return {
    scrollDistance,
    speedAt,
    windowAt,
    barBeat,
    duration: noteEndTime(chart),
    sections: chart.sections ?? [],
  };
}

/** 谱面校验：返回问题列表（空 = 没问题）。制谱器和运行时共用。 */
export function validateChart(chart: Chart): string[] {
  const issues: string[] = [];
  const timeline = createTimeline(chart);

  const timing = [...chart.timing].sort((a, b) => a.time - b.time);
  if (timing.length === 0) issues.push('timing: 至少要有一个 TimingPoint');
  for (const point of timing) {
    if (!(point.bpm > 0)) issues.push(`timing@${point.time}: bpm 必须 > 0`);
    if (!(point.beats > 0)) issues.push(`timing@${point.time}: beats 必须 > 0`);
  }

  for (const event of chart.speed) {
    if (!Number.isFinite(event.multiplier)) issues.push(`speed@${event.time}: multiplier 必须是有限数`);
    if ((event.duration ?? 0) < 0) issues.push(`speed@${event.time}: duration 不能为负`);
  }

  for (const event of chart.shift) {
    if (!['normal', 'left', 'right'].includes(event.target)) issues.push(`shift@${event.time}: 未知 target`);
    if ((event.duration ?? CHART_DEFAULTS.shiftDuration) < 0) issues.push(`shift@${event.time}: duration 不能为负`);
  }

  const sorted = [...chart.notes].sort((a, b) => a.time - b.time);
  if (sorted.some((note, index) => note !== chart.notes[index])) issues.push('notes: 建议按时间排序');

  for (const note of sorted) {
    if (note.type === 'arc') {
      const points = note.points;
      if (points.length < 2) issues.push(`arc@${note.time}: 至少两个点`);
      if (points[0] && points[0].time !== 0) issues.push(`arc@${note.time}: 第一个点的 time 必须是 0`);
      for (let i = 0; i < points.length; i += 1) {
        const point = points[i]!;
        if (i > 0 && point.time <= points[i - 1]!.time) issues.push(`arc@${note.time}: 点的 time 必须递增`);
        if (point.x < -0.5 || point.x > 5.5) issues.push(`arc@${note.time}: x 超出 0–5`);
        if (point.y < 0) issues.push(`arc@${note.time}: y 不能为负`);
      }
      for (const key of note.keyObjects ?? []) {
        const last = points[points.length - 1];
        if (last && (key < 0 || key > last.time)) issues.push(`arc@${note.time}: 关键物量 ${key} 超出弧长`);
      }
      continue;
    }

    if (!Number.isInteger(note.lane)) issues.push(`note@${note.time}: 地面键的 lane 必须是整数`);
    if (note.lane < 0 || note.lane > 5) issues.push(`note@${note.time}: lane 超出 0–5`);

    const windowValue = Math.round(timeline.windowAt(note.time));
    const low = 1 + windowValue;
    const high = 4 + windowValue;
    if (note.lane < low || note.lane > high) {
      issues.push(`note@${note.time}: lane ${note.lane} 不在当时的窗口 ${low}–${high}`);
    }

    if (note.type === 'hold' && note.duration <= 0) issues.push(`hold@${note.time}: duration 必须 > 0`);
  }

  return issues;
}
