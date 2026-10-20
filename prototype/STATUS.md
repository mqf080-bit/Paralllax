# prototype / STATUS

> 更新：2026-10-20 ｜ 版本：**0.3.11** ｜ 阶段：**Phase 1 完成；Phase 2 未启动**
> 当前个人进度：**Infinity Heaven 初谱制作中**（用户估计约 1 周）；期间只做小修。
> 设计真相：[`../parallax-idea.md`](../parallax-idea.md) ｜ Phase 1 旧协议：[`../agent_old.md`](../agent_old.md)（**OLD / 已归档**） ｜ 后续架构：[`FUTURE.md`](FUTURE.md)
> 完整逐轮历史（55 节 / 90KB）在 git：`git show ad37349:prototype/STATUS.md > /tmp/parallax-status-full.md`。本文件是 2026-10-20 的压缩版。

---

## 0. 现在看这里

| 问题 | 答案 |
| --- | --- |
| Phase 1 | ✅ 完成并验收（Step 0–5，2026-10-19） |
| 现在能玩 | 41.6s 测试谱、示例谱、本地 Infinity Heaven 包；桌面 fallback + Quest 3 |
| 当前在做 | **Infinity Heaven 初谱**，不是代码重构 |
| 性能 | Quest 3 实测 **72Hz+**；没有自动帧时间回归测试 |
| 构建 | `typecheck` / `build` 通过；没有自动测试 / CI |
| 下一步 | 完成初谱 → 小修 → 外部试玩 → golden tests → Unity spike |

### 2026-10-20 当前焦点

- 完成个人初谱 **Infinity Heaven**，同时摸索制谱流程；
- 期间可能做的小修：
  - **arc**：更多曲线过渡；
  - **游玩 UI**：P0–P2 流程 / 选歌 / 视觉已做；余下准备页与 Quest 3 验收；
  - **VR panel**：小幅扩展。
- 约束：保持 v0.3.11 可玩；**不启动 Unity / 资源库 / 大重构**；每次小修只碰一个面。
- 游玩端 UI 问题已单独记录：[`UI-BACKLOG.md`](UI-BACKLOG.md)（入口 / 选歌 / 暂停层级 / 激光误触 / 视觉方向）。
- **设计实验工作流**：外观 / 版式没定时可以先在 `design/` 做干净夹具，但移植后主代码是唯一事实来源，必须在头显 / 真实视口验收；见 [`DESIGN-WORKFLOW.md`](../DESIGN-WORKFLOW.md)。
- **P0 UI 已实现（2026-10-20）**：进 VR 先到主页、`START` 才播放；游玩中无常驻按钮；暂停 / 设置分层；左手 menu 或 Y 长按暂停。待 Quest 3 头显验收。
- **P1 A 第一版（2026-10-20）**：面板拉近、现代石墨 + 浅蓝主强调 / lime 稀有状态；主页 / 暂停 / 设置各 5 行；新增 Songs 面板与「如何加包」提示。待头显验收；多曲切换未做。
- **P2 布局重做（2026-10-20）**：去圆角；主页双栏、Songs 可选列表 + 详情、Pause / Settings / Result 双栏；可切换内置谱并重建播放器 / 音频 / 浮空显示；Add packs 二级页。待头显验收。
- **2D UI Study（2026-10-20）**：[`design/ui-2d/`](../design/ui-2d/) 先用网页试 A + C 的排版 / 浅蓝 / lime / 密度；六个界面可切换，截图在 `docs/ui-2d/`。
- **VR 复刻 2D Study（2026-10-20）**：760×470 六屏按二维稿重排；标签 10–11px / 正文 12–13px / 按钮 16px，2× 纹理；chart map / density 来自真实谱面。截图在 `docs/ui-vr2/`。待 Quest 3 验收。
- **面板距离 / 尺寸（2026-10-20）**：1.55m 宽 × 0.959m 高，距离 1.35m、中心高 1.44m；优先保证聚焦距离，水平视角约 60°。可用 `?panelScale` / `?panelDistance` / `?panelY` 在头显里继续调。
- **包索引 / 懒加载（2026-10-20）**：`public/packages/index.json` 在启动时只读元数据，选中条目后才下载 `.parallax`；Infinity Heaven / Air / Ticks 会直接出现在 Songs。

---

## 1. 现在能跑什么

| 区域 | 状态 | 说明 |
| --- | --- | --- |
| 台面 | ✅ | 0.95m 平面；6 轨物理场 / 4 轨窗口；隐藏轨几何不存在 |
| 键型 | ✅ | hit / drag / hold / arc；hit 有 GOOD，其余只有 PERFECT / MISS |
| 判定 | ✅ | 只看时间：hit ±80 / ±160ms；drag ±120ms；hold tick 200–600ms；arc 普通 200ms / 关键 80ms |
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
| 台面高度 / 轨宽 / 进深 | 0.95m / 0.23m / 10m |
| 判定带 | z = −0.21m（距玩家约 0.55m） |
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

- 音频听感未在头显内主观验证；偏早 / 偏晚用设置里的 `AUDIO OFFSET` 微调。
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
