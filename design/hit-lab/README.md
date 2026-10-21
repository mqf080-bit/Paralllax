# HIT LAB — hit 造型 / 碎裂设计样张

> **设计样张，不接游戏状态。** 按 [`DESIGN-WORKFLOW.md`](../../DESIGN-WORKFLOW.md) 第 1 条：
> 先在一个干净环境里决定“应该长什么样”，再回主代码移植；这里不是第二套产品。

## 为什么单独做

用户反馈（2026-10-21）：

- 当前 hit 上下形状不对称，但 hit 可以出现在空中；
- 不要用一圈 2D 冲击环，这是 3D 游戏，直接做碎裂；
- 先把造型 / 碎裂在简单 three.js 环境里看，再放回游戏。

这个样张只回答这三件事，不接判定、音频、WebXR、谱面。

## 三个方向

| ID | 结构 | 结论 |
| --- | --- | --- |
| A / SANDWICH | 上下两片釉面 + 金属芯 + 光缝 | 上下对称，但容易读成两颗叠起来的键；不采用 |
| **B / SEAM** | **整块厚釉面 + 中腰暗槽 + 手别色光缝** | **采用**；一个体块、上下同形、左右手可读 |
| C / BLOCK | 整块厚釉面，无附加结构 | 造型太像肥皂，远端与低角度缺少手别色；不采用 |

最终移植尺寸：`0.238 × 0.11 × 0.104m`。主代码见
[`prototype/src/game/hitVisual.ts`](../../prototype/src/game/hitVisual.ts)。

## 碎裂

- 没有冲击环、没有贴地贴片；
- hit 消失后直接生成有厚度、可旋转、受重力的陶瓷碎片；
- 碎片是扁长方体，不是小四面体——四面体在远处会读成白色纸屑；
- 设计样张里用 `?shatter=1` 冻结在碎裂展开的瞬间，方便截图；
- 主代码对应 [`prototype/src/game/shatter.ts`](../../prototype/src/game/shatter.ts)。

## 怎么看

从仓库根目录启动一个静态服务器（不要用 `file://`，ES module / import map 会被 CORS 拦住）：

```bash
python3 -m http.server 5200
# http://127.0.0.1:5200/design/hit-lab/
```

可用 URL 参数：

- `?shape=sandwich|seam|block|all`
- `?hand=left|right|none`
- `?air=1`：把 hit 抬到空中，检查上下对称
- `?shatter=1`：冻结碎裂瞬间

页面里也可以直接点按钮；空格触发碎裂，拖拽旋转，滚轮缩放。

## 截图

- [`docs/ui-vr2/hit-lab-all.png`](../../docs/ui-vr2/hit-lab-all.png) — 三方向并排
- [`docs/ui-vr2/hit-lab-b.png`](../../docs/ui-vr2/hit-lab-b.png) — 选中的 B
- [`docs/ui-vr2/hit-lab-b-air.png`](../../docs/ui-vr2/hit-lab-b-air.png) — 空中 / 右手
- [`docs/ui-vr2/hit-lab-b-shatter.png`](../../docs/ui-vr2/hit-lab-b-shatter.png) — 碎裂

## 边界

- 相机 / 光照只用于比较造型，不代表 Quest 3 的实际画面；
- 不动画时不代表最终节奏；最终仍以游戏内截图和头显验收为准；
- 样张里的参数是设计值，移植时按主代码的材质库、视距淡出与性能约束重写。
