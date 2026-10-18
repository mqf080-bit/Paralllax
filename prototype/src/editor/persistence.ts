import type { Chart } from '../chart/schema';
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

export async function readChartFile(file: File): Promise<Chart> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('不是合法的 JSON');
  }
  return normalizeChart(parsed);
}
