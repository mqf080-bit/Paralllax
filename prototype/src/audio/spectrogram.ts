/**
 * 音频频谱数据：STFT + 对数频带。
 *
 * 这是给制谱器「看鼓点 / 钢琴 / lead」用的，不追求出版级精度：
 * - FFT 4096，Hann 窗，hop ≈ 20ms（约 78% overlap，DAW 式连续纹理）；
 * - 时间轴最多 16384 帧（153s → 每帧 ~10ms）；
 * - 频率轴 40Hz–16kHz，对数分成 1024 条；
 * - 每帧每带取最大值，转成 -100dB–-20dB 的 0–1。
 */

export interface Spectrogram {
  durationMs: number;
  /** 时间帧数。 */
  frames: number;
  /** 频带数（从低到高）。 */
  bins: number;
  minHz: number;
  maxHz: number;
  /** frames × bins，行优先：frame * bins + band，0–1。 */
  data: Float32Array;
}

export interface SpectrogramOptions {
  minHz?: number;
  maxHz?: number;
  bins?: number;
  fftSize?: number;
  maxFrames?: number;
  /** 计算进度 0–1，用于面板显示百分比。 */
  onProgress?: (progress: number) => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }

  for (let length = 2; length <= n; length <<= 1) {
    const angle = (-2 * Math.PI) / length;
    const wLengthRe = Math.cos(angle);
    const wLengthIm = Math.sin(angle);
    for (let start = 0; start < n; start += length) {
      let wRe = 1;
      let wIm = 0;
      const half = length >> 1;
      for (let k = 0; k < half; k += 1) {
        const a = start + k;
        const b = a + half;
        const uRe = re[a]!;
        const uIm = im[a]!;
        const vRe = re[b]! * wRe - im[b]! * wIm;
        const vIm = re[b]! * wIm + im[b]! * wRe;
        re[a] = uRe + vRe;
        im[a] = uIm + vIm;
        re[b] = uRe - vRe;
        im[b] = uIm - vIm;
        const nextRe = wRe * wLengthRe - wIm * wLengthIm;
        wIm = wRe * wLengthIm + wIm * wLengthRe;
        wRe = nextRe;
      }
    }
  }
}

export async function buildSpectrogram(file: File, options: SpectrogramOptions = {}): Promise<Spectrogram> {
  const data = await file.arrayBuffer();
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) throw new Error('WebAudio 不可用');
  const context = new Ctor();
  let buffer: AudioBuffer;
  try {
    buffer = await context.decodeAudioData(data);
  } finally {
    void context.close();
  }

  const durationMs = buffer.duration * 1000;
  const sampleRate = buffer.sampleRate;
  const fftSize = Math.min(
    options.fftSize ?? 4096,
    2 ** Math.floor(Math.log2(Math.max(512, buffer.length))),
  );
  const maxFrames = options.maxFrames ?? 16384;
  const frames = clamp(Math.ceil(durationMs / 10), 1024, maxFrames);
  const bins = options.bins ?? 1024;
  const minHz = options.minHz ?? 40;
  const maxHz = Math.min(options.maxHz ?? 16000, sampleRate / 2);
  const logRange = Math.log(maxHz / minHz);

  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const samples = buffer.getChannelData(channel);
    for (let i = 0; i < samples.length; i += 1) mono[i] = (mono[i] ?? 0) + samples[i]! / buffer.numberOfChannels;
  }

  const hann = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i += 1) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (fftSize - 1));

  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);
  const out = new Float32Array(frames * bins);
  const binHz = sampleRate / fftSize;
  const half = fftSize / 2;

  for (let frame = 0; frame < frames; frame += 1) {
    const timeMs = (frame / Math.max(1, frames - 1)) * durationMs;
    const center = Math.round((timeMs / 1000) * sampleRate);
    const start = center - half;
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < fftSize; i += 1) {
      const source = start + i;
      if (source >= 0 && source < mono.length) re[i] = mono[source]! * hann[i]!;
    }
    fft(re, im);

    for (let band = 0; band < bins; band += 1) {
      const lowHz = minHz * Math.exp((logRange * band) / bins);
      const highHz = minHz * Math.exp((logRange * (band + 1)) / bins);
      const lowBin = clamp(Math.floor(lowHz / binHz), 1, half - 1);
      const highBin = clamp(Math.ceil(highHz / binHz), lowBin + 1, half);
      let magnitude = 0;
      for (let bin = lowBin; bin < highBin; bin += 1) {
        magnitude = Math.max(magnitude, Math.hypot(re[bin]!, im[bin]!));
      }
      const db = 20 * Math.log10(magnitude / half + 1e-9);
      out[frame * bins + band] = clamp((db + 100) / 80, 0, 1);
    }

    // 让主线程有机会刷新「ANALYZING…」和进度。
    if (frame % 64 === 63) {
      options.onProgress?.((frame + 1) / frames);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  return { durationMs, frames, bins, minHz, maxHz, data: out };
}
