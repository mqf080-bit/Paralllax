/**
 * 判定等级。
 *
 * `parallax-idea.md` 2：drag / arc / hold **没有 good**——接上物量就是完美，
 * 接不上就是漏。good 只属于 hit（要求「一次明确的挥击」）。
 *
 * 所以这里的 `good` 先留着不给任何键型用；等 hit 做出来才会出现。
 */
export type Grade = 'perfect' | 'good' | 'miss';

export const GRADE_LABEL: Record<Grade, string> = {
  perfect: 'PERFECT',
  good: 'GOOD',
  miss: 'MISS',
};

/** 完美用黄铜——设计文档里唯一允许的暖色强调；好是冷白；漏是赤。 */
export const GRADE_COLOR: Record<Grade, number> = {
  perfect: 0xe8c07a,
  good: 0xcfe4f5,
  miss: 0xe0485f,
};

/** 判定提示弹在命中点上方多少米。 */
export const POPUP_HEIGHT = 0.16;
