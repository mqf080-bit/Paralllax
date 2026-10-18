import type { WaveformPeaks } from './timelineView';

/**
 * 从导入的音频里抽波形峰值。
 *
 * 时间轴只做对齐，不需要高保真：每个 bin 只留 min / max，
 * 画的时候按像素取包络就够了。整体归一化到 1，安静的曲子也能看见拍点。
 */
export async function decodeWaveform(file: File): Promise<WaveformPeaks> {
  const data = await file.arrayBuffer();
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) throw new Error('WebAudio 不可用');
  const ctx = new Ctor();
  let buffer: AudioBuffer;
  try {
    buffer = await ctx.decodeAudioData(data);
  } finally {
    void ctx.close();
  }

  const binMs = 2;
  const binSamples = Math.max(1, Math.round((binMs / 1000) * buffer.sampleRate));
  const bins = Math.max(1, Math.ceil(buffer.length / binSamples));
  const min = new Float32Array(bins);
  const max = new Float32Array(bins);
  let peak = 0;

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const samples = buffer.getChannelData(channel);
    for (let bin = 0; bin < bins; bin += 1) {
      const start = bin * binSamples;
      const end = Math.min(samples.length, start + binSamples);
      let low = 0;
      let high = 0;
      for (let index = start; index < end; index += 1) {
        const value = samples[index]!;
        if (value < low) low = value;
        if (value > high) high = value;
      }
      const previousMin = min[bin] ?? 0;
      const previousMax = max[bin] ?? 0;
      min[bin] = Math.min(previousMin, low);
      max[bin] = Math.max(previousMax, high);
      peak = Math.max(peak, Math.abs(low), Math.abs(high));
    }
  }

  if (peak > 1e-4) {
    for (let bin = 0; bin < bins; bin += 1) {
      min[bin] = (min[bin] ?? 0) / peak;
      max[bin] = (max[bin] ?? 0) / peak;
    }
  }

  return { binMs, min, max, durationMs: buffer.duration * 1000 };
}
