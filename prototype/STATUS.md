# prototype / STATUS

> 更新：2026-10-26 ｜ 版本：**0.4.2** ｜ 阶段：**Phase 1 完成；内容期（Infinity Heaven 未完成）；手感已验收（手掌盒 + 细棒）**
> 当前个人进度：**Infinity Heaven 初谱制作中（未完成）**；期间只做小修，不重启架构。
> 设计真相：[`../parallax-idea.md`](../parallax-idea.md) ｜ Phase 1 旧协议：[`../agent_old.md`](../agent_old.md)（**OLD / 已归档**） ｜ 后续架构 / 近期玩法计划：[`FUTURE.md`](FUTURE.md) §0
> 完整逐轮历史（55 节 / 90KB）在 git：`git show ad37349:prototype/STATUS.md`。本文件是压缩版，2026-10-26 又并了一轮日志。

---

### 2026-10-26 · 状态收敛（本轮决定）

- **Infinity Heaven 仍未完成**（此前「近期进展」里写成「完成」是错的，已改）。
- **腰高 4 轨可读性验收通过**（Quest 3）：细分割线 + 0 / 5 暗一档 + 窗口随 shift 整体滑动已经足够；
  **「轨道必须有实体槽壁」的旧结论作废**——台面不挖槽，键浮在台面上。
- **UI-03 收窄**：offset 试听、身高校准 / 站姿、设置持久化**暂缓**，不排期。
- **去掉难度 legacy 字符串**：内置验收谱 / 示例谱 / `public/charts/*.json` / `packages/index.json` /
  `air-example.parallax` 里的 `IN n` 全部清空；旧谱里的字符串仍原样读取，不做映射。
- **glTF / 时间线 / 音频参数运行时推迟到 Unity 项目开始**；程序化 `light` / `dark` 两个预设保持现状。
- **编辑器校验**：trace 的 x / z 越界不再报警（引导线允许越界），只保留结构检查。
- **CI 进待办**（目前仍无自动测试）；谱面校验只留在制谱器里，不进 CI。

### 2026-10-26（深夜）· 手感定稿：手掌盒 + 细棒；手掌盒 / arc 收紧

- **两个都有最好**（头显结论）：hit / drag 默认同时认**手掌盒**与**短棒细条**；
  `?hitrod=0` 可关掉细棒。细棒横截面仍为 `0.16 × 0.10 × 0.12`，手掌盒保底。
- **手掌盒收紧**（旧值太宽，GOOD 太容易）：
  - hit：x ±0.12（原 0.13）、y ±0.20（原 0.26）、z 近 0.16 / 远 0.32（原 0.22 / 0.38）；
  - drag 保持不变：x ±0.13、y ±0.26、z ±0.40（drag 没有 GOOD，宁松勿漏）。
- **arc 收紧**：普通 / 关键物量半径 0.19 → 0.16，BAND_ZONE 0.42 → 0.30；
  时间窗保持 200ms / 80ms（设计契约），只收紧「手要离弧多近」。
- **头显试打通过（2026-10-26）**：用户反馈「很可以了」；手掌盒 / arc 的收紧量保留。

### 2026-10-26（晚）· FEEL-04 细棒单独取代手掌盒：未通过

- **头显试打结果：手感不好，miss 明显变多。** 从数值上看，细棒把空间容差从手掌盒的
  y ±0.26m / z 0.22–0.38m 收成 y ±0.055m / z ±0.065m，相当于要求 1cm 粗的棒
  对准 8cm 高的 note——这是最可能的原因。
- 当时先回退到手掌盒，随后确认「两个都有」才是最终方向；细棒的实现（打击处速度、
  棒尖跟踪）保留下来，作为手掌盒之外的额外路径。

### 2026-10-26 · 短棒判定（FEEL-04，细棒单独取代的方案已废弃）

> 这一段是当时的实现记录；现在的默认是「手掌盒 + 细棒并存」，见上。

- hit 的判定体积换成**细棒**：note 到短棒的最近点 + 横截面（note 尺寸 + 棒半径，
  0.125 × 0.055 × 0.065），比手掌盒（0.13 × 0.26 × 0.60）小一个数量级；
  手掌盒只在没有短棒时用，drag 两种都认。
- **打击处的速度**：手心 → 棒尖线性插值（刚体上各点速度沿棒线性变化），
  `HIT_GOOD_SPEED` / `HIT_MIN_SWING` 与 drag 的扫过门槛都改用它 → 棒尖轻敲更容易成立。
- 棒尖速度与挥动距离在 `hands.ts` 里按 120ms 位置历史单独跟踪（含平滑与尖峰剔除）。
- arc / hold 不变，仍然用手部采样点；没有短棒时（桌面指针 / 控制器没连）退化成原来的点判定。
- **当时的验收项**：棒尖命中是否顺手、z 窗口是否变得太松（结果：未通过，见上方「FEEL-04 细棒单独取代手掌盒：未通过」）。

### 2026-10-25 · 3D 背景落地

- `design/bg-lab/` 出方向（Blender）：没有地面、体素台地只在余光里、悬空的菱形巨构；
  实验室截图 / `.blend` / 生成脚本都在这个目录。
- 迁进 `src/scene/background/`：三个程序化生成器 + 两个预设（light / dark），
  5.6k 面 / 1 draw call（游戏），无灯光 / 雾 / 贴图；相机 `far` 80 → 400（天空球 R=320）。
- 游戏默认 light（`?bg=dark` 切），切谱时按包内 `background` 重建；设置页新增 `Background`；
  制谱器 `VIEW → BG`，导出写 `background/scene.json`。
- 独立实验台 `bg-lab.html`（`?pal=dark&pitch=27`）。
- 规范草案 [`BACKGROUND.md`](BACKGROUND.md)：节点集合封闭、glTF 2.0 承载模型 / 动画，
  演出走时间线、音频走固定参数通道。

## 0. 现在看这里

| 问题 | 答案 |
| --- | --- |
| Phase 1 | ✅ 完成并验收（Step 0–5，2026-10-19） |
| 现在能玩 | 41.6s 测试谱、示例谱、本地 Infinity Heaven 包；桌面 fallback + Quest 3 |
| 当前在做 | **Infinity Heaven 初谱（未完成）**，不是代码重构 |
| 手感 | ✅ 头显验收通过（2026-10-26）：**手掌盒 + 细棒都认**；手掌盒 / arc 已收紧；`?hitrod=0` 关细棒 |
| 腰高 4 轨 | ✅ 2026-10-26 头显验收通过；细分割线 + 0 / 5 暗一档；槽壁方案作废 |
| 性能 | Quest 3 实测 **72Hz+**；没有自动帧时间回归测试 |
| 构建 | `typecheck` / `build` 通过；**没有自动测试 / CI（待办）** |
| 下一步 | 完成初谱 → 小修 → 外部试玩 → golden tests + CI → Unity spike |

### 压缩日志（2026-10-20 → 10-25）

> 逐轮细节见 git 与 [`../CHANGELOG.md`](../CHANGELOG.md)；这里只留结论。

| 日期 | 面 | 结论 |
| --- | --- | --- |
| 10-20 | 流程 / 面板 / 曲库 | 进 VR 先 Home，`START` 才播放；六屏状态机；面板 1.55×0.959m / 1.35m / 中心 1.44m；曲库索引 + 懒加载 |
| 10-21 | 打击反馈 / 造型 | hit 定为 slim sandwich `0.232×0.084×0.096m`；陶瓷碎裂；arc 断连降到 `0.42`；打击音双层 |
| 10-22 | 手感 / HUD / 布局 | 判定线 0.80→0.70m；perfect −100/+80、good −140/+160；GOOD 60%；短棒 + 引导网；Combo HUD；Songs 摇杆滚动 |
| 10-23 | 编辑器 / 结算 | 自由拍号 `n/d`、trace、arc ↔ trace、结算评级（D…EQV）、双押连线、timing 标记 |
| 10-25 | 背景 | 程序化 light / dark；无地面；包内写展开参数；`?bg=` / 设置 `Background` |

---

## 1. 现在能跑什么

| 区域 | 状态 | 说明 |
| --- | --- | --- |
| 台面 | ✅ | 0.95m 平面；6 轨物理场 / 4 轨窗口；隐藏轨几何不存在 |
| 键型 | ✅ | hit / drag / hold / arc；hit 有 GOOD，其余只有 PERFECT / MISS |
| 判定 | ✅ | 只看时间：hit perfect −100 / +80ms、good −140 / +160ms；drag ±120ms；hold tick 200–600ms；arc 普通 200ms / 关键 80ms |
| shift | ✅ | 谱面驱动；左 / 右一轨；约 350ms；0 / 5 进入窗口时暗一档 |
| 谱面 / 播放器 | ✅ | v0 schema；SV 积分；arc 点列 + 每段缓动；高度上限；测试谱 41.6s / 79 notes |
| 音频 | ✅ | AudioContext 主时钟；2s lead-in；offset；无音轨时合成鼓组；FLAC / MP3 标签与封面 |
| 计分 / UI | ✅ | 10,000,000 按物量分配；血量 100；设置 / 暂停 / 结算；激光笔 + 手戳 |
| 背景 | ✅ | 程序化（light / dark）：无地面、体素台地、菱形巨构；5.6k 面；包内可覆盖 |
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
| hit 判定体积 | 手掌盒 x ±0.12 / y ±0.20 / z 0.16–0.32；细棒 `0.16 × 0.10 × 0.12`（两者都认） |
| arc 判定 | 半径 0.16 / BAND_ZONE 0.30；时间窗 200ms（关键 80ms）不变 |
| 背景 | 程序化 light / dark；相机 `far` 400（天空球 R=320） |

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
11. **背景永远可选**：关掉仍能玩；包内写**展开后的完整参数**，运行时只读包内值、不查族表。
12. **难度是作者显式信息**：新内容不再写 `IN n` 这类 legacy 字符串；旧谱字符串原样读取，不猜 tier。
13. **时间窗是设计契约**：hit perfect −100/+80、good −140/+160；drag ±120；hold 200–600；
    arc 普通 200 / 关键 80。调手感优先动**空间体积**，不动这些毫秒数。

---

## 4. 代码地图

| 路径 | 职责 |
| --- | --- |
| `src/main.ts` | 游戏入口：渲染器 / 相机 / XR 会话 / 主循环 |
| `src/config.ts` | 台面参数、派生几何 |
| `src/chart/` | `schema` / `timeline`（SV 积分、shift、校验）/ `easing` / 示例谱 / 验收谱 |
| `src/game/` | `player` / `judgement` / `scoring` / `arc` / `hands` / `shatter` / `popup` / `trace` |
| `src/audio/` | `clock`（AudioContext 主时钟）/ `track`（合成鼓组）/ `metadata` / `spectrogram` |
| `src/pack/` | `.parallax` 容器 `format` / `io` / 浏览器本地包 |
| `src/scene/` | `table` / `notes` / `display` / `backdrop` / `background/` / `controllers` / `comboHud` |
| `src/lab/` | 背景实验台（`bg-lab.html`） |
| `src/materials/` | 材质库 / `palette` / 程序化贴图 / `glow` / `distanceFade` / `environment` |
| `src/ui/` | `vrPanel` / `gameUi` / `debug` / `diagnostics` |
| `src/editor/` | 制谱器：`main` / `timelineView` / `interaction` / `inspector` / `preview` / `persistence` / `waveform` / `spectrum` / `overview` / `arcEdit` / `model` |
| `index.html` / `editor.html` / `bg-lab.html` | 游戏页 / 制谱器页 / 背景实验台（Vite 多页） |

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
| 0.4.0 | 自由拍号（n/d + SNAP 自适应）；trace + arc↔trace + 3D 手柄；结算评级（EQV）；双押连线；检查器折叠 |
| 0.4.1 | 程序化 3D 背景；FEEL-04 细棒单独取代失败后回退；难度 legacy 字符串清空 |
| 0.4.2 | 手掌盒 + 细棒都认；手掌盒 / arc 收紧 |

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
- **背景预设会被调**：所以包内写展开参数，不存 preset id；否则两年后同一个包会长得不一样。
- **天空球与相机 far**：天空球 R=320，相机 `far` 必须 ≥ 320（现在 400）；否则背景被裁。

---

## 7. 已知问题 / 限制

### 游玩 / 音频

- **手感结论（2026-10-26 头显，已验收）**：细棒单独取代手掌盒不行（miss 变多）；最终默认
  **手掌盒 + 细棒都认**，手掌盒收紧（x ±0.12 / y ±0.20 / z 0.16–0.32），
  arc 半径 0.16 / BAND_ZONE 0.30；`?hitrod=0` 可关细棒。用户反馈「很可以了」。
- 暂停时长按扳机再松手，可能顺带触发一次 UI 点击（面板与判定共用「按下」）。
- 手追踪未支持；控制器优先。
- 72Hz+ 是 Quest 3 实测，但没有自动帧时间回归测试。

### 校准 / 设置（暂缓）

- **UI-03 收窄（2026-10-26）**：offset 试听、身高校准 / 站姿、左右手选择、设置持久化**暂缓**；
  当前仍用手动 Settings + `?offset=` / `?band=` 调试参数。

### 制谱器

- 音频 / 封面文件不持久化到草稿（会进 `.parallax` 包）。
- 慢放 / 倒放静音（AudioContext 不能倒退）。
- 多选只覆盖 note；arc 顶点仍单点编辑。
- 没有框选 / 复制粘贴 / 自动 BPM 检测 / section 编辑。
- 3D 里 arc 点的时间仍要在 2D / 检查器改。
- 预览窗口比头显视场窄；它验证谱面，不验证视场。
- **tier 选择器 / 徽章未做**：`meta.difficulty` 仍是自由字符串（legacy `IN n` 已清空）。

### 背景

- 只实现三个 `procedural.*` 节点；`scene.json` 加载器、`gltf` / `text` / `image` 节点、
  时间线与音频参数运行时**未做**，推迟到 Unity 项目开始（见 [`BACKGROUND.md`](BACKGROUND.md) / [`FUTURE.md`](FUTURE.md) §0.6）。

### 包 / 工程

- 一包一谱；不压缩 / 加密 / 签名；主题文件被携带但游戏未消费。
- Infinity Heaven 包 18.4MB，其中 `chart.json` 只有 8KB；每次导出都重写整包。
- **没有自动化测试 / CI**；验证靠 `typecheck` / `build` + CDP 手动脚本。

---

## 8. 下一步

### 现在（Infinity Heaven 期间）

- **完成初谱**（未完成）；记录最卡手的前 3 个步骤。
- 手感已确认；小修按优先级：**游玩 UI 剩余 → 制谱流程小修**；
- 每次小修后跑 `typecheck` + `build` + 一张谱 smoke test。

### 初谱完成后

1. **5–8 人外部试玩**（Quest 3），录屏，不指导；
2. **CI + golden tests**（新增待办；先做 typecheck / build，再抽运行时契约；谱面校验留在制谱器）；
3. **Unity vertical slice**（2 周 timebox）或继续 Web，按验收决定；
4. 背景的 glTF / 时间线 / 音频参数运行时随 Unity 一起做。

### 明确不做（现在）

- UI-03 的 offset 试听 / 身高校准 / 站姿 / 设置持久化；
- glTF 背景、时间线运行时（等 Unity 项目开始）；
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
- 2026-10-26 压缩：把 10-20 起的过程日志并成一张「压缩日志」表；逐条差异交给
  [`../CHANGELOG.md`](../CHANGELOG.md) 与 git。
- 本文只保留仍会影响后续开发的状态、契约、结论和坑。
