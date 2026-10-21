import type { TimingPoint } from '../chart/schema';
import { collectBeats, createDrumKit, type DrumKit } from './track';

/**
 * 音频时钟：谱面时间的唯一权威来源。
 *
 * 之前是「假时钟」——每帧把 dt 累加到 `clockMs` 上。问题是它与声音无关：
 * 帧率一抖，note 就晚到；而且没有音轨，也就没有「对拍」这回事。
 *
 * 现在的模型：
 * - **主时钟 = AudioContext.currentTime**（浏览器不给自动播放时退回
 *   performance.now，游戏本身仍然能跑，只是没声音）。
 * - `now()` 返回「**正在被听到的**谱面时间」：把输出延迟算进去，
 *   所以 0ms 判定 = 玩家耳朵里的拍点。
 * - 音频排程用同一个 `now()` 反算：`ctx.currentTime + (t - now()) / 1000`。
 *
 * 谱面时间可以是负数：起播前留一段 lead-in，note 从远处滑进来。
 *
 * `settings.offsetMs` 是玩家校准量：**正值 = 谱面时间提前**（note 更早到）。
 * 谱面 / 包里的 `meta.offset` 落到 `chartOffsetMs`，与玩家校准分开，游戏 UI 不显示。
 */

export type TransportState = 'idle' | 'playing' | 'paused';

export interface AudioSettings {
  /** 玩家校准偏移（毫秒）。正 = 谱面时间提前。 */
  offsetMs: number;
  /**
   * 谱面 / 包自带的音频偏移（毫秒），只由 chart.meta.offset 写入。
   * 它是作者属性，不显示在游戏设置里；玩家校准用 offsetMs。
   */
  chartOffsetMs?: number;
  /** 总音量 0–1。 */
  volume: number;
  /** 有真实音轨时是否额外叠一层节拍器。 */
  metronome: boolean;
  /** 没有音轨时是否播放合成鼓组。默认 true（游戏）；编辑器默认关。 */
  groove?: boolean;
  /** 起播前的留白（毫秒）。 */
  leadInMs: number;
}

export interface AudioClock {
  settings: AudioSettings;
  readonly state: TransportState;
  /** 音频链路是否真的在出声。 */
  readonly live: boolean;
  /** 估算的输出延迟（毫秒）。 */
  readonly latencyMs: number;
  /** 当前音轨名。没有音轨时是合成鼓组 `DRUMS`。 */
  readonly trackName: string;
  /** 最近一次载入 / 播放错误。 */
  readonly error: string | null;
  /** 正在被听到的谱面时间（毫秒）。 */
  now(): number;
  /** 从某个谱面时间开始播放。 */
  play(fromMs?: number): void;
  pause(): void;
  resume(): void;
  stop(): void;
  /** 每帧调用：把未来一小段拍点排进音频时间轴。 */
  update(): void;
  /** 需要用户手势：解锁 / 恢复 AudioContext。 */
  unlock(): void;
  /** 载入真实音轨（从谱面时间 0 开始对齐）。`name` 只用于显示。 */
  loadTrack(url: string, name?: string): Promise<boolean>;
  /** 预加载打击音；解码要等 AudioContext 解锁。 */
  preloadHit(url: string): void;
  /** 击打音效；perfect 稍亮，good 更闷更轻。 */
  playHit(perfect: boolean): void;
  /** 卸掉音轨，退回合成鼓组。 */
  clearTrack(): void;
  /** 设置 timing（决定节拍网格）。 */
  setTiming(timing: TimingPoint[]): void;
  dispose(): void;
}

/** 排程提前量：每帧往前排 300ms，主线程抖动不会变成漏拍。 */
const LOOKAHEAD_MS = 300;
/** 起播时给音频线程一点余量（秒）。 */
const START_DELAY = 0.03;
/** 输出延迟的合理上限（秒）——有些实现会报夸张的值。 */
const MAX_LATENCY = 0.2;

function clampLatency(value: number | undefined | null): number {
  if (value === undefined || value === null || !Number.isFinite(value)) return 0;
  return Math.min(MAX_LATENCY, Math.max(0, value));
}

export function createAudioClock(settings: AudioSettings): AudioClock {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let drum: DrumKit | null = null;
  let timing: TimingPoint[] = [];

  let state: TransportState = 'idle';
  /**
   * 锚点：`anchorChartMs`（不含 offset 的谱面时间）对应
   * `anchorAudioS`（音频时钟，含输出延迟）与 `anchorPerfS`（performance）。
   * 两个锚点在同一瞬间打上，所以时间源切换 / 音频被系统挂起时都不会跳变。
   */
  let anchorChartMs = 0;
  let anchorAudioS = 0;
  let anchorPerfS = 0;
  let anchorUsesAudio = false;
  let pausedAtMs = 0;
  /** 已经排到哪个谱面时间。 */
  let scheduledToMs = 0;

  let trackBuffer: AudioBuffer | null = null;
  let trackSource: AudioBufferSourceNode | null = null;
  let trackName = 'DRUMS';
  let error: string | null = null;
  let hitBytes: ArrayBuffer | null = null;
  let hitBuffer: AudioBuffer | null = null;
  let hitDecoding = false;

  function latencyS(): number {
    if (!ctx) return 0;
    const base = clampLatency(ctx.baseLatency);
    const output = clampLatency((ctx as AudioContext & { outputLatency?: number }).outputLatency);
    return Math.max(base, output);
  }

  function isLive(): boolean {
    return ctx !== null && ctx.state === 'running';
  }

  /** 「正在被听到」的时间源（秒）：音频走 ctx，否则走 performance。 */
  function heardNow(): number {
    if (isLive()) return ctx!.currentTime + latencyS();
    return performance.now() / 1000;
  }

  function perfNowS(): number {
    return performance.now() / 1000;
  }

  /** 在「现在」重新打锚点，谱面时间保持连续。 */
  function stampAnchor(chartMs: number, delayS = 0): void {
    anchorChartMs = chartMs;
    anchorUsesAudio = isLive();
    anchorAudioS = heardNow() + delayS;
    anchorPerfS = perfNowS() + delayS;
    scheduledToMs = chartMs;
  }

  /**
   * 不含校准偏移的谱面时间。
   * 音频在跑就用音频时钟（不随主线程 / 显示器漂移）；否则用 performance。
   */
  function rawNow(): number {
    if (state === 'paused') return pausedAtMs;
    if (state === 'idle') return anchorChartMs;
    if (anchorUsesAudio && isLive()) return anchorChartMs + (heardNow() - anchorAudioS) * 1000;
    return anchorChartMs + (perfNowS() - anchorPerfS) * 1000;
  }

  /** 时间源变了（音频解锁 / 被系统挂起）就重锚一次。 */
  function syncSource(): void {
    if (state !== 'playing') return;
    if (isLive() === anchorUsesAudio) return;
    const at = rawNow();
    stampAnchor(at);
    if (isLive() && trackBuffer) startTrack(at);
  }

  function totalOffsetMs(): number {
    return settings.offsetMs + (settings.chartOffsetMs ?? 0);
  }

  function nowMs(): number {
    return rawNow() + totalOffsetMs();
  }

  function decodeHit(): void {
    if (!ctx || !hitBytes || hitBuffer || hitDecoding) return;
    hitDecoding = true;
    void ctx
      .decodeAudioData(hitBytes.slice(0))
      .then((buffer) => {
        hitBuffer = buffer;
      })
      .catch((cause) => {
        console.warn('[audio] hit sample decode failed', cause);
      })
      .finally(() => {
        hitDecoding = false;
      });
  }

  function triggerHit(perfect: boolean): void {
    if (!ctx || !master) return;
    decodeHit();
    if (!hitBuffer) return;
    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = hitBuffer;
    source.playbackRate.value = perfect ? 1 : 0.94;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = perfect ? 5200 : 3800;
    const gain = ctx.createGain();
    const peak = perfect ? 0.17 : 0.11;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.075);
    source.connect(filter).connect(gain).connect(master);
    source.start(now);
    source.stop(now + 0.09);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  }

  function buildChain(): void {
    if (!ctx) return;
    master = ctx.createGain();
    master.gain.value = settings.volume;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 12;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.14;
    master.connect(limiter).connect(ctx.destination);
    drum = createDrumKit({ metronome: false, groove: settings.groove ?? true, level: 1 });
  }

  /**
   * 从音轨内容的某个位置开始播放。
   *
   * `contentMs` 是不含 offset 的 raw 谱面时间：offset 只负责把音频内容
   * 相对谱面平移，不应该让 playhead 跳时间。`delayS` 给起播 / resume
   * 留一点音频线程余量；负 content 表示先静音，等 raw 时间走到 0 再出声。
   */
  function startTrack(contentMs: number, delayS = 0): void {
    if (!ctx || !master || !trackBuffer) return;
    stopTrack();
    const content = Math.max(0, contentMs);
    if (content / 1000 >= trackBuffer.duration) return;
    const waitS = Math.max(0, -contentMs) / 1000 + Math.max(0, delayS);

    const source = ctx.createBufferSource();
    source.buffer = trackBuffer;
    source.connect(master);
    source.start(ctx.currentTime + waitS, content / 1000);
    trackSource = source;
  }

  function stopTrack(): void {
    if (!trackSource) return;
    try {
      trackSource.stop();
    } catch {
      // 已经停过就忽略。
    }
    trackSource.disconnect();
    trackSource = null;
  }

  function ensureContext(): boolean {
    if (ctx) return true;
    const Ctor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) {
      error = 'WebAudio 不可用';
      return false;
    }
    try {
      ctx = new Ctor({ latencyHint: 'interactive' });
    } catch {
      error = 'AudioContext 创建失败';
      return false;
    }
    buildChain();
    decodeHit();
    return true;
  }

  /** 谱面时间 → AudioContext 时间。 */
  function toCtxTime(chartMs: number): number {
    if (!ctx) return 0;
    return ctx.currentTime + (chartMs - nowMs()) / 1000;
  }

  return {
    settings,

    get state(): TransportState {
      return state;
    },

    get live(): boolean {
      return isLive();
    },

    get latencyMs(): number {
      return latencyS() * 1000;
    },

    get trackName(): string {
      return trackName;
    },

    get error(): string | null {
      return error;
    },

    now: nowMs,

    play(fromMs = 0): void {
      ensureContext();
      if (ctx && ctx.state === 'suspended') void ctx.resume();
      // raw = fromMs - (玩家 offset + 谱面 offset)；这样 now() 在起播瞬间正好等于 fromMs。
      const raw = fromMs - totalOffsetMs();
      const delay = isLive() ? START_DELAY : 0;
      state = 'playing';
      stampAnchor(raw, delay);
      pausedAtMs = raw;
      if (trackBuffer && isLive()) startTrack(raw, delay);
    },

    pause(): void {
      if (state !== 'playing') return;
      pausedAtMs = rawNow();
      state = 'paused';
      stopTrack();
      if (ctx && ctx.state === 'running') void ctx.suspend();
    },

    resume(): void {
      if (state !== 'paused') return;
      if (ctx && ctx.state === 'suspended') void ctx.resume();
      state = 'playing';
      const delay = isLive() ? START_DELAY : 0;
      stampAnchor(pausedAtMs, delay);
      // 暂停前已经排进音频图的那一小段（最多 LOOKAHEAD）会继续播，别重复排。
      scheduledToMs = pausedAtMs + LOOKAHEAD_MS;
      if (trackBuffer && isLive()) startTrack(pausedAtMs, delay);
    },

    stop(): void {
      state = 'idle';
      anchorChartMs = 0;
      pausedAtMs = 0;
      scheduledToMs = 0;
      stopTrack();
      if (ctx && ctx.state === 'running') void ctx.suspend();
    },

    update(): void {
      if (master && master.gain.value !== settings.volume) master.gain.value = settings.volume;
      if (state !== 'playing') return;
      if (!ctx || !master || !drum) return;
      syncSource();
      if (!isLive()) return;

      drum.options.metronome = settings.metronome;
      drum.options.groove = (settings.groove ?? true) && trackBuffer === null;
      drum.options.level = 1;

      const target = nowMs() + LOOKAHEAD_MS;
      if (target <= scheduledToMs) return;
      const from = Math.max(scheduledToMs, nowMs() - 4);
      if (from < target) {
        const beats = collectBeats(timing, from, target);
        drum.schedule(ctx, master, beats, toCtxTime);
      }
      scheduledToMs = target;
    },

    unlock(): void {
      if (!ensureContext()) return;
      if (!ctx) return;
      if (ctx.state === 'suspended') void ctx.resume();
      // 真正的时间源切换在 update() 的 syncSource 里做（resume 是异步的）。
    },

    preloadHit(url: string): void {
      if (hitBytes || hitBuffer) return;
      void fetch(url)
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.arrayBuffer();
        })
        .then((bytes) => {
          hitBytes = bytes;
          decodeHit();
        })
        .catch((cause) => {
          console.warn('[audio] hit sample unavailable', cause);
        });
    },

    playHit(perfect: boolean): void {
      triggerHit(perfect);
    },

    async loadTrack(url: string, name?: string): Promise<boolean> {
      ensureContext();
      if (!ctx) return false;
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.arrayBuffer();
        trackBuffer = await ctx.decodeAudioData(data);
        trackName = name ?? url.split('/').pop()?.split('?')[0] ?? url;
        if (state === 'playing' && isLive()) startTrack(rawNow());
        error = null;
        return true;
      } catch (cause) {
        error = cause instanceof Error ? cause.message : '音轨载入失败';
        return false;
      }
    },

    clearTrack(): void {
      stopTrack();
      trackBuffer = null;
      trackName = 'DRUMS';
      error = null;
    },

    setTiming(next: TimingPoint[]): void {
      timing = next;
    },

    dispose(): void {
      stopTrack();
      drum?.dispose();
      drum = null;
      trackBuffer = null;
      if (ctx) {
        void ctx.close();
        ctx = null;
      }
      master = null;
      state = 'idle';
    },
  };
}
