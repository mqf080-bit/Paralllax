import { BACKGROUND_PRESETS, DEFAULT_BACKGROUND_ID, resolveBackgroundRef } from './spec';
import type { BackgroundSpec } from './spec';

/**
 * 背景的选择链。
 *
 * 优先级（从高到低）：
 *   1. 调试参数 `?bg=light|dark`
 *   2. 包头部 `background`（`builtin:x` 或包内 `parallax.background` 路径）
 *   3. 玩家在设置里选的默认背景（localStorage）
 *   4. 游戏默认（`DEFAULT_BACKGROUND_ID`）
 *
 * 「包没写背景」和「包写了但读不出来」都退回下一级，不报错。
 */

export type BackgroundId = 'light' | 'dark';

const STORAGE_KEY = 'parallax.background';

export function isBackgroundId(value: unknown): value is BackgroundId {
  return value === 'light' || value === 'dark';
}

/** 玩家在设置里选的默认背景；没选过 = null。 */
export function loadUserBackground(): BackgroundId | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isBackgroundId(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function saveUserBackground(id: BackgroundId): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // 隐私模式 / 存储被禁用：不影响本次运行
  }
}

export function specOf(id: BackgroundId): BackgroundSpec {
  return BACKGROUND_PRESETS[id];
}

export interface SelectionInput {
  /** 调试参数 `?bg=`。 */
  query: string | null;
  /** 包头部 `background` 字段。 */
  packageBackground: string | null | undefined;
  /** 玩家设置里的选择。 */
  userChoice: BackgroundId | null;
}

export interface Selection {
  id: BackgroundId;
  /** 这个背景是哪来的，调试用。 */
  source: 'query' | 'package' | 'user' | 'default';
  /** 包引用了内置背景时，是哪个包参数（便于日志）。 */
  note?: string;
}

/**
 * 解析当前该用哪个背景。
 *
 * 包内自定义的 `parallax.background` 文件目前只解析到「引用」这一步，
 * 真正的文件解析（覆盖配色 / 几何）在加载器里做；这里只回答用哪个内置预设。
 */
export function resolveSelection(input: SelectionInput): Selection {
  if (isBackgroundId(input.query)) {
    return { id: input.query, source: 'query' };
  }

  const ref = resolveBackgroundRef(input.packageBackground);
  if (ref.kind === 'builtin') {
    // 包明确写了 builtin:light / builtin:dark 才算数；没写会走到下面的默认链。
    if (input.packageBackground) {
      return { id: ref.id, source: 'package' };
    }
  } else {
    // 包内文件：加载器负责读；这里退回玩家选择 / 默认。
    return {
      id: input.userChoice ?? DEFAULT_BACKGROUND_ID,
      source: input.userChoice ? 'user' : 'default',
      note: `package background file not applied yet: ${ref.path}`,
    };
  }

  if (input.userChoice) return { id: input.userChoice, source: 'user' };
  return { id: DEFAULT_BACKGROUND_ID, source: 'default' };
}
