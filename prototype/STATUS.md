# prototype / STATUS

> 更新：2026-10-25 ｜ 版本：**0.4.0+背景** ｜ 阶段：**Phase 1 完成；手感调参基本合格**
> 当前个人进度：**Infinity Heaven 初谱制作中**（用户估计约 1 周）；期间只做小修。
> 设计真相：[`../parallax-idea.md`](../parallax-idea.md) ｜ Phase 1 旧协议：[`../agent_old.md`](../agent_old.md)（**OLD / 已归档**） ｜ 后续架构 / 近期玩法计划：[`FUTURE.md`](FUTURE.md) §0
> 完整逐轮历史（55 节 / 90KB）在 git：`git show ad37349:prototype/STATUS.md > /tmp/parallax-status-full.md`。本文件是 2026-10-20 的压缩版。

---

### 2026-10-25 · 3D 背景落地

- `design/bg-lab/` 出方向（Blender）：没有地面、体素台地只在余光里、悬空的菱形巨构；
  实验室截图 / `.blend` / 生成脚本都在这个目录；
- 迁进 `src/scene/background/`：三个程序化生成器 + 两个预设（light / dark），
  5.6k 面 / 3 draw calls，无灯光 / 雾 / 贴图；相机 `far` 80 → 400（天空球 R=320）；
- 游戏默认 light（`?bg=dark` 切），切谱时按包内 `background` 重建；
- 设置页新增 `Background`；制谱器 `VIEW → BG`，导出写 `background/scene.json`；
- 独立实验台 `bg-lab.html`（`?pal=dark&pitch=27`）；
- 规范草案 [`BACKGROUND.md`](BACKGROUND.md)：节点集合封闭、glTF 2.0 承载模型 / 动画、
  演出走时间线、音频走固定参数通道；
- **未做**：`scene.json` 加载器、`gltf` / `text` 节点、时间线 / 音频参数运行时。

## 0. 现在看这里

| 问题 | 答案 |
| --- | --- |
| Phase 1 | ✅ 完成并验收（Step 0–5，2026-10-19） |
| 现在能玩 | 41.6s 测试谱、示例谱、本地 Infinity Heaven 包；桌面 fallback + Quest 3 |
| 当前在做 | **Infinity Heaven 初谱**，不是代码重构 |
| 性能 | Quest 3 实测 **72Hz+**；没有自动帧时间回归测试 |
| 构建 | `typecheck` / `build` 通过；没有自动测试 / CI |
| 下一步 | 完成初谱 → 小修 → 外部试玩 → golden tests → Unity spike |

### 近期进展（压缩日志，2026-10-20 → 10-22）

- 完成个人初谱 **Infinity Heaven**，同时摸索制谱流程；
- 期间可能做的小修：
  - **arc**：更多曲线过渡；
  - **游玩 UI**：P0–P2 流程 / 选歌 / 视觉已做；余下准备页与 Quest 3 验收；
  - **VR panel**：小幅扩展。
- 约束：保持 v0.4.0 可玩；**不启动 Unity / 资源库 / 大重构**；每次小修只碰一个面。
- 游玩端 UI 问题已单独记录：[`UI-BACKLOG.md`](UI-BACKLOG.md)（入口 / 选歌 / 暂停层级 / 激光误触 / 视觉方向）。
- **设计实验工作流**：外观 / 版式没定时可以先在 `design/` 做干净夹具，但移植后主代码是唯一事实来源，必须在头显 / 真实视口验收；见 [`DESIGN-WORKFLOW.md`](../DESIGN-WORKFLOW.md)。
- **P0 UI 已实现（2026-10-20）**：进 VR 先到主页、`START` 才播放；游玩中无常驻按钮；暂停 / 设置分层；暂停走左手 Y 长按（menu 键在 Quest 3 上读不到）。已在头显验收。
- **P1 A 第一版（2026-10-20）**：面板拉近、现代石墨 + 浅蓝主强调 / lime 稀有状态；主页 / 暂停 / 设置各 5 行；新增 Songs 面板与「如何加包」提示。待头显验收；多曲切换未做。
- **P2 布局重做（2026-10-20）**：去圆角；主页双栏、Songs 可选列表 + 详情、Pause / Settings / Result 双栏；可切换内置谱并重建播放器 / 音频 / 浮空显示；Add packs 二级页。待头显验收。
- **2D UI Study（2026-10-20）**：[`design/ui-2d/`](../design/ui-2d/) 先用网页试 A + C 的排版 / 浅蓝 / lime / 密度；六个界面可切换，截图在 `docs/ui-2d/`。
- **VR 复刻 2D Study（2026-10-20）**：760×470 六屏按二维稿重排；标签 10–11px / 正文 12–13px / 按钮 16px，2× 纹理；chart map / density 来自真实谱面。截图在 `docs/ui-vr2/`。待 Quest 3 验收。
- **面板距离 / 尺寸（2026-10-20）**：1.55m 宽 × 0.959m 高，距离 1.35m、中心高 1.44m；优先保证聚焦距离，水平视角约 60°。可用 `?panelScale` / `?panelDistance` / `?panelY` 在头显里继续调。
- **包索引 / 懒加载（2026-10-20）**：`public/packages/index.json` 在启动时只读元数据，选中条目后才下载 `.parallax`；Infinity Heaven / Air / Ticks 会直接出现在 Songs。
- **arc 流速 / 包 offset（2026-10-20）**：Settings 改流速会同步缩放已生成的 arc；`meta.offset` 改为隐藏的 `chartOffsetMs`，与玩家校准 offset 分离。
- **手感布局（2026-10-20）**：单轨宽 0.23→0.27m，所有 note / arc 的 x 按 lane 单位同比展开；判定带前移 25cm（近端内 0.80m，10-22 头显实测后再下调到 0.70m）。editor 的 3D view 共享 `DEFAULT_PARAMS` / `deriveGeometry`，自动同步。
- **打击反馈（2026-10-21）**：hit / drag 加打击音（hit 更响、drag 更轻）；结算加 GOOD early / late；判定带加竖直、只亮网格线的时间驱动引导网。hit 前侧 z 容差收到 0.22m，观察 early 偏多是否来自提前挥入。
- **hit 造型 / 碎裂（2026-10-21）**：先在 [`design/hit-lab`](../design/hit-lab/) 比较三个上下对称方向，最终采用压薄的 A / SANDWICH：`0.232 × 0.084 × 0.096m`，上下同形釉面 + 窄金属芯 + 内收手别色光缝。命中不再画冲击环，直接碎成陶瓷片；打击音在原 click 上叠一层短低频。
- **判定调试 / 手部球（2026-10-21）**：dev GUI 增加 `hit 判定盒（时间窗不变）`，X / Z 倍率即时生效，并显示当前 0.26m × 0.60m；可用 `?hitboxX` / `?hitboxZ` 在头显里调，默认值不变。XR 控制器端点球 0.012→0.02m，桌面指针球 0.016→0.024m。判定线距离继续用已有的 `?band` / GUI 台面项。
- **判定线默认距离（2026-10-22）**：头显实测 0.70m 最好；`DEFAULT_PARAMS.bandDistance` 0.80→0.70，bandZ −0.46→−0.36。`?band` 仍可覆盖。
- **arc 连接反馈（2026-10-21）**：身体过线且没有手接住时整条 arc 立即降到 0.42 亮度；接上时在弧头 / 手附近出现更大的手别色接触光，失去连接再变暗。`auto` 保持正常亮度。跟随 / tick / 计分不变。
- **引导网增强（2026-10-22）**：竖直引导网检测窗口 180→320ms，patch 118×72→190×128px，线宽 / 亮度提高；远处也先浮起来。
- **手腕短棒（2026-10-22）**：两只控制器各加一根 0.18m 短棒；默认与 hit 时全亮，接住 hold / arc 时淡到 0.28。WebXR 浏览器现在也会显示调试 GUI，`?debug=0` 可关。hit perfect 改为 early -100ms / late +80ms，good 为 early -140ms / late +160ms；引导网同步为不对称 full 窗口。
- **手感验收（2026-10-22）**：用户反馈「手感基本合格」。计分仍为 PERFECT 100% / GOOD 60% / MISS 0；GOOD 血量 +0.25（PERFECT 的一半），combo 两者都 +1 但不计分。
- **Songs 滚动（2026-10-22）**：列表从固定 4 行改为 4 行窗口 + 摇杆滚动（`hands.stickY`，axes[3] / axes[1]）；另有 ↑/↓ 箭头、滚动条、`n–m / total` 计数；换歌自动把选中项滚进视野。
- **Combo HUD（2026-10-22）**：[`src/scene/comboHud.ts`](src/scene/comboHud.ts) 世界固定 Sprite，位置 `(0, 1.80, −2.60)`（高于眼高与最高 note；玩家靠近 1.9m 内淡出）；大数字 + 小标签；0 隐藏、MISS 快速淡出、命中轻微脉冲；只在 combo 变化时重绘纹理；`?comboX` / `?comboY` / `?comboZ` 可调。修过一次实现 bug：缺 `?comboZ` 时 `Number(null) === 0` 把 HUD 放到 `(0, 0, 0)`（玩家头里）。
- **默认难度 / tier 色（2026-10-22）**：编辑器新谱默认难度改为空字符串（不再写 `IN 1`）；五个 tier 的主题色 + 动效定稿，记录在 [`../parallax-idea.md`](../parallax-idea.md) §3 与 [`FUTURE.md`](FUTURE.md) §0.1，**未实现 tier UI**。
- **时间线 timing 标记 + 检查器折叠（2026-10-23）**：timing 点在 2D 上显示 `BPM · n/d` 标签与虚线，悬停出 BPM / 拍号 / 起止；`TIMING` / `SHIFT` 可收起、超过 10 条折叠并带 `JUMP TO` 索引；TRACE 段只显示当前选中的那条。
- **trace 引导线（2026-10-23）**：`chart.traces[]`（独立于 notes，无物量 / 不判定）；运行时细线 + 淡出窗口；编辑器 `TRACE` 工具 + 检查器段（改点 / 删点 / 播放头追加）；2D 总览画区间；`?traces=0` 可关；arc ↔ trace 互转；2D/3D 贴 trace 吸附放 note（2D / 3D 悬停高亮，3D 可拖点）；trace 在主视图 / 高度视图以 1px 细线显示（`TRACES` 可关），顶点可选中 / 拖动 / 删除。
- **双押提示 + 引导网（2026-10-23）**：同一毫秒的 hit 之间画细连线（`double-hit-links`）；竖直引导网改成和 3D 编辑网格同源（1/4 轨 / 5cm），暖黄只在 hit 进入 perfect 的 -100/+80ms 时出现，并加了开关（编辑器顶栏 `GUIDE`、游戏 `?guide=0`）。
- **自由拍号（2026-10-23）**：`TimingPoint` 增加 `numerator` / `denominator`（`4/4`、`5/6`、`4/3` 都能写），BPM 以四分音符为参照；编辑器 timing 行改成 `N / D` 两个输入，网格按段重算、小节号跨段累加，状态栏实时显示 `N/D · BAR n`；SNAP 预设跟着拍号变（5/6 下是 1/6、1/12、1/18…）；合成鼓组按拍号配重音。旧谱 `beats` 仍兼容；换拍号可落在小节中间（残小节保留编号、下一段接着编号）。
- **结算评级（2026-10-23）**：Result 改为双栏新版——左栏分数 / 曲名 / 四事实 / 判定条 / 按钮，右栏评级锁版（canvas 复刻，cap 52）+ PERFECT/GOOD/MISS + GOOD TIMING；CLEAR / FAILED 27px。阈值 `<80 D … 99 EQV- / 100 EQV`。
- **暂停路径确认（2026-10-22）**：Quest 3 浏览器不暴露 menu 键，实际只有左手 Y 长按 400ms 可用；UI 文案与文档同步。
- **暂缓**：无物量时立即结算，暂不按包内 `meta.duration` 等待；等 Infinity Heaven 谱面补充完成后再处理。

---

## 1. 现在能跑什么

| 区域 | 状态 | 说明 |
| --- | --- | --- |
| 台面 | ✅ | 0.95m 平面；6 轨物理场 / 4 轨窗口；隐藏轨几何不存在 |
| 键型 | ✅ | hit / drag / hold / arc；hit 有 GOOD，其余只有 PERFECT / MISS |
| 判定 | ✅ | 只看时间：hit perfect -100 / +80ms、good -140 / +160ms；drag ±120ms；hold tick 200–600ms；arc 普通 200ms / 关键 80ms |
| shift | ✅ | 谱面驱动；左 / 右一轨；约 350ms；0 / 5 进入窗口时暗一档 |
| 谱面 / 播放器 | ✅ | v0 schema；SV 积分；arc 点列 + 每段缓动；高度上限；测试谱 41.6s / 79 notes |
| 音频 | ✅ | AudioContext 主时钟；2s lead-in；offset；无音轨时合成鼓组；FLAC / MP3 标签与封面 |
| 计分 / UI | ✅ | 10,000,000 按物量分配；血量 100；设置 / 暂停 / 结算；激光笔 + 手戳 |
| 渲染 | ✅ | 9m 视距 / 4m 渐显；逐片元淡出；note renderOrder 5/6/7 |
| 制谱器 | ✅ | 2D 时间轴 + 高度 / SV / 波形；3D 直接编辑 x/z；多选；预览；导入导出；频谱 |
| 谱面包 | ✅ | 单文件 `.parallax`；谱面 + 音频 + 封面 + 预留资源；`?pack=` / 本地加载 |

---

## 2. 关键参数

| 参数 | 值 |
| --- | --- |
| 台面高度 / 轨宽 / 进深 | 0.95m / 0.27m / 10m |
| 判定带 | z = −0.36m（近端内 0.70m；2026-10-22 头显实测从 0.80 下调） |
| 高度基准 | 胸 0.33 / 面 0.61 / 头顶 0.81 m（相对台面） |
| 高度上限 | 0.81m；超限 note 不生成 |
| 视距 / 渐显 | 9m / 4m |
| 总分 / 血量 | 10,000,000 / 100（MISS −6） |
| lead-in | 2000ms |
| 坐标 | `time` 毫秒；`x` 横向；`z` 高度 |

---

## 3. 不可破坏的契约

1. **判定只看时间**：毫秒窗口；流速、SV、帧率都不改变判定。
2. **音频时钟是权威**：`AudioContext.currentTime` + 输出延迟；不用逐帧 `dt` 累加。
3. **位置 = 判定带 − ∫速度 dt**：SV 为 0 停住、负数倒流；判定不受影响。
4. **坐标**：`x` 横向、`z` 高度、`time` 毫秒；旧 `y` 高度字段只做兼容读取。
5. **shift 只动窗口**：不旋转 / 不移动判定带；隐藏轨不判定；0 / 5 进入时暗一档。
6. **hold 只在地面**；hit / drag 可浮空；arc 点自由 x/z；超高度上限不生成。
7. **谱面轨号是绝对 0–5**；窗口只在渲染 / 校验层换算。
8. **编辑器与游戏共用 schema / timeline / player**；不复制第二套判定。
9. **渲染顺序**：台面 / 线 < 3；note 实体 5、glow 6、aura 7；缩放过的 note mesh `frustumCulled = false`。
10. **`.parallax` v1 读取器保持兼容**；一包一谱；不压缩 / 不签名。

---

## 4. 代码地图

| 路径 | 职责 |
| --- | --- |
| `src/main.ts` | 游戏入口：渲染器 / 相机 / XR 会话 / 主循环 |
| `src/config.ts` | 台面参数、派生几何 |
| `src/chart/` | `schema` / `timeline`（SV 积分、shift、校验）/ `easing` / 示例谱 / 验收谱 |
| `src/game/` | `player` / `judgement` / `scoring` / `arc` / `hands` / `shatter` / `popup` |
| `src/audio/` | `clock`（AudioContext 主时钟）/ `track`（合成鼓组）/ `metadata` / `spectrogram` |
| `src/pack/` | `.parallax` 容器 `format` / `io` / 浏览器本地包 |
| `src/scene/` | `table` / `notes` / `display` / `backdrop` / `controllers` / `materialLab` |
| `src/materials/` | 材质库 / `palette` / 程序化贴图 / `glow` / `distanceFade` / `environment` |
| `src/ui/` | `vrPanel` / `gameUi` / `debug` / `diagnostics` |
| `src/editor/` | 制谱器：`main` / `timelineView` / `interaction` / `inspector` / `preview` / `persistence` / `waveform` / `spectrum` / `overview` / `arcEdit` / `model` |
| `index.html` / `editor.html` | 游戏页 / 制谱器页（Vite 多页） |

---

## 5. 版本压缩史

| 阶段 / 版本 | 交付 |
| --- | --- |
| Step 0–1 | WebXR 链路；台面最终为 0.95m 平面；材质与四种键型造型 |
| Step 2 | 四种键型判定；drag 扫过 / hold 按键 + 物量 / arc 跟随 + 关键物量 / hit 挥击 |
| Step 3 | 4 轨窗口 shift；0 / 5 暗一档；隐藏轨不渲染 |
| Step 4 | 谱面 v0；SV 积分；音频时钟；计分 / 血条 / VR UI；视距淡出；高度上限；41.6s 测试谱 |
| Step 5 / 0.2.0 | 桌面制谱器；`.parallax` 包；封面 / 时长；本地包加载 |
| 0.3.0–0.3.11 | 频谱；3D arc 编辑；多选；X / Z 缓动；3D SPEED；offset / 频谱修复；性能优化 |
| 0.4.0 | 自由拍号（n/d + SNAP 自适应）；trace 引导线 + arc↔trace + 3D 手柄；结算评级（EQV）；双押连线；时间线 timing 标记；检查器折叠 |

---

## 6. 值得保留的踩坑结论

- **判定最初按米算**：流速一变，同一个窗口对应的毫秒数就变；已全部改成 ms。
- **假时钟**：逐帧累加 `dt` 会因掉帧漂移；已改 AudioContext 主时钟 + 双锚点。
- **`Number(null) === 0`**：URL 缺参数会被读成 0，导致静音 / lead-in 消失；先判 `!== null`。
- **透明台面盖住 note**：台面 mesh 在原点、按距离排序时被当成最近；用 renderOrder 5/6/7 修。
- **缩放 mesh 被视锥剔除**：所有 note mesh `frustumCulled = false`。
- **整体 alpha 淡出不够**：arc / hold 这类长物体要逐片元淡出。
- **arc 几何按初始速度烘焙**：改 3D SPEED 要同步 `scale.z`，不要重建曲线。
- **频谱 `ImageData` 行列写反**：时间 / 频率轴转置；用静音 + 440Hz 验证过。
- **频谱 offset**：必须按 `t − meta.offset` 映射；改 offset 要清 tile 缓存。
- **编辑器空转**：暂停时每帧重绘 3D / 2D / 总览会吵风扇；按 dirty 渲染。
- **18MB 包每次导出都重写**：迭代期低效；未来拆 workspace（chart-only）与 portable pack。

---

## 7. 已知问题 / 限制

### 游玩 / 音频

- 音频听感：用户已在头显确认 hit / drag 音量与音色可用；偏早 / 偏晚仍用设置里的 `AUDIO OFFSET` 微调。
- 暂停时长按扳机再松手，可能顺带触发一次 UI 点击（面板与判定共用「按下」）。
- 手追踪未支持；控制器优先。
- 72Hz+ 是 Quest 3 实测，但没有自动帧时间回归测试。

### 制谱器

- 音频 / 封面文件不持久化到草稿（会进 `.parallax` 包）。
- 慢放 / 倒放静音（AudioContext 不能倒退）。
- 多选只覆盖 note；arc 顶点仍单点编辑。
- 没有框选 / 复制粘贴 / 自动 BPM 检测 / section 编辑。
- 3D 里 arc 点的时间仍要在 2D / 检查器改。
- 预览窗口比头显视场窄；它验证谱面，不验证视场。

### 包 / 工程

- 一包一谱；不压缩 / 加密 / 签名；主题 / 背景文件被携带但游戏未消费。
- Infinity Heaven 包 18.4MB，其中 `chart.json` 只有 8KB；每次导出都重写整包。
- 没有自动化测试 / CI；验证靠 `typecheck` / `build` + CDP 手动脚本。

---

## 8. 下一步

### 现在（Infinity Heaven 期间）

- 完成初谱；记录最卡手的前 3 个步骤；
- 小修按优先级：**arc 曲线过渡 → 游玩 UI → VR panel**；
- 每次小修后跑 `typecheck` + `build` + 一张谱 smoke test。

### 初谱完成后

1. **5–8 人外部试玩**（Quest 3），录屏，不指导；
2. 抽 **runtime contract + golden tests**（时间轴 / 判定 / arc / shift / 计分 / 包读取）；
3. **Unity vertical slice**（2 周 timebox）或继续 Web，按验收决定。

### 明确不做（现在）

- Unity 全量重写、资源库 / workspace、多谱包、手追踪、正式美术 / 曲库。

---

## 9. 验证命令

```bash
cd prototype
npm run typecheck
npm run build
npm run dev
```

手动 smoke test：

- 游戏：`?chart=demo` / `?pack=/packages/air-example.parallax`；
- 制谱器：`/editor.html` 载入示例 → 放一个 note → 预览 → 导出 → 游戏 `?pack=` 读回；
- Quest 3：`adb reverse tcp:5173 tcp:5173`，打开 `http://localhost:5173`。

---

## 10. 历史

- 完整逐轮记录（0–55 节，90KB）在 git：`git show ad37349:prototype/STATUS.md`。
- 本文只保留仍会影响后续开发的状态、契约、结论和坑。
