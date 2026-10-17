/**
 * 手别配色：青 = 左手，赤 = 右手（`parallax-idea.md` 4.2）。
 *
 * 颜色不是装饰，是「这只手必须用对」的标记。所以两套色相要满足三个条件：
 * 1. 色相差距足够远（青 ↔ 赤，跨过中性的绿与黄）；
 * 2. 明度接近（任何一套都不会因为更亮而被误读成「更重要」）；
 * 3. 自带一点自发光——台面是暗的，纯靠灯打的饱和色会偏色，
 *    玩家在暗光 / 色觉差异下就只剩「一块深色方块」。
 *
 * 同一个色相有两种载体，取值不同：
 * - `glaze`：釉（陶瓷 hit）。台面的灯很亮，釉色必须压暗，否则会被打到发白；
 * - `glass`：玻璃（arc 管壁）。透明混合会把颜色洗淡一半，所以要更亮更饱和。
 *
 * 除了釉 / 玻璃，这里还给 `core` 与 `glow`：
 * arc 的管芯和泛光必须跟管壁同一个色相，否则玻璃一透，颜色就散了。
 */

export interface HandColor {
  /** 陶瓷釉面的基色（压暗，给强光留余量）。 */
  readonly glaze: number;
  /** 玻璃管壁的基色（提亮，抵消透明混合的稀释）。 */
  readonly glass: number;
  /** 自发光：在暗台面上保住色相。 */
  readonly emissive: number;
  /** 自发光强度（陶瓷用）。 */
  readonly emissiveIntensity: number;
  /** 玻璃管内的光带。 */
  readonly core: number;
  /** 泛光壳的颜色。 */
  readonly glow: number;
}

/** 左手：青。 */
export const HAND_LEFT: HandColor = {
  glaze: 0x0f6c7d,
  glass: 0x2ab6cc,
  emissive: 0x06303b,
  emissiveIntensity: 0.5,
  core: 0x8ff0ff,
  glow: 0x3fd8e8,
};

/** 右手：赤。 */
export const HAND_RIGHT: HandColor = {
  glaze: 0x8f1124,
  glass: 0xd8334c,
  emissive: 0x380510,
  emissiveIntensity: 0.5,
  core: 0xff8fa3,
  glow: 0xff3b57,
};

/**
 * 无釉 hit / 中性元素。
 *
 * 中性不等于「和背景同色」：它要够亮，才能在暗台面上立住；
 * 但明度里不能带任何色相倾向，否则会被当成立场（「偏青 = 左手？」）。
 */
export const NEUTRAL_GLAZE = {
  glaze: 0x7d838b,
  emissive: 0x14161a,
  emissiveIntensity: 0.32,
} as const;
