import type { Chart } from './schema';

/**
 * Step 4 的验收谱：**约 42 秒，两次 shift**（左、右各一次），四种键型齐全。
 *
 * 约定：
 * - 150 BPM（一拍 400ms），**所有 note 都落在拍 / 八分音符上** —— 音频时钟按 timing 合成节拍轨，
 *   不在拍上就会听出来。改谱时请保持这个约束。
 * - 轨号是**绝对 0–5**；窗口由谱面的 shift 事件驱动：
 *   - 0–12s 常态（1–4）
 *   - 12s 左 shift（0–3）
 *   - 20s 回正（1–4）
 *   - 30s 右 shift（2–5）
 *   - 38s 回正（1–4）
 * - shift 过渡 350ms，过渡期内不写 note（校验器按四舍五入后的窗口判断）。
 * - arc 的高度只用两条基准线：胸（0.33m）/ 面（0.61m）；上限是头顶（0.81m）。
 * - SV 只写两处：A 段 0.6 慢速、B 段 200ms 停表 —— 够验证「判定与流速无关」，不折磨人。
 *
 * 段落：
 *   A 0–12s   引入：八分 hit → drag 楼梯 → hold → arc（两个关键物量）→ hold
 *   B 12–20s  左 shift：低轨 hit / drag / hold / arc
 *   C 20–30s  常态：密度上来，arc 抬到面部高度
 *   D 30–38s  右 shift：高轨 hit / drag / hold / arc
 *   E 38–42s  收尾：回到常态，最后一条 hold + 一颗 hit
 */
export const TEST_CHART: Chart = {
  meta: {
    title: 'PROVING GROUND',
    artist: 'demo',
    charter: 'demo',
    difficulty: 'IN 8',
    offset: 0,
  },

  timing: [{ time: 0, bpm: 150, beats: 4 }],

  sections: [
    { time: 0, label: 'A' },
    { time: 12000, label: 'B' },
    { time: 20000, label: 'C' },
    { time: 30000, label: 'D' },
    { time: 38000, label: 'E' },
  ],

  speed: [
    { time: 0, multiplier: 1 },
    // 慢速段：看远 / 中 / 近三档的可读性（A 段）
    { time: 7200, multiplier: 0.6, easing: 'sine', duration: 400 },
    { time: 8400, multiplier: 1, easing: 'sine', duration: 400 },
    // 短停表：200ms 内 note 不动（判定照常按时间走，B 段）
    { time: 16400, multiplier: 0, easing: 'linear', duration: 200 },
    { time: 16600, multiplier: 1, easing: 'sine', duration: 200 },
  ],

  shift: [
    { time: 12000, target: 'left', duration: 350 },
    { time: 20000, target: 'normal', duration: 350 },
    { time: 30000, target: 'right', duration: 350 },
    { time: 38000, target: 'normal', duration: 350 },
  ],

  notes: [
    // —— A 段（常态 1–4）——
    { type: 'hit', time: 800, lane: 1, hand: 'left' },
    { type: 'hit', time: 1200, lane: 4, hand: 'right' },
    { type: 'hit', time: 1600, lane: 2, hand: 'left' },
    { type: 'hit', time: 2000, lane: 3, hand: 'right' },
    { type: 'hit', time: 2400, lane: 1, hand: 'left' },
    { type: 'hit', time: 2800, lane: 4, hand: 'right' },

    { type: 'drag', time: 3200, lane: 1 },
    { type: 'drag', time: 3400, lane: 2 },
    { type: 'drag', time: 3600, lane: 3 },
    { type: 'drag', time: 3800, lane: 4 },

    { type: 'hold', time: 4000, duration: 800, lane: 2, objects: 4 },

    { type: 'hit', time: 4800, lane: 1, hand: 'left' },
    { type: 'hit', time: 5200, lane: 4, hand: 'right' },
    { type: 'hit', time: 5600, lane: 2, hand: 'left' },
    { type: 'hit', time: 6000, lane: 3, hand: 'right' },

    {
      type: 'arc',
      time: 6400,
      hand: 'right',
      notesPerSecond: 4,
      keyObjects: [400, 800],
      points: [
        { time: 0, x: 1, z: 0.08, easing: 'linear' },
        { time: 400, x: 1, z: 0.33, easing: 'sine' },
        { time: 800, x: 3, z: 0.33, easing: 'linear' },
        { time: 1200, x: 3, z: 0.08, easing: 'sine' },
      ],
    },

    { type: 'hit', time: 8000, lane: 1, hand: 'left' },
    { type: 'hit', time: 8400, lane: 4, hand: 'right' },

    { type: 'hold', time: 8800, duration: 800, lane: 3, objects: 4 },

    { type: 'hit', time: 9600, lane: 2, hand: 'left' },
    { type: 'hit', time: 10000, lane: 4, hand: 'right' },
    { type: 'hit', time: 10400, lane: 1, hand: 'left' },
    { type: 'hit', time: 10800, lane: 3, hand: 'right' },

    // —— B 段（左 shift 0–3）——
    { type: 'hit', time: 12400, lane: 0, hand: 'left' },
    { type: 'hit', time: 12800, lane: 3, hand: 'right' },
    { type: 'hit', time: 13200, lane: 1, hand: 'left' },
    { type: 'hit', time: 13600, lane: 2, hand: 'right' },

    { type: 'drag', time: 14000, lane: 0 },
    { type: 'drag', time: 14200, lane: 1 },
    { type: 'drag', time: 14400, lane: 2 },
    { type: 'drag', time: 14600, lane: 3 },

    { type: 'hold', time: 15200, duration: 800, lane: 0, objects: 4 },

    {
      type: 'arc',
      time: 16000,
      hand: 'left',
      notesPerSecond: 4,
      keyObjects: [800],
      points: [
        { time: 0, x: 0, z: 0.08, easing: 'linear' },
        { time: 400, x: 0, z: 0.33, easing: 'sine' },
        { time: 800, x: 2, z: 0.33, easing: 'linear' },
        { time: 1200, x: 2, z: 0.08, easing: 'sine' },
      ],
    },

    { type: 'hit', time: 16800, lane: 3, hand: 'right' },
    { type: 'hit', time: 17200, lane: 1, hand: 'left' },
    { type: 'hit', time: 17600, lane: 2, hand: 'right' },
    { type: 'hit', time: 18000, lane: 0, hand: 'left' },

    { type: 'hold', time: 18400, duration: 800, lane: 3, objects: 4 },

    // —— C 段（常态 1–4）——
    { type: 'hit', time: 20400, lane: 1, hand: 'left' },
    { type: 'hit', time: 20800, lane: 4, hand: 'right' },
    { type: 'hit', time: 21200, lane: 2, hand: 'left' },
    { type: 'hit', time: 21600, lane: 3, hand: 'right' },
    { type: 'hit', time: 22000, lane: 1, hand: 'left' },
    { type: 'hit', time: 22400, lane: 4, hand: 'right' },

    { type: 'drag', time: 22800, lane: 2 },
    { type: 'drag', time: 23200, lane: 3 },
    { type: 'drag', time: 23600, lane: 1 },

    { type: 'hold', time: 24000, duration: 800, lane: 4, objects: 4 },

    { type: 'hit', time: 25200, lane: 2, hand: 'left' },
    { type: 'hit', time: 25600, lane: 3, hand: 'right' },

    {
      type: 'arc',
      time: 26000,
      hand: 'right',
      notesPerSecond: 4,
      keyObjects: [400, 800],
      points: [
        { time: 0, x: 1, z: 0.08, easing: 'linear' },
        { time: 400, x: 1, z: 0.61, easing: 'sine' },
        { time: 800, x: 4, z: 0.61, easing: 'linear' },
        { time: 1200, x: 4, z: 0.08, easing: 'sine' },
      ],
    },

    { type: 'hit', time: 27200, lane: 3, hand: 'right' },
    { type: 'hit', time: 27600, lane: 1, hand: 'left' },
    { type: 'hit', time: 28000, lane: 2, hand: 'right' },
    { type: 'hit', time: 28400, lane: 4, hand: 'right' },

    { type: 'hold', time: 28800, duration: 800, lane: 1, objects: 4 },

    // —— D 段（右 shift 2–5）——
    { type: 'hit', time: 30400, lane: 2, hand: 'left' },
    { type: 'hit', time: 30800, lane: 5, hand: 'right' },
    { type: 'hit', time: 31200, lane: 3, hand: 'left' },
    { type: 'hit', time: 31600, lane: 4, hand: 'right' },

    { type: 'drag', time: 32000, lane: 2 },
    { type: 'drag', time: 32200, lane: 3 },
    { type: 'drag', time: 32400, lane: 4 },
    { type: 'drag', time: 32600, lane: 5 },

    { type: 'hold', time: 33200, duration: 800, lane: 5, objects: 4 },

    {
      type: 'arc',
      time: 34000,
      hand: 'right',
      notesPerSecond: 4,
      keyObjects: [800],
      points: [
        { time: 0, x: 2, z: 0.08, easing: 'linear' },
        { time: 400, x: 2, z: 0.33, easing: 'sine' },
        { time: 800, x: 5, z: 0.33, easing: 'linear' },
        { time: 1200, x: 5, z: 0.08, easing: 'sine' },
      ],
    },

    { type: 'hit', time: 34800, lane: 3, hand: 'left' },
    { type: 'hit', time: 35200, lane: 4, hand: 'right' },
    { type: 'hit', time: 35600, lane: 2, hand: 'left' },
    { type: 'hit', time: 36000, lane: 5, hand: 'right' },

    { type: 'hold', time: 36400, duration: 800, lane: 3, objects: 4 },

    // —— E 段（回正 1–4）——
    { type: 'hit', time: 38400, lane: 1, hand: 'left' },
    { type: 'hit', time: 38800, lane: 4, hand: 'right' },
    { type: 'hit', time: 39200, lane: 2, hand: 'left' },
    { type: 'hit', time: 39600, lane: 3, hand: 'right' },
    { type: 'hit', time: 40000, lane: 1, hand: 'left' },
    { type: 'hit', time: 40400, lane: 4, hand: 'right' },

    { type: 'hold', time: 40800, duration: 800, lane: 2, objects: 4 },

    { type: 'hit', time: 41600, lane: 3, hand: 'right' },
  ],
};
