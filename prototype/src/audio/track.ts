import { beatMsOf, meterOf, type TimingPoint } from '../chart/schema';

/**
 * 程序化节拍轨（没有外部音频资产）。
 *
 * 为什么要有它：判定是按时间判的，时间必须有「可靠来源」。真实的音频文件
 * 是最理想的来源，但原型阶段没有曲子；于是用 WebAudio 现场合成一条节拍轨，
 * 它和谱面共用同一张 timing 表，所以「听到的拍子」和「谱面时间」天然对齐。
 *
 * 一旦接入真实音轨（`?audio=`），这条合成轨就退化成可选择保留的节拍器。
 *
 * 拍点完全从 timing 推导：每段 timing 视为一个小节起点，段内按 bpm 切拍，
 * 段与段之间不插值（换段 = 换拍，和 AFF 的 timing 语义一致）。
 */

export interface Beat {
  /** 谱面时间（毫秒）。 */
  time: number;
  /** 该 timing 段内的第几拍。 */
  index: number;
  /** 小节第一拍。 */
  bar: boolean;
  bpm: number;
  beatsPerBar: number;
  /** timing 段序号（用来换和弦）。 */
  segment: number;
}

/** 生成 [fromMs, toMs) 内的所有拍点。 */
export function collectBeats(timing: TimingPoint[], fromMs: number, toMs: number): Beat[] {
  const points = [...timing].sort((a, b) => a.time - b.time);
  if (points.length === 0 || !(toMs > fromMs)) return [];

  const beats: Beat[] = [];
  // 拍点总数上限：极端 BPM（比如 60000）不该把调度器炸掉。
  const LIMIT = 4096;

  for (let segment = 0; segment < points.length; segment += 1) {
    const point = points[segment]!;
    const next = points[segment + 1];
    const bpm = Math.max(1, point.bpm);
    const beatsPerBar = meterOf(point).numerator;
    const beatMs = beatMsOf(point);

    // 第一段向前无限延伸：lead-in（负数时间）也要有拍子。
    const start = segment === 0 ? fromMs : Math.max(fromMs, point.time);
    const end = next ? Math.min(toMs, next.time) : toMs;
    if (!(end > start)) continue;

    const firstIndex = Math.ceil((start - point.time) / beatMs - 1e-6);
    const lastIndex = Math.floor((end - point.time) / beatMs - 1e-6);

    for (let index = firstIndex; index <= lastIndex; index += 1) {
      const time = point.time + index * beatMs;
      if (time < fromMs || time >= toMs) continue;
      const inBar = ((index % beatsPerBar) + beatsPerBar) % beatsPerBar;
      beats.push({ time, index, bar: inBar === 0, bpm, beatsPerBar, segment });
      if (beats.length >= LIMIT) return beats;
    }
  }

  return beats;
}

export interface DrumKitOptions {
  /** 额外敲一个「节拍器」的点（每拍都有）。 */
  metronome: boolean;
  /** 播放鼓组 / 贝斯（有真实音轨时关掉）。 */
  groove: boolean;
  /** 音轨整体音量（0–1）。 */
  level: number;
}

export interface DrumKit {
  /** 可随时改的开关；每帧由时钟同步。 */
  options: DrumKitOptions;
  /** 把拍点排进 AudioContext 的时间轴。`toCtxTime` 把谱面时间换成 ctx 时间。 */
  schedule(ctx: AudioContext, destination: AudioNode, beats: Beat[], toCtxTime: (chartMs: number) => number): void;
  dispose(): void;
}

/** 四小节和弦根音（A2 / F2 / C3 / G2）：让节拍轨听起来像「歌」而不是「咔哒」。 */
const BASS_ROOTS = [110, 87.31, 130.81, 98];

/**
 * 一个极简鼓组：底鼓 / 军鼓 / 踩镲 / 贝斯，全部用振荡器与噪声现场合成。
 *
 * 不追求音色，只追求「时间上可信」：每个点的起音都直接落在拍点上。
 */
export function createDrumKit(options: DrumKitOptions): DrumKit {
  let noise: AudioBuffer | null = null;

  function noiseBuffer(ctx: AudioContext): AudioBuffer {
    if (noise) return noise;
    const length = Math.floor(ctx.sampleRate * 0.5);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    noise = buffer;
    return buffer;
  }

  function env(gain: GainNode, when: number, peak: number, attack: number, decay: number): void {
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), when + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + attack + decay);
  }

  function kick(ctx: AudioContext, destination: AudioNode, when: number): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, when);
    osc.frequency.exponentialRampToValueAtTime(44, when + 0.11);
    env(gain, when, 0.5, 0.004, 0.26);
    osc.connect(gain).connect(destination);
    osc.start(when);
    osc.stop(when + 0.34);
  }

  function snare(ctx: AudioContext, destination: AudioNode, when: number, gainLevel: number): void {
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer(ctx);
    source.playbackRate.value = 1.6;

    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1900;
    band.Q.value = 0.9;

    const gain = ctx.createGain();
    env(gain, when, gainLevel * 0.16, 0.002, 0.13);
    source.connect(band).connect(gain).connect(destination);
    source.start(when);
    source.stop(when + 0.2);
  }

  function hat(ctx: AudioContext, destination: AudioNode, when: number, gainLevel: number, open = false): void {
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer(ctx);
    source.playbackRate.value = 1.9;

    const high = ctx.createBiquadFilter();
    high.type = 'highpass';
    high.frequency.value = 7600;

    const gain = ctx.createGain();
    env(gain, when, gainLevel * 0.05, 0.001, open ? 0.12 : 0.03);
    source.connect(high).connect(gain).connect(destination);
    source.start(when);
    source.stop(when + (open ? 0.18 : 0.06));
  }

  function bass(ctx: AudioContext, destination: AudioNode, when: number, frequency: number, gainLevel: number): void {
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = frequency;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(680, when);
    filter.frequency.exponentialRampToValueAtTime(220, when + 0.2);
    env(gain, when, gainLevel * 0.12, 0.008, 0.24);
    osc.connect(filter).connect(gain).connect(destination);
    osc.start(when);
    osc.stop(when + 0.32);
  }

  function click(ctx: AudioContext, destination: AudioNode, when: number, accent: boolean): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = accent ? 2400 : 1600;
    env(gain, when, accent ? 0.09 : 0.05, 0.001, 0.03);
    osc.connect(gain).connect(destination);
    osc.start(when);
    osc.stop(when + 0.05);
  }

  return {
    options,

    schedule(ctx, destination, beats, toCtxTime): void {
      if (options.level <= 0.001) return;

      for (const beat of beats) {
        const when = toCtxTime(beat.time);
        if (!Number.isFinite(when)) continue;
        // 已经过去的事件不再排：否则会在当前时刻炸出一堆叠音。
        if (when < ctx.currentTime - 0.001) continue;

        const inBar = ((beat.index % beat.beatsPerBar) + beat.beatsPerBar) % beat.beatsPerBar;
        const barIndex = Math.floor(beat.index / beat.beatsPerBar);

        if (options.groove) {
          // 拍号感知：强拍在第 1 拍，>=3 拍时中点补一记底鼓；
          // 4 拍以上才用 2 / 4 拍的小鼓（3/4、5/4 不会被塞满）。
          const middle = Math.floor(beat.beatsPerBar / 2);
          if (inBar === 0) kick(ctx, destination, when);
          if (beat.beatsPerBar >= 3 && inBar === middle) kick(ctx, destination, when);
          if (beat.beatsPerBar >= 4 && (inBar === 1 || inBar === 3)) snare(ctx, destination, when, options.level);

          // 八分音符的踩镲：两拍中间补一个，节奏才有推进。
          const eighth = 30000 / Math.max(1, beat.bpm);
          hat(ctx, destination, when, options.level, inBar === 0);
          hat(ctx, destination, when + eighth, options.level * 0.7);

          if (inBar === 0) {
            const root = BASS_ROOTS[((barIndex % 4) + 4) % 4]!;
            bass(ctx, destination, when, root, options.level);
            if (beat.beatsPerBar >= 4) bass(ctx, destination, when + eighth * 3, root * 1.5, options.level * 0.7);
          }
        }

        if (options.metronome) click(ctx, destination, when, beat.bar);
      }
    },

    dispose(): void {
      noise = null;
    },
  };
}
