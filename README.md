# Parallax

VR 3D 音游的 WebXR 原型。玩家站在腰高的台面前，note 从远处沿 6 条轨道滑来，用手接住；
台面只点亮其中 4 条轨，**窗口会随谱面整体左移 / 右移一轨**（shift）。

> 设计真相：[`parallax-idea.md`](parallax-idea.md) ｜ 施工协议：[`agent.md`](agent.md) ｜ 迭代记录：[`prototype/STATUS.md`](prototype/STATUS.md) ｜ 谱面格式：[`prototype/CHART.md`](prototype/CHART.md)

---

## 进度（2026-10-18）

| Step | 内容 | 状态 |
| --- | --- | --- |
| 0 | Quest 3 打开并进入 WebXR | ✅ |
| 1 | 台面 / 材质 / 光照 / 布局 | ✅ 台面最终是**一层平面** |
| 2 | 四种键型 + 判定 | ✅ |
| 3 | shift（4 轨窗口整体滑动） | ✅ |
| 4 | 谱面播放 / 流速 / 渲染裁剪 / 音频 / UI | ✅ 只剩「72fps 实测」未记录 |
| 5 | **简易制谱器** | ⬜ **下一步** |

已经能完整打一首 41.6 秒的谱（两次 shift、四种键型、SV 变速），有计分、血条、结算、暂停和设置。

---

## 现在能玩到什么

### 台面

- 腰高 **0.95m** 的平面，6 条轨（单轨宽 0.23m，进深 10m）；只有窗口内的 4 条会渲染，
  隐藏轨在几何上**真的不存在**（不是被暗板盖住）。
- 0 / 5 进入窗口时比常住的 4 轨暗一档 —— 「没点亮」的状态本身可读。
- 判定带固定贴在台面上（近端内 0.55m），note 从远处滑过它。

### 四种键型与判定

判定**只看时间**（毫秒），与流速、SV、帧率无关：

| 键型 | 窗口 | 等级 | 动作 |
| --- | --- | --- | --- |
| hit | perfect ±80ms / good ±160ms | PERFECT / GOOD / MISS | 扫过并达到速度 + 位移 |
| drag | ±120ms | PERFECT / MISS | 扫过即可（要一点手速） |
| hold | 每个物量 200–600ms（按密度） | PERFECT / MISS | **按住扳机 / 侧握**贴在片子上 |
| arc | 普通物量 200ms；关键物量（黄铜珠）80ms | PERFECT / MISS | 手沿着弧走 |

drag / arc / hold 没有 GOOD：接上物量就算完美，接不上就是漏。

### 谱面与播放器

- 格式 v0（`prototype/src/chart/`）：`meta` / `timing` / `sections` / `speed`(SV) / `shift` / `notes` / `limits`。
- **位置 = 判定带 − ∫速度 dt**：SV 为 0 时 note 停住、负数时倒流，判定不受影响。
- arc 用点列 + 每段缓动记录形状（连续 linear 段 = 直角 / 钝角，sine / cosine = 曲线），可带关键物量。
- 默认测试谱 `src/chart/test.ts`：**41.6s / 79 notes**，12s 左 shift、30s 右 shift，两处 SV（慢速 / 200ms 停表）。
- 格式示例 `src/chart/demo.ts`：12s，`?chart=demo` 切回。

### 音频时钟

- 谱面时间的权威是 **`AudioContext.currentTime`**（含输出延迟补偿），不是逐帧累加的 dt。
- 起播留 **2s lead-in**（谱面时间为负，note 从远处滑进来）；`meta.offset` = 玩家校准量。
- 没有音频资产：按 `timing` **现场合成鼓组 + 贝斯**（和谱面共用同一张 timing，天然对拍）。
  想听真曲子：文件放到 `prototype/public/`，用 `?audio=/track.mp3`。
- 暂停 / 恢复会重打锚点，谱面时间不跳。

### 计分 / UI

- 总分 **10,000,000**，按物量等比分配（PERFECT 100% / GOOD 60% / MISS 0），连击只作反馈。
- 血量 100：PERFECT +0.5、GOOD +0.25、MISS −6，归零 = FAILED。
- 浮空显示：曲名 / 难度 / 物量数 / 分数 / COMBO / 血条，绑定在窗口右缘、跟着 shift 走。
- 3D 面板：`SETTINGS` / `PAUSE` / `RETRY`；设置里有流速、音频偏移、音量。
  交互是**激光笔（扣扳机）**或直接伸手戳。

### 渲染裁剪

- note 只在判定带前 **9m** 内渲染，最后 4m 渐显；远处不会「凭空出现」。
- 高度上限 **0.81m**（相对台面，= 头顶基准线），超限的 note 不生成。

---

## 跑起来

```bash
cd prototype
npm install
npm run dev
```

浏览器打开 <http://127.0.0.1:5173>（桌面 fallback 也能玩：鼠标 = 手，左键 / 空格 = 扳机）。

### Quest 3

WebXR 要求 secure context，所以 **`localhost` / `127.0.0.1` 才行**，局域网 IP 不算。
用 USB + `adb reverse` 把端口映射进去：

```bash
adb devices -l
adb reverse tcp:5173 tcp:5173
cd prototype && npm run dev
```

在头显浏览器里打开 <http://localhost:5173>，点 **ENTER VR**。
（WSL / 无线 / 隧道的细节见 [`prototype/README.md`](prototype/README.md)。）

## 操作

| 做什么 | 怎么做 |
| --- | --- |
| 打键 | 手扫过判定带；hold 要按住扳机 / 侧握 |
| 打 arc | 手跟着弧走；黄铜珠是关键物量 |
| 点 UI | 手柄指向面板扣扳机，或直接戳 |
| 暂停 / 重试 / 设置 | 右前方 `SETTINGS / PAUSE / RETRY`（播放时压暗到 30%） |

首次进 VR 会自动开始（2 秒数拍）。打完或血量归零出结算。

## 调试参数（dev）

| 参数 | 作用 |
| --- | --- |
| `?chart=demo` | 切回 12s 示例谱 |
| `?auto=1` | 自动演示（只是贴着目标点，不保证全接） |
| `?warp=12.4&freeze=1` | 快进到第 12.4 秒并冻结（截图 / 检查用） |
| `?flow=4` | 基准流速 m/s |
| `?range=6` | 视距（米，从判定带算） |
| `?panel=settings` `?panel=result` | 直接摊开面板 |
| `?clock=0` | 关掉音频时钟（无头截图用） |
| `?aim=1&aimTarget=pause&click=1` | 假手验证激光笔 |
| `?offset=20` `?volume=0.6` `?lead=2000` `?metronome=1` `?audio=/track.mp3` | 音频 |
| `?maxheight=0.5` | 临时压低高度上限，验证「超限不生成」 |
| `?shift=left` `?cam=` `?look=` `?exposure=` `?env=` | 场景调试 |

## 仓库结构

```
parallax-idea.md     设计真相（判定、键型、shift、配色、材质隐喻）
agent.md             施工协议（每一步做什么、验收、不做什么）
references/          空间 / 材质参考
prototype/
  src/
    chart/           谱面格式、时间轴（SV 积分 / shift / 小节）、示例谱、验收谱
    game/            播放器、判定、计分、arc、hold/drag、手、粒子、弹字
    audio/           音频时钟、程序化节拍轨
    scene/           台面、浮空显示、材质实验台、控制器
    materials/       材质库、配色、程序化贴图、视距淡出
    ui/              3D 面板、游戏内 UI、调试面板、诊断
  CHART.md           谱面格式说明
  STATUS.md          迭代记录（每轮改了什么、为什么、踩了什么坑）
  README.md          原型自己的运行 / 链路说明
```

## 已知问题

- **72fps**：还没在头显里实测（桌面无头渲染的帧率没有参考价值）。
- **音频**：调度路径验过（`playing · 16–24ms`），但「听感对不对」需要戴上去确认；
  偏早 / 偏晚用设置里的 `AUDIO OFFSET` 微调。
- 自动演示会漏键（它只是贴着目标点），手动打不受影响。
- 暂停时长按扳机再松手，可能顺带触发一次 UI 点击（面板和判定共用「按下」）。

## 下一步：Step 5 制谱器

按 `agent.md`：桌面 2D 编辑器 —— 放 / 删 / 移 note、设 shift 与 SV、用真实播放器预览、
存读 JSON。高度基准线（胸 0.33 / 面 0.61 / 头顶 0.81）会作为编辑视图里的辅助线出现，游戏里不画。
