# UI-BACKLOG — 游玩端 VR

> 更新：2026-10-22 ｜ 状态：**主流程 / 六屏 / 手感调参已实现；用户反馈“手感基本合格”；剩余项见 §4** ｜ 设备基准：Meta Quest 3
> 相关：[STATUS.md](STATUS.md) ｜ [FUTURE.md](FUTURE.md)（§0 近期玩法 / 编辑器计划） ｜ [main.ts](src/main.ts) ｜ [gameUi.ts](src/ui/gameUi.ts) ｜ [player.ts](src/game/player.ts) ｜ [设计工作流](../DESIGN-WORKFLOW.md)

---

## 0. 当前状态

- 进 VR 先到 **Home**，不自动播放；`START` 才进入谱面。
- 六屏：Home / Songs / Add packs / Pause / Settings / Result。
- 游玩中无面板；暂停**只走左手 Y 长按 400ms**——Quest 3 浏览器不把 menu 键暴露给 WebXR，menu 分支保留但不指望；桌面 `Esc`。
- 用户已认可当前双栏布局；“手感基本合格”。
- Songs 超过 4 首可滚动（摇杆优先）；游玩中有独立 Combo HUD。
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
| Songs 滚动 | 超过 4 首时列表滚动：**摇杆上下推**为主路径；另有 ↑/↓ 箭头、滚动条、`n–m / total` 计数；换歌自动把选中项滚进视野 |
| Result 评级 | 右栏顶部是评级锁版（D–A 单字 / APX–EQV 三字母 + 数学记号），阈值 80/85/90/95/97/98/99/100，99–100 记 `EQV-`、恰好 100 记 `EQV`；CLEAR / FAILED 大字 |
| Combo HUD | 游玩中独立数字 HUD，世界固定在判定带中线上方；0 时隐藏，MISS 快速淡出；只做反馈，不计分 |
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
| 引导网 | 竖直、只亮网格线；full 窗口 early `-100` / late `+80ms`；320ms 外不亮；patch 约 `190×128px` |
| 计分 | 总分 `10,000,000`；PERFECT 100% / **GOOD 60%** / MISS 0；GOOD 血量 +0.25（PERFECT +0.5）；combo 不计分 |
| arc 暗度 | 未接住 `0.42`，接上 / 未过线 `1.0`；状态切换立即生效 |
| 短棒 | `0.18m`；sustain 透明度 `0.28`，关闭 depthWrite；判定点仍在控制器原点 |
| Combo HUD | 世界固定 `(0, 1.80, −2.60)`；Sprite 宽 `0.50m`；离头 1.9m 起淡出、1.1m 消失；`?comboX` / `?comboY` / `?comboZ` 可调；0 时隐藏 |
| Songs 滚动 | 4 行窗口（行高 `41px`）；摇杆满推约 `7 行/秒`；滚轮不参与 |

`?debug=1` 可在生产页强制显示调试 GUI；注意 immersive VR 不会合成 DOM，lil-gui 只在 2D 页面 / 桌面镜像里可见。

---

## 4. 待办 / 未闭环

| ID | 优先级 | 问题 | 说明 |
| --- | --- | --- | --- |
| UI-03 | P1 | 没有完整的游玩前校准 | Settings 已可从 Home / Pause 打开；仍缺 offset 试听、试打、身高校准、左右手 / 站姿、设置持久化 |
| UI-13 | P2 | 包索引手工维护 | 重新导出 `.parallax` 后要手动更新 `index.json` 的 duration / notes / bpm 等；选中后会以包内 chart 为准 |
| UI-14 | P2 | 本地包管理 | 没有移除 / 重命名；IndexedDB 按 origin 隔离，localhost 加的包不会出现在 pages.dev |
| UI-15 | P2 | 无物量谱面立即结束 | 还没有按 `meta.duration` 等待；等 Infinity Heaven 补完再处理 |

“待办”不代表都要做；UI-03 是下一步最有价值的。

### 4.1 已关闭（2026-10-22）

| ID | 结论 |
| --- | --- |
| UI-12 | **已实现**：Songs 超过 4 首时摇杆滚动 + ↑/↓ 箭头 + 滚动条；选中项自动滚进视野 |
| UI-16 | **已关闭**：Quest 3 头显实测完成——0.70m 判定线、Y 长按暂停、hold 未再报误触；`buttons[6]` 确认读不到，不再依赖 |
| UI-18 | **已实现**：独立 Combo HUD（见 §3）；浮空显示里的 `COMBO n` 保留为信息板的一部分 |
| FEEL-05 | **结束观察**：perfect `-100/+80`、good `-140/+160` 用户判定手感合格，不再收 / 放 |
| FEEL-06 | **结束观察**：用户确认 hit 双层音 / drag 轻击音量与音色可用 |
| FEEL-04 | **已实现**（2026-10-26）：hit 的判定体积=**细棒**（note 尺寸 + 棒半径的横截面，约 0.125 × 0.055 × 0.065，比手掌盒小一个数量级），可以打手心到棒尖任意一段；速度 / 挥动按**打击处**取（手心 → 棒尖线性插值）。没有短棒时退回手掌盒；drag 两种都认；arc / hold 仍用手部点。待头显试打确认手感 |

---

## 5. 关键决策

- **面板“大”与“近”分开**：优先 1.35m 聚焦距离，不再靠放大解决可读性。
- **视觉方向**：A 技术控制台 + C 编辑网格的排版密度；浅蓝主强调，lime 只做稀有状态；黄铜 / 青 / 赤保持判定 / 左手 / 右手的语义。
- **判定的空间与时间分离**：hitbox X / Z 倍率只改手的空间容差；时间窗独立。默认手感不被调试倍率改变。
- **hit 可以悬空**：造型必须上下对称；最终采用压薄的 sandwich，而不是底座 + 键帽。
- **3D 反馈不用 2D 环**：hit 直接碎裂；arc 用明暗 + 接触光表达连接。
- **短棒只做视觉引导**：不移动手部采样点；是否用棒尖是后续试打问题。
- **GOOD 不是一半**：分数 / 准确率都是 60%；只有血量是 PERFECT 的一半。
- **列表滚动用摇杆**：Quest 上没有滚轮，鼠标离面板 1.35m 也够不到；摇杆是主路径，箭头只是兜底。
- **Combo HUD 世界固定**：不做头锁 HUD，也不要求和头部保持固定角度 / 固定视角占比；数字是主视觉，不做演出，不参与计分。
- **tier 主题色已定稿**（见 [`../parallax-idea.md`](../parallax-idea.md) §3）：钢灰 / 绿（呼吸）/ 琥珀（警报闪烁）/ 荧光洋红（自发光）/ Wien ∞ K 蓝（更亮自发光 + 选歌界面除封面外降饱和）。**当前没有实现任何 tier UI**；编辑器新谱默认难度已改为空。

---

## 6. 验收与证据

- `npm run typecheck` / `npm run build` 通过。
- 六屏截图：[`docs/ui-vr2`](../docs/ui-vr2)；hit / arc / debug / combo / songs 滚动截图也在同一目录
  （`combo-hud.png`、`songs-scroll.png`、`songs-panel.png`）。
- 已做过的桌面验证：主页 → 游玩 → 暂停 → Settings → Back；Songs 切歌 / 滚动；懒加载 18MB 包；hitbox GUI；WebXR 页调试 GUI。
- 已闭环（2026-10-22 头显）：判定线 0.70m、暂停 Y 长按、hold 误触、arc `0.42` 暗度、Good 分布、打击音色。
- 仍未闭环：FEEL-04 的**头显试打**（长方条判定已改，手感未确认）、Songs 滚动在头显里的手速（新功能，待下一次试玩）。

---

## 7. 历史节点（压缩）

- **2026-10-20**：P0 流程 / 输入安全；六屏双栏 UI；1.55m / 1.35m 面板；包索引 + 懒加载；arc 流速 / 包 offset 分离。
- **2026-10-21**：hit 音效、early/late、竖直引导网；hit 重新设计（独立 `design/hit-lab/`，最终 slim sandwich）与陶瓷碎裂；arc 连接反馈。
- **2026-10-22**：默认判定线 `0.80 → 0.70m`；hitbox X/Z 调试 + 手部球放大；WebXR 页面显示调试 GUI；手腕短棒；perfect / good early 窗口收窄；用户确认手感基本合格。
- **2026-10-22（晚）**：Songs 摇杆滚动（UI-12）、独立 Combo HUD（UI-18）；确认 Quest 3 只能 Y 长按暂停；关闭 UI-16 / FEEL-05 / FEEL-06。

更细的过程记录已从 backlog 移除，保留在 git 历史与 [CHANGELOG.md](../CHANGELOG.md)。
