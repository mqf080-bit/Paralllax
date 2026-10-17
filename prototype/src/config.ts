/**
 * Step 1 的全部可调参数。
 *
 * 这一版台面被大幅简化：
 * - 只有 4 条轨，没有 6 轨物理场、没有隐藏轨、没有盲板
 * - 没有凹槽，只有 4 轨之间的细分割线
 * - 没有边框，台面宽度基本等于 4 轨
 *
 * `parallax-idea.md` 里的 6 轨 / 4 轨窗口仍然成立，但那是谱面层的规则；
 * 视觉上「平时只需要 4 轨」。等 Step 3 做 shift 时再决定窗口怎么表现。
 */

export interface TableParams {
  /** 台面高度（米，相对 local-floor 的地面）。 */
  tableHeight: number;
  /** 单轨宽度（米）。4 轨总宽 = laneWidth * 4。 */
  laneWidth: number;
  /** 台面进深（米）。 */
  tableDepth: number;
  /** 台面近端到玩家原点的距离（米）。 */
  nearOffset: number;
  /** 顶板厚度（米）。没有凹槽，这就是台面本身的厚度。 */
  plateThickness: number;
  /** 调试：近端显示轨号。 */
  showLaneNumbers: boolean;
  /** 调试：显示判定带。 */
  showBand: boolean;
}

/** 可见轨数。这一版固定 4 条。 */
export const LANE_COUNT = 4;

export const DEFAULT_PARAMS: TableParams = {
  tableHeight: 0.95,
  laneWidth: 0.23,
  tableDepth: 10,
  nearOffset: 0.34,
  plateThickness: 0.012,
  showLaneNumbers: false,
  showBand: true,
};

/** 一切尺寸的派生量集中在这里，避免各处各算一遍。 */
export interface TableGeometry {
  width: number;
  depth: number;
  /** 近端 z（靠近玩家，+z 方向）。 */
  nearZ: number;
  /** 远端 z。 */
  farZ: number;
  /** 每轨中心 x（4 条）。 */
  laneX: number[];
  /** 轨与轨之间的分割线 x（3 条）。 */
  dividerX: number[];
  laneWidth: number;
  /** 编排区（分割线 / 判定带）在 z 方向的长度。 */
  fieldLength: number;
  fieldCenterZ: number;
  /** 判定带中心 z 与厚度。 */
  bandZ: number;
  bandLength: number;
}

/** 台面左右几乎不留余量：边框不存在，轨的外沿就是台面外沿。 */
const EDGE_MARGIN = 0.004;
/** 近端留一点，放轨号与倒角。 */
const NEAR_MARGIN = 0.04;
/** 远端留一点，给淡出一个收口。 */
const FAR_MARGIN = 0.06;

export function deriveGeometry(p: TableParams): TableGeometry {
  const width = p.laneWidth * LANE_COUNT + EDGE_MARGIN * 2;
  const nearZ = p.nearOffset;
  const farZ = nearZ - p.tableDepth;

  const laneX = Array.from({ length: LANE_COUNT }, (_, i) => (i - (LANE_COUNT - 1) / 2) * p.laneWidth);
  const dividerX = Array.from({ length: LANE_COUNT - 1 }, (_, i) => (i + 1 - LANE_COUNT / 2) * p.laneWidth);

  const fieldLength = p.tableDepth - NEAR_MARGIN - FAR_MARGIN;
  const fieldCenterZ = nearZ - NEAR_MARGIN - fieldLength / 2;

  // 判定带放在玩家手最容易够到的位置。
  const bandZ = nearZ - 0.55;
  const bandLength = 0.07;

  return {
    width,
    depth: p.tableDepth,
    nearZ,
    farZ,
    laneX,
    dividerX,
    laneWidth: p.laneWidth,
    fieldLength,
    fieldCenterZ,
    bandZ,
    bandLength,
  };
}
