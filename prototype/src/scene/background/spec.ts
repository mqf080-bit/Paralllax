/**
 * 背景描述（BackgroundSpec）。
 *
 * 背景是**程序化**的：一套配色 + 一组几何参数，没有贴图。
 * 所以「一个背景」在磁盘上就是一个几百字节的 JSON，可以整个塞进 `.parallax` 包里。
 *
 * 这里定义运行时的完整描述，以及两个内置预设（light / dark）——
 * 它们是当前游戏的默认背景，也是包内没写 `background` 时的回退。
 *
 * 磁盘格式（`parallax.background`）与这里的对应关系见与包格式一起的文档，
 * 解析函数随后补上。
 */

/** 配色的键。烘焙进顶点色的就是这些值。 */
export const PALETTE_KEYS = [
  'skyZenith',
  'skyHigh',
  'skyMid',
  'skyNear',
  'skyBand',
  'skyUnder1',
  'skyUnder2',
  'skyDeep',
  'megaTop',
  'megaBottom',
  'megaRim',
  'terrain',
  'terrainHaze',
  'stage',
  'stageEdge',
  'note',
] as const;

export type PaletteKey = (typeof PALETTE_KEYS)[number];

/** 0xRRGGBB。顶点色用线性空间，转换在 build 里做。 */
export type BackgroundPalette = Record<PaletteKey, number>;

export interface DiamondParams {
  /** 到相机的距离（米），沿 −Z。 */
  dist: number;
  /** 下尖的仰角（度）。 */
  apexElevDeg: number;
  /** 半宽 / 半高。0.9 ≈ 顶角 84°。 */
  slope: number;
  /** 单侧三角形的高度（米）；整颗菱形高 2×。 */
  halfH: number;
  /** 等宽边线的宽度（米）。 */
  rim: number;
  /** 厚度（米），只有歪头才有视差。 */
  depth: number;
}

export interface TerrainParams {
  cell: number;
  step: number;
  floor: number;
  /** 横向格数半径。 */
  xExtent: number;
  /** 向前的最后一个格子。 */
  zEnd: number;
  /** 走廊内边界：`innerBase + innerSlope × (z − 0.9)`，越小越窄。 */
  innerBase: number;
  innerSlope: number;
  /** 台地抬升的高度与坡度：`floor + rise × (1 − e^(−k / riseScale))`。 */
  rise: number;
  riseScale: number;
}

export interface BackgroundGeometry {
  /** 天空球半径；必须容得下整颗菱形，也要求相机 far ≥ 它。 */
  domeRadius: number;
  diamond: DiamondParams;
  terrain: TerrainParams;
}

export interface BackgroundSpec {
  /** 预设 id；包内自定义的背景用 `custom`。 */
  id: string;
  /** 给 UI / 调试看的名字。 */
  label: string;
  palette: BackgroundPalette;
  geometry: BackgroundGeometry;
}

/** 两个内置预设共享同一套几何，只换配色。 */
const BASE_GEOMETRY: BackgroundGeometry = {
  domeRadius: 320,
  diamond: { dist: 45, apexElevDeg: -8.5, slope: 0.9, halfH: 50.4, rim: 0.3, depth: 3 },
  terrain: {
    cell: 1,
    step: 0.3,
    floor: 0.92,
    xExtent: 15,
    zEnd: 8,
    innerBase: 1.25,
    innerSlope: 0.6,
    rise: 1.15,
    riseScale: 1.6,
  },
};

export const BACKGROUND_PRESETS: Record<'light' | 'dark', BackgroundSpec> = {
  light: {
    id: 'light',
    label: 'LIGHT SKY',
    geometry: BASE_GEOMETRY,
    palette: {
      skyZenith: 0x6d8cb6,
      skyHigh: 0x8faac9,
      skyMid: 0xc3d6e6,
      skyNear: 0xe9f0f4,
      skyBand: 0xf4f6f6,
      skyUnder1: 0xcfd8de,
      skyUnder2: 0x5d6d80,
      skyDeep: 0x131d29,
      megaTop: 0x10151d,
      megaBottom: 0x0a0d13,
      megaRim: 0x3c4c62,
      terrain: 0x2c3646,
      terrainHaze: 0xaab8c8,
      stage: 0x39424f,
      stageEdge: 0x6b7787,
      note: 0xeef4ff,
    },
  },
  dark: {
    id: 'dark',
    label: 'DARK SKY',
    geometry: BASE_GEOMETRY,
    palette: {
      skyZenith: 0x071528,
      skyHigh: 0x0a2440,
      skyMid: 0x103659,
      skyNear: 0x1b4a74,
      skyBand: 0x2f6f9e,
      skyUnder1: 0x14344f,
      skyUnder2: 0x08131f,
      skyDeep: 0x04070c,
      megaTop: 0x24384f,
      megaBottom: 0x16233a,
      megaRim: 0x4d7ba8,
      terrain: 0x1e2f47,
      terrainHaze: 0x1b3a55,
      stage: 0x2b3440,
      stageEdge: 0x63718a,
      note: 0xe8f0ff,
    },
  },
};

/** 包内没写背景时用这个。 */
export const DEFAULT_BACKGROUND_ID: 'light' = 'light';

export function presetOf(id: string): BackgroundSpec | null {
  if (id === 'light' || id === 'dark') return BACKGROUND_PRESETS[id];
  return null;
}

/**
 * 包头部 `background` 字段的两种写法：
 *
 * - `"light"` / `"dark"` / `"builtin:dark"` → 用游戏自带的内置预设；
 * - 其它字符串 → 包内路径，指向一个 `parallax.background` JSON（见 `PACKAGE.md`）。
 *
 * 包没写 background 时用 `DEFAULT_BACKGROUND_ID`。
 */
export type BackgroundRef =
  | { kind: 'builtin'; id: 'light' | 'dark' }
  | { kind: 'file'; path: string };

export function resolveBackgroundRef(raw: string | null | undefined): BackgroundRef {
  if (raw === null || raw === undefined || raw === '') {
    return { kind: 'builtin', id: DEFAULT_BACKGROUND_ID };
  }
  const value = raw.trim();
  const builtinId = value.startsWith('builtin:') ? value.slice('builtin:'.length) : value;
  if (builtinId === 'light' || builtinId === 'dark') {
    return { kind: 'builtin', id: builtinId };
  }
  return { kind: 'file', path: value };
}
