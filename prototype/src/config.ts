/**
 * Step 1 的全部可调参数。
 *
 * 这里是唯一的事实来源：几何、材质、调试面板都从这里读。
 * 数值是提案默认值（agent.md §5 / §10），VR 里对着调，调完回写到 DEFAULT_PARAMS。
 */

export type WindowOffset = -1 | 0 | 1;

export interface TableParams {
  /** 台面高度（米，相对 local-floor 的地面）。 */
  tableHeight: number;
  /** 相邻轨中心距（米）。6 轨总宽 = lanePitch * 6 + 边缘余量。 */
  lanePitch: number;
  /** 槽宽（米）。 */
  slotWidth: number;
  /** 槽深（米）。这是「能看出深度」的唯一来源，别调得太浅。 */
  slotDepth: number;
  /** 轨间凸起导轨的高度（米），0 = 不要导轨。 */
  railHeight: number;
  /** 台面进深（米）。 */
  tableDepth: number;
  /** 台面近端到玩家原点的距离（米）。 */
  nearOffset: number;
  /** 4 轨窗口偏移：-1 → 0–3，0 → 1–4，+1 → 2–5。 */
  windowOffset: WindowOffset;
  /** 调试：揭掉 0 / 5 的遮罩，检查物理场确实是 6 槽。 */
  revealHidden: boolean;
  /** 调试：近端显示轨号。 */
  showLaneNumbers: boolean;
  /** 调试：显示槽底判定带。 */
  showBand: boolean;
}

export const DEFAULT_PARAMS: TableParams = {
  tableHeight: 0.95,
  lanePitch: 0.21,
  slotWidth: 0.18,
  // 槽深取最小：深度靠侧壁与视差读，不靠挖得深。
  slotDepth: 0.006,
  railHeight: 0.004,
  // 进深拉长：note 有足够的行程，台面不再是一块平板。
  tableDepth: 2.5,
  nearOffset: 0.34,
  windowOffset: 0,
  revealHidden: false,
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
  /** 每轨中心 x。 */
  laneX: number[];
  /** 槽长。 */
  slotLength: number;
  /** 槽中心 z。 */
  slotCenterZ: number;
  /** 判定带中心 z。 */
  bandZ: number;
  /** 判定带在 z 方向的厚度。 */
  bandLength: number;
  /** 当前窗口内的轨号（1–4 个，最多 4）。 */
  visibleLanes: number[];
}

/** 台面四周的余量：只留够倒角和板缝，不做「画框」。 */
const EDGE_MARGIN = 0.02;
/** 槽在近端 / 远端各留出的实心长度。 */
const NEAR_SLOT_MARGIN = 0.05;
const FAR_SLOT_MARGIN = 0.06;

export function deriveGeometry(p: TableParams): TableGeometry {
  const width = p.lanePitch * 6 + EDGE_MARGIN * 2;
  const nearZ = p.nearOffset;
  const farZ = nearZ - p.tableDepth;

  const laneX = Array.from({ length: 6 }, (_, i) => (i - 2.5) * p.lanePitch);

  const slotLength = p.tableDepth - NEAR_SLOT_MARGIN - FAR_SLOT_MARGIN;
  const slotCenterZ = nearZ - NEAR_SLOT_MARGIN - slotLength / 2;

  // 判定带放在玩家手最容易够到的位置：近端槽口前方一点。
  const bandZ = nearZ - NEAR_SLOT_MARGIN - 0.5;
  const bandLength = 0.1;

  const first = 1 + p.windowOffset;
  const visibleLanes = [first, first + 1, first + 2, first + 3].filter((lane) => lane >= 0 && lane <= 5);

  return {
    width,
    depth: p.tableDepth,
    nearZ,
    farZ,
    laneX,
    slotLength,
    slotCenterZ,
    bandZ,
    bandLength,
    visibleLanes,
  };
}
