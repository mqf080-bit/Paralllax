import type { Grade } from './judgement';

/**
 * 计分 / 血量。
 *
 * 设计文档 §2「计分」：**没有连击分**，总分按物量等比分配，漏一个就损失它那一份。
 * - 总分 10,000,000；
 * - 每个物量一份；PERFECT 拿满、GOOD 拿 60%、MISS 拿 0；
 * - 连击只作反馈，不参与计分。
 *
 * 血量是为了能给「失败」一个明确的状态：PERFECT / GOOD 小幅回血，MISS 掉血，
 * 归零即失败。
 */

export const MAX_SCORE = 10_000_000;
export const MAX_HEALTH = 100;

const GOOD_WEIGHT = 0.6;
const HEALTH_PERFECT = 0.5;
const HEALTH_GOOD = 0.25;
const HEALTH_MISS = -6;

export interface ScoreView {
  score: number;
  maxScore: number;
  combo: number;
  maxCombo: number;
  perfect: number;
  good: number;
  /** GOOD 中判定偏早 / 偏晚的数量（只看 hit 的 offset）。 */
  goodEarly: number;
  goodLate: number;
  miss: number;
  health: number;
  judged: number;
  total: number;
  failed: boolean;
}

export interface ScoreState extends ScoreView {
  judge(grade: Grade, offsetMs?: number): void;
  reset(): void;
}

export function createScore(total: number): ScoreState {
  const state: ScoreState = {
    score: 0,
    maxScore: MAX_SCORE,
    combo: 0,
    maxCombo: 0,
    perfect: 0,
    good: 0,
    goodEarly: 0,
    goodLate: 0,
    miss: 0,
    health: MAX_HEALTH,
    judged: 0,
    total: Math.max(1, total),
    failed: false,
    judge(grade: Grade, offsetMs = 0): void {
      state.judged += 1;

      if (grade === 'perfect') {
        state.perfect += 1;
        state.combo += 1;
        state.maxCombo = Math.max(state.maxCombo, state.combo);
        state.health = Math.min(MAX_HEALTH, state.health + HEALTH_PERFECT);
      } else if (grade === 'good') {
        state.good += 1;
        if (offsetMs < 0) state.goodEarly += 1;
        else if (offsetMs > 0) state.goodLate += 1;
        state.combo += 1;
        state.maxCombo = Math.max(state.maxCombo, state.combo);
        state.health = Math.min(MAX_HEALTH, state.health + HEALTH_GOOD);
      } else {
        state.miss += 1;
        state.combo = 0;
        state.health = Math.max(0, state.health + HEALTH_MISS);
        if (state.health <= 0) state.failed = true;
      }

      const weighted = state.perfect + state.good * GOOD_WEIGHT;
      state.score = Math.round((weighted / state.total) * MAX_SCORE);
    },
    reset(): void {
      state.score = 0;
      state.combo = 0;
      state.maxCombo = 0;
      state.perfect = 0;
      state.good = 0;
      state.goodEarly = 0;
      state.goodLate = 0;
      state.miss = 0;
      state.health = MAX_HEALTH;
      state.judged = 0;
      state.failed = false;
    },
  };
  return state;
}
