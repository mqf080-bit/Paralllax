import type { Chart } from './schema';

/**
 * 示例谱面：只用来验证格式能不能表达该表达的东西。
 *
 * **全部时间都落在 150 BPM 的拍点上**（一拍 = 400ms）：
 * 音频时钟是按这份 timing 合成节拍轨的，谱面如果不在拍上，
 * 「对拍」就无从谈起。改谱面时请保持这个约束。
 *
 * 时间线：
 *   0.8s       A 段：4 颗 hit（左右手交替）
 *   2.4s       3 条 drag 楼梯
 *   3.6s       hold（4 个物量）
 *   4.4s       左 shift（0–3 窗口）
 *   5.2s       arc：两个直角 + 两段曲线，中间两个关键物量
 *   6.8s       SV 掉到 0.4（带 300ms 过渡）
 *   8.4s       回到常态窗口
 *  10.0s       SV 倒流（-1）——极端 SV 的表达
 *  11.6s       hold 收尾
 */

export const DEMO_CHART: Chart = {
  meta: {
    title: 'ANTAGONISM',
    artist: 'demo',
    charter: 'demo',
    difficulty: '',
    offset: 0,
  },

  timing: [{ time: 0, bpm: 150, beats: 4 }],

  sections: [
    { time: 0, label: 'A' },
    { time: 4400, label: 'B' },
    { time: 8400, label: 'C' },
  ],

  speed: [
    { time: 0, multiplier: 1 },
    { time: 6800, multiplier: 0.4, easing: 'sine', duration: 300 },
    { time: 7600, multiplier: 1, easing: 'sine', duration: 300 },
    { time: 10000, multiplier: -1, easing: 'sine', duration: 400 },
    { time: 10800, multiplier: 1, easing: 'sine', duration: 400 },
  ],

  shift: [
    { time: 4400, target: 'left', duration: 350 },
    { time: 8400, target: 'normal', duration: 350 },
  ],

  notes: [
    { type: 'hit', time: 800, lane: 1, hand: 'left' },
    { type: 'hit', time: 1200, lane: 4, hand: 'right' },
    { type: 'hit', time: 1600, lane: 2, hand: 'left' },
    { type: 'hit', time: 2000, lane: 3, hand: 'right' },

    { type: 'drag', time: 2400, lane: 1 },
    { type: 'drag', time: 2800, lane: 2 },
    { type: 'drag', time: 3200, lane: 3 },

    { type: 'hold', time: 3600, duration: 800, lane: 2, objects: 4 },

    {
      type: 'arc',
      time: 5200,
      hand: 'right',
      notesPerSecond: 4,
      keyObjects: [400, 800],
      points: [
        { time: 0, x: 1, z: 0.08, easing: 'linear' },
        { time: 400, x: 1, z: 0.4, easing: 'sine' },
        { time: 800, x: 3, z: 0.4, easing: 'linear' },
        { time: 1200, x: 3, z: 0.08, easing: 'sine' },
      ],
    },

    { type: 'hit', time: 8800, lane: 1, hand: 'left' },
    { type: 'hit', time: 9200, lane: 4, hand: 'right' },
    { type: 'hit', time: 9600, lane: 3, hand: 'right' },

    { type: 'hold', time: 11600, duration: 600, lane: 3, objects: 3 },
  ],
};
