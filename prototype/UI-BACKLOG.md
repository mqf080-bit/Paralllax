# UI-BACKLOG — 游玩端 VR

> 更新：2026-10-22 ｜ 状态：**主流程 / 六屏 / 手感调参已实现；用户反馈“手感基本合格”；剩余项见 §4** ｜ 设备基准：Meta Quest 3
> 相关：[STATUS.md](STATUS.md) ｜ [main.ts](src/main.ts) ｜ [gameUi.ts](src/ui/gameUi.ts) ｜ [vrPanel.ts](src/ui/vrPanel.ts) ｜ [player.ts](src/game/player.ts) ｜ [设计工作流](../DESIGN-WORKFLOW.md)

---

## 0. 当前状态

- 进 VR 先到 **Home**，不自动播放；`START` 才进入谱面。
- 六屏：Home / Songs / Add packs / Pause / Settings / Result。
- 游玩中无面板；暂停用左手 menu，读不到时用 **左手 Y 长按 400ms** 兜底；桌面 `Esc`。
- 用户已认可当前双栏布局；“手感基本合格”。
- 设计语言：石墨底 + 浅蓝 `#9CC8FF` 主强调 + 稀有 lime `#C6F24E`；**全方角，无圆角**。
- 不是“辅助 / 极简”，而是**信息量大的技术控制台**。

```text
Home → Songs → Playing → Paused → Settings
                   ↓          ↓
                Result      Home
```

---

## 1. 约束

- Quest 3 / WebXR，控制器优先；桌面 fallback 必须保留（鼠标 = 手，左键 / 空格 = 扳机）。
- 72fps 底线；UI 不引入每帧重绘或额外 draw call 尖峰。
- 不改谱面格式；`?chart=` / `?pack=` / `?localPack=1` 等调试入口继续可用。
- 设计工作流：外观探索可放 `design/`，移植后主代码是唯一事实来源；目标设备验收才算闭环。
- 当前面板：`760×470` 逻辑画布，2× 纹理；物理 **1.55×0.959m**，距离 **1.35m**，中心高 **1.44m**。

---

## 2. 已实现（不用重开）

| 区域 | 现状 |
| --- | --- |
| 流程 | 不再自动开谱；Home / Songs / Pause / Settings / Result 状态机完整；切歌会重建 Player、音频、浮空显示 |
| 输入安全 | 游玩中 `GameUi` 不接收点击；hold 的扳机与 UI 点击分离；切面板有 `pressLock` |
| 六屏 | 双栏、可选歌曲列表、Add packs 二级页、Settings 六个真实控件、Result 判定条 + GOOD early/late |
| 面板 | 1.55m / 1.35m；`?panelScale`、`?panelDistance`、`?panelY` 可调；去圆角 / 去拟物 |
| 曲库 | 内置谱 + `packages/index.json` 懒加载；选中后才下载 `.parallax`；18MB 包有 loading 覆盖层 |
| 包 offset | `meta.offset` → 隐藏的 `chartOffsetMs`；玩家 Settings 的 Offset 独立，不被包覆盖 |
| arc 流速 | Settings 改流速会同步缩放已生成的 arc；editor 3D 共用参数 |
| 打击 | hit / drag 有音效；hit 为 click + 低频 body，drag 轻击；arc / hold tick 不叠 click；auto 静音 |
| hit 视觉 | 上下对称的 slim sandwich：`0.232×0.084×0.096m`；金属芯 + 手别色光缝；命中直接碎裂，无冲击环 |
| arc 反馈 | 身体过线且无手接住 → 立即降到 `0.42`；接住时弧头 / 手附近有手别色接触光；auto 保持正常亮度 |
| 手部 | XR 控制器加 `0.18m` 短棒；默认 / hit 全亮，hold / arc sustain 时 `0.28`；手部球 `0.02m`（桌面指针 `0.024m`） |
| 调试 | 调试 GUI 在 dev 和真正支持 immersive-vr 的浏览器显示；`?debug=0/1` 控制；`?chrome=0` 隐藏全部覆盖层 |

---

## 3. 当前关键参数

| 项目 | 值 |
| --- | --- |
| 台面 / 轨宽 | 高 `0.95m`，单轨 `0.27m` |
| 判定线 | 近端内 **`0.70m`**；`bandZ = −0.36m`；`?band=` 可覆盖 |
| hit 可视尺寸 | `0.232 × 0.084 × 0.096m` |
| hit 判定盒 | 默认宽 `0.26m`；近侧 `0.22m` / 远侧 `0.38m`；`?hitboxX` / `?hitboxZ` 调倍率 |
| hit 时间窗 | perfect **`-100 / +80ms`**；good **`-140 / +160ms`**；更晚为 miss |
| 引导网 | 竖直、只亮网格线；full 窗口 early `-100` / late `+80ms`；180ms 外不亮 |
| 计分 | 总分 `10,000,000`；PERFECT 100% / **GOOD 60%** / MISS 0；GOOD 血量 +0.25（PERFECT +0.5）；combo 不计分 |
| arc 暗度 | 未接住 `0.42`，接上 / 未过线 `1.0`；状态切换立即生效 |
| 短棒 | `0.18m`；sustain 透明度 `0.28`，关闭 depthWrite；判定点仍在控制器原点 |

`?debug=1` 可在生产页强制显示调试 GUI；注意 immersive VR 不会合成 DOM，lil-gui 只在 2D 页面 / 桌面镜像里可见。

---

## 4. 待办 / 未闭环

| ID | 优先级 | 问题 | 说明 |
| --- | --- | --- | --- |
| UI-03 | P1 | 没有完整的游玩前校准 | Settings 已可从 Home / Pause 打开；仍缺 offset 试听、试打、身高校准、左右手 / 站姿、设置持久化 |
| UI-12 | P1 | 曲目超过 4 首 | Songs 没有滚动 / 分页；当前索引 + 内置谱刚好够用 |
| UI-13 | P2 | 包索引手工维护 | 重新导出 `.parallax` 后要手动更新 `index.json` 的 duration / notes / bpm 等；选中后会以包内 chart 为准 |
| UI-14 | P2 | 本地包管理 | 没有移除 / 重命名；IndexedDB 按 origin 隔离，localhost 加的包不会出现在 pages.dev |
| UI-15 | P2 | 无物量谱面立即结束 | 还没有按 `meta.duration` 等待；等 Infinity Heaven 补完再处理 |
| UI-16 | P1 | Quest 3 主观验收 | 面板距离 / 字号、`buttons[6]` 是否真是 menu、hold 时是否还会误触、arc `0.42` 暗度 |
| UI-17 | P2 | 文档偏移语义过期 | `parallax-idea.md` 仍把 `meta.offset` 描述成玩家校准；当前已拆为 `chartOffsetMs` + `offsetMs` |
| FEEL-04 | P2 | 短棒与判定点 | 短棒只是视觉提示；如果玩家自然用棒尖打，需确认 0.18m 的偏移是否会造成手感偏差 |
| FEEL-05 | P2 | early 分布 | 当前 perfect `-100/+80`、good `-140/+160`；根据结算的 EARLY / LATE 再决定是否继续收 / 放 |
| FEEL-06 | P2 | 音色主观确认 | hit 双层音、drag 轻击仍需 Quest 3 上确认音量与“不尖” |

“待办”不代表都要做；UI-03 / UI-12 / UI-16 是下一步最有价值的。

---

## 5. 关键决策

- **面板“大”与“近”分开**：优先 1.35m 聚焦距离，不再靠放大解决可读性。
- **视觉方向**：A 技术控制台 + C 编辑网格的排版密度；浅蓝主强调，lime 只做稀有状态；黄铜 / 青 / 赤保持判定 / 左手 / 右手的语义。
- **判定的空间与时间分离**：hitbox X / Z 倍率只改手的空间容差；时间窗独立。默认手感不被调试倍率改变。
- **hit 可以悬空**：造型必须上下对称；最终采用压薄的 sandwich，而不是底座 + 键帽。
- **3D 反馈不用 2D 环**：hit 直接碎裂；arc 用明暗 + 接触光表达连接。
- **短棒只做视觉引导**：不移动手部采样点；是否用棒尖是后续试打问题。
- **GOOD 不是一半**：分数 / 准确率都是 60%；只有血量是 PERFECT 的一半。

---

## 6. 验收与证据

- `npm run typecheck` / `npm run build` 通过。
- 六屏截图：[`docs/ui-vr2`](../docs/ui-vr2)；hit / arc / debug 截图也在同一目录。
- 已做过的桌面验证：主页 → 游玩 → 暂停 → Settings → Back；Songs 切歌；懒加载 18MB 包；hitbox GUI；WebXR 页调试 GUI。
- 尚未闭环：Quest 3 内真实可读性、menu 键、hold 误触、短棒 / 棒尖手感、arc 暗度、Good 分布。

---

## 7. 历史节点（压缩）

- **2026-10-20**：P0 流程 / 输入安全；六屏双栏 UI；1.55m / 1.35m 面板；包索引 + 懒加载；arc 流速 / 包 offset 分离。
- **2026-10-21**：hit 音效、early/late、竖直引导网；hit 重新设计（独立 `design/hit-lab/`，最终 slim sandwich）与陶瓷碎裂；arc 连接反馈。
- **2026-10-22**：默认判定线 `0.80 → 0.70m`；hitbox X/Z 调试 + 手部球放大；WebXR 页面显示调试 GUI；手腕短棒；perfect / good early 窗口收窄；用户确认手感基本合格。

更细的过程记录已从 backlog 移除，保留在 git 历史与 [CHANGELOG.md](../CHANGELOG.md)。
