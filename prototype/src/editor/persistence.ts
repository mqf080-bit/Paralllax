import type { Chart } from '../chart/schema';
import { BACKGROUND_PRESETS, DEFAULT_BACKGROUND_ID } from '../scene/background/spec';
import { PACKAGE_EXTENSION, PACKAGE_MIME, isParallaxPackage, packPackage } from '../pack/format';
import { audioFromPackage, chartJsonFromPackage, coverFromPackage, packageAssets, readPackageFile, type PackedAudio } from '../pack/io';
import { normalizeChart } from './model';

/**
 * 制谱器的存取：
 * - 草稿自动存 localStorage（刷新不丢）；
 * - 导入 / 导出 JSON —— 和 Step 4 播放器读的是同一种文件。
 */

const DRAFT_KEY = 'parallax.editor.draft.v1';

export interface Draft {
  chart: Chart;
  savedAt: number;
}

export function loadDraft(): Draft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { chart?: unknown; savedAt?: unknown };
    if (!parsed.chart) return null;
    return {
      chart: normalizeChart(parsed.chart),
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : Date.now(),
    };
  } catch (cause) {
    console.warn('[editor] 草稿读取失败', cause);
    return null;
  }
}

export function saveDraft(chart: Chart): number {
  const savedAt = Date.now();
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ chart, savedAt }));
  } catch (cause) {
    console.warn('[editor] 草稿保存失败', cause);
  }
  return savedAt;
}

export function clearDraft(): void {
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // 忽略
  }
}

/** 导出文件名：标题转 slug，去掉路径不安全字符。 */
export function chartFilename(chart: Chart): string {
  const slug =
    chart.meta.title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'untitled';
  return `${slug}.parallax.json`;
}

export function downloadChart(chart: Chart): void {
  const blob = new Blob([JSON.stringify(chart, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = chartFilename(chart);
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface PackageAsset {
  data: Uint8Array;
  type: string;
}

export interface CoverAsset {
  data: Uint8Array;
  type: string;
  name: string;
  url?: string;
}

export interface LoadedChartFile {
  chart: Chart;
  package: Awaited<ReturnType<typeof readPackageFile>> | null;
  audio: PackedAudio | null;
  cover: CoverAsset | null;
  assets: Map<string, PackageAsset>;
}

export async function readChartFile(file: File): Promise<LoadedChartFile> {
  const isPackage = file.name.toLowerCase().endsWith(`.${PACKAGE_EXTENSION}`) || isParallaxPackage(await file.slice(0, 12).arrayBuffer());
  if (isPackage) {
    const pkg = await readPackageFile(file);
    let parsed: unknown;
    try {
      parsed = chartJsonFromPackage(pkg);
    } catch (cause) {
      throw new Error(cause instanceof Error ? `包内谱面不是合法 JSON：${cause.message}` : '包内谱面不是合法 JSON');
    }
    return {
      chart: normalizeChart(parsed),
      package: pkg,
      audio: audioFromPackage(pkg),
      cover: coverFromPackage(pkg),
      assets: packageAssets(pkg),
    };
  }
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('不是合法的 JSON');
  }
  return { chart: normalizeChart(parsed), package: null, audio: null, cover: null, assets: new Map() };
}

function safeFilename(name: string): string {
  return (
    name
      .trim()
      .replace(/[^a-zA-Z0-9.\-\u4e00-\u9fa5]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'audio'
  );
}

/** 导出单个 `.parallax`：谱面 + 当前音轨 + 导入时保留的其它资源。 */
export async function downloadPackage(
  chart: Chart,
  audio: File | null,
  assets: Map<string, PackageAsset>,
  options: { theme?: string; background?: string; backgroundPreset?: 'light' | 'dark'; cover?: CoverAsset | null } = {},
): Promise<string> {
  const files: Array<{ path: string; data: Uint8Array; type?: string }> = [];
  files.push({
    path: 'chart.json',
    data: new TextEncoder().encode(JSON.stringify(chart, null, 2)),
    type: 'application/json',
  });

  let audioPath: string | null = null;
  if (audio) {
    const name = safeFilename(audio.name || 'audio');
    audioPath = `audio/${name}`;
    files.push({ path: audioPath, data: new Uint8Array(await audio.arrayBuffer()), type: audio.type || undefined });
  }
  let coverPath: string | null = null;
  if (options.cover) {
    const name = safeFilename(options.cover.name || 'cover.jpg');
    coverPath = `cover/${name}`;
    files.push({ path: coverPath, data: options.cover.data, type: options.cover.type || undefined });
  }
  for (const [path, asset] of assets) {
    if (path === 'chart.json' || path === audioPath || path === coverPath) continue;
    files.push({ path, data: asset.data, type: asset.type });
  }

  // 背景：包内自带一份描述（几百字节），保证换版本后同一个包还是原样。
  // 当前谱面没指定背景时，写默认预设 light。
  let backgroundPath = options.background ?? null;
  if (!backgroundPath) {
    backgroundPath = 'background/scene.json';
    const preset = options.backgroundPreset ?? DEFAULT_BACKGROUND_ID;
    const source = BACKGROUND_PRESETS[preset];
    // 展开成完整参数再写进包：运行时不需要族表，族以后怎么调都不影响这个包。
    const hex = (value: number): string => `#${value.toString(16).padStart(6, '0')}`;
    const payload = {
      format: 'parallax.background',
      version: 1,
      preset,
      palette: Object.fromEntries(
        Object.entries(source.palette).map(([key, value]) => [key, hex(value)]),
      ),
      geometry: source.geometry,
    };
    files.push({
      path: backgroundPath,
      data: new TextEncoder().encode(JSON.stringify(payload, null, 2)),
      type: 'application/json',
    });
  }

  const bytes = packPackage(files, {
    chart: 'chart.json',
    audio: audioPath,
    cover: coverPath,
    theme: options.theme,
    background: backgroundPath,
  });
  const payload = new Uint8Array(bytes.byteLength);
  payload.set(bytes);
  const url = URL.createObjectURL(new Blob([payload.buffer], { type: PACKAGE_MIME }));
  const anchor = document.createElement('a');
  const filename = packageFilename(chart);
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}

export function packageFilename(chart: Chart): string {
  return chartFilename(chart).replace(/\.parallax\.json$/, `.${PACKAGE_EXTENSION}`);
}
