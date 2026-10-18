import type { Easing } from './schema';

/**
 * 谱面缓动曲线。
 *
 * 运行时（速度积分 / arc 管）与制谱器（预览曲线）共用同一份实现，
 * 否则「编辑器里画的」和「游戏里跑的」会差一点点 —— arc 点编辑时尤其明显。
 */
export function easeValue(easing: Easing, u: number): number {
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

/** 编辑器里的缓动名。 */
export const EASING_LABELS: Record<Easing, string> = {
  linear: '直线',
  sine: '缓入',
  cosine: '缓出',
  bezier: '缓入缓出',
};

export const EASING_OPTIONS: Easing[] = ['linear', 'sine', 'cosine', 'bezier'];
