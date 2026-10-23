# FUTURE — 玩法 / 编辑器 / Unity 计划

> 2026-10-23 ｜ 近期玩法 / 编辑器计划见 §0；Unity 与资源库见 §1 以后。
> 结论先写：**Web 编辑器继续作为制谱工具；Unity 负责最终画面；单文件 `.parallax` 保留为便携快照，日常工作区改为「谱面 + 资源引用」。**

---
## 0. 近期玩法 / 编辑器计划（2026-10-23）

> 状态：§0.5 Combo HUD、§0.2 评级、§0.3 自由拍号已实现；§0.1 只差结构化字段与徽章。
> 还剩 §0.4 Trace。顺序按“低风险、先解锁内容”排列。

### 0.1 难度 tier 与主题色

现状：

- `parallax-idea.md` 已定义五个 tier：**Stabilized / Accelerated / Ballistic / LINAC / CYCLOTRON**；
- **2026-10-22**：编辑器新谱默认难度已改为空（不再写 `IN 1`），作者显式填写；
- `meta.difficulty` 目前仍是自由字符串；tier 主题色**已定稿**（见下），但 UI 还没实现。

计划（未做部分）：

- 数据层保留 `meta.difficulty` 兼容旧谱，同时增加结构化字段：
  `difficultyTier?: 'stabilized' | 'accelerated' | 'ballistic' | 'linac' | 'cyclotron'` +
  `difficultyLevel?: number`（或 `meta.difficulty: { tier, level }`，二选一）。
- tier 主题色 token 用于 **Songs 徽章 / 曲目卡细边 / Result 评级 / 检查器**，不做大面积背景；
  颜色必须通过对比度检查，且始终同时显示 **tier 名 + 数字**，不靠颜色单独编码。

**已定稿的 tier 主题色**（完整动效说明见 [`../parallax-idea.md`](../parallax-idea.md) §3）：

| tier | 颜色 | 色值 | 动效 |
| --- | --- | --- | --- |
| Stabilized | 钢灰 | `#A9B4C2` | 静态 |
| Accelerated | 绿 | `#6EE7A0` | 呼吸 |
| Ballistic | 琥珀 | `#FFB45C` | 警报式闪烁 |
| LINAC | 荧光粉 / 洋红 | `#FF5CC8` | 自发光 |
| CYCLOTRON | Wien ∞ K 蓝 | `#7F9FFF` | 更亮的自发光；选歌界面除封面外元素饱和度稍降 |

- 旧谱的 `IN 7 / IN 8` 视为 legacy 字符串；迁移时再映射，不能猜成某个 tier。

验收（未做部分）：

- 选择 tier 后 Songs / Home / Result 的徽章和主题色同步；
- tier 与 level 是独立信息；CYCLOTRON 不自动等于高数值。

### 0.2 成绩评级与字体

**已实现（2026-10-23）**：Result 右栏顶部是评级锁版，阈值与命名都定稿了。

| 区间 | 评级 | 记号 | 词源 |
| --- | --- | --- | --- |
| < 80% | `D` | — | — |
| 80–85% | `C` | — | — |
| 85–90% | `B` | — | — |
| 90–95% | `A` | — | — |
| 95–97% | `APX` | `≈` 两波 | approximate |
| 97–98% | `ASM` | `≃` 一波一横 | asymptotic |
| 98–99% | `CGR` | `≅` 一波两横 | congruent |
| 99–100% | `EQV-` | `≡` 三横 | equivalence |
| 恰好 100% | `EQV` | `≡` 三横 | equivalence |

- 准确率 = `(perfect + 0.6 × good) / 总物量`；总分按同权重分配，所以**分数百分比与准确率一致**，只有一套阈值。
- 健康归零仍是独立的 `FAILED`，不并入 `D`；FAILED 时状态条变红、评级仍按准确率取（通常是 D）。
- **命名**：`APX / ASM / CGR / EQV`。`IDN`（identical）已弃用——三条杠 + IDN 硬朗的字形容易被读成 IDF 宣传风格。
- **锁版几何**（`design/grade-lab/lockup.js` 与 `gameUi.ts` 的 `drawGradeLockup` 同一套）：
  符号与字同宽（取字母包围盒，各收 0.75 描边做视觉修正）；描边 = 字干（11.5% cap）；
  记号底边离 cap line 16% cap；波浪之间 5% cap，波浪到横线 / 横线之间 5.5% cap（都量墨迹）；
  波纹振幅 7.5% cap。整枚记号压在字的上方。
- **Result 排版**：左栏 = 分数 / 曲名 / MAX COMBO / 准确率 / 物量 / 难度 / 判定条 / 按钮；
  右栏 = 评级锁版 + PERFECT / GOOD / MISS + GOOD TIMING。CLEAR / FAILED 是 27px 大字。
  分数 46px 等宽顶格，评级 cap 52——评级更“重”，但分数仍是第一个信息。

待办：

- **字体本身还没做**：现在用的是 UI 字体（800 字重、负字距），独立 display 字 / 窄体 / 纸面方向都没出样张；
  这是 §0.2 里唯一还没动的大项。
- 动效：波纹收拢 / 评级跳变都还没做；只做了静态锁版。
- 需要覆盖的状态：FAIL、低分、满分、长标题、小屏 VR 面板——后两个还没验。
- 曾被考虑但未采用：`S / SS / EX / EX+`；词表（公差 `FINE…`、相位锁定 `SYNC…`、能量 `MeV…`、
  计量标准、光圈 f 值、授时 `QUARTZ…`、雷达 `PAINT…`、化学纯度、视差重合）；
  符号体系（占星相位、炼金金属、视差角秒、秘仪词、卡巴拉四世界、光谱项、自绘视差环）。

验收：

- 1.35m 面板距离下，评级在 1 秒内可读出；
- 评级不依赖颜色（有字母 / 形状）；
- 评级与 tier 主题色不冲突；不改计分公式。

### 0.3 自由拍号与动态小节

**已实现（2026-10-23）**。`TimingPoint` 增加 `numerator` / `denominator`，旧的 `beats`
保留为 `n/4` 兼容写法。

- **BPM 以四分音符为参照**：`bpm=150` 时四分音符恒为 400ms，和拍号无关。
  一拍 = `(60000 / bpm) × (4 / denominator)`，小节 = 一拍 × `numerator`。
  `5/6` @150 → 一拍 266.67ms、小节 1333.33ms；分母不要求是 2 的幂，`4/3` 也能写。
- **换段不平滑**：每个 timing 点从自己的 `time` 重新起拍，段与段之间不插值——
  和 AFF 的 `timing` 语义一致。
- **小节编号连续累加**：`barBeat()` 返回的是从谱面开头算起的绝对小节号，
  换拍号不会回到 1；编辑器顶部的小节号、状态栏的 `N/D · BAR n` 都用它。
- **编辑器**：检查器每个 timing 点有 `N / D` 输入；网格线按所在段的拍号生成
  （小节 / 拍 / 细分三档亮度不变）；状态栏实时显示播放头所在拍号和小节。
- **音频**：`collectBeats` 按拍号切拍，节拍器重音落在每小节第一拍；
  鼓组改为拍号感知（>=3 拍时中点补底鼓，>=4 拍才在 2 / 4 拍加小鼓），
  `5/6` 这类分母拍不会被塞成 4/4 的节奏。
- **兼容**：旧谱只有 `beats` 时按 `beats/4` 读；两个字段都在时忽略 `beats`；
  `validateChart` 会检查分子 / 分母是正整数。

仍未做：

- **弱起 / pickup**（小节第一拍之前的部分）没有专门表达，只能把 timing 点放在弱起结束处；
- 小节内换拍号本身已经可以（timing 点写毫秒就行，残小节保持编号、下一段接着下一个编号），
  但**残小节没有可视化标记**——编辑器里看不出“第 2 小节只有 2 拍”，只能靠位置判断；
- 新增 timing 段时的拍号快捷项（`4/4`、`6/8` 一键插入）还没有，只有两个数字输入。

验收：

- 同一张谱里能写 `4/4 → 5/6 → 3/4`，小节线、拍线、小节号在切换处都对；
- 合成鼓组 / 节拍器的重音落在新拍号的第一拍；
- 旧谱打开、导出不丢 timing。

### 0.4 Trace / 引导线

**已实现（2026-10-23）**：

- 数据：`chart.traces[]`，独立于 `notes`；每点 `time / x / z / easing / easingZ`；
- 运行时：`src/game/trace.ts` 细线 + 加色混合，前后各留淡出窗口，排在 note 之下；
  不参与判定 / 计分 / 血量 / 回收（`countObjects` 只数 notes）；
- 编辑器：`TRACE` 工具（2D / 3D 落点、追加到当前 trace）、检查器 `TRACE` 段
  （选 trace、改点、删点、`ADD @ PLAYHEAD`）、2D 总览画虚线区间；
- 可见性：`?traces=0` 关闭显示，数据不变。

- **贴着曲线放 note**：2D 里 HIT / DRAG / HOLD 靠近 arc 或 trace 时，落点取曲线在该时间的
  x / z（0.45 轨阈值）；
- **arc ↔ trace 互转**：arc → trace 保留形状、丢掉 hand / 物量；trace → arc 默认右手、
  物量按自动规则生成。

仍未做：

- 3D 里贴着曲线放 note（现在只有 2D 会吸附）；
- 3D 里拖动 trace 的点（只能改检查器数值 / 重新落点）；
- 选中 / 命中优先级（trace 线和 arc 抢点击）——trace 目前不可点选。

验收：

- 有 trace 的谱面，物量 / 分数 / 判定与无 trace 完全一致；✅
- trace 在游戏里能看清，但不遮挡 note；✅
- 编辑器中可在 trace 任意点放置 note。✅（2D 吸附；3D 未做）
- 关闭 trace 显示后，不影响任何编辑数据。✅（`?traces=0`）

### 0.5 游玩时 Combo HUD ✅ 已实现（2026-10-22）

已落地（[`src/scene/comboHud.ts`](src/scene/comboHud.ts)）：

- 独立 Sprite，世界固定在轨道上方 `(0, 1.80, −2.60)`；不跟头，不做头锁 HUD；玩家贴近时淡出；
- 大数字（mono）+ 小 `COMBO` 标签；数字变化时轻微脉冲；0 时隐藏，MISS 快速淡出；
- 不参与计分；浮空显示里的 `COMBO n` 保留为信息板的一部分；
- CanvasTexture 只在 combo 变化时重绘；
- `?comboY` / `?comboZ` 可在头显里微调位置。

仍待定（不阻塞）：是否显示 max combo、是否在结算页保留一个静帧。

验收：

- 1.35m 面板距离下，看判定带时不用转头就能看到 combo；
- 不挡 note / arc / 判定线；
- 命中 / MISS 后立即更新；72fps 不掉。

### 0.6 建议顺序

1. ~~游玩 Combo HUD~~ ✅ 2026-10-22；
2. ~~评级阈值 / 命名 / Result 排版~~ ✅ 2026-10-23；剩**评级字体**（独立 display 字，样张未做）；
3. ~~自由拍号 / 动态小节~~ ✅ 2026-10-23；剩弱起 / 小节内换拍 / 拍号预设菜单；
4. 难度 tier UI（默认 `IN` 已去掉 ✅ 2026-10-22；主题色已定稿，剩结构化字段与徽章）；
5. Trace / 引导线（会改 schema、编辑器、渲染）。

timing 与 trace 都需要谱面格式迁移，先冻结当前 v0 行为，再开新版本。

---


## 1. Unity 时代的 3D 预览

### 1.1 不要把 Unity 的视觉搬进 three.js

现在编辑器里的 3D 预览和游戏播放器共用一套 Three.js 运行时。未来 Unity 会有更复杂的材质、背景、粒子、后处理；
如果继续在 Web 里复刻，会变成第二个渲染器，永远追不上。

建议把预览分成三层：

| 层 | 负责 | 是否必须和 Unity 一致 |
| --- | --- | --- |
| 玩法层 | note / arc 位置、SV、shift、判定窗口、时间 | **必须** |
| 关卡舞台层 | 背景、光照、相机、材质、特效 | **不要求**，只做代理 |
| 最终画面 | Unity 场景 / 后处理 / VR 舒适度 | Unity 独占 |

编辑器每天使用的是**玩法层 + 轻量舞台代理**，不是 Unity 画面。

### 1.2 共享玩法契约

把「影响手感和判定的东西」抽成版本化契约，而不是两套实现各写一遍：

- 时间单位 ms；
- `x` / `z` / `lane` 坐标；
- 台面高度、判定带 `bandZ`、note 尺寸；
- `z = bandZ - (S(arrive) - S(now)) × flowSpeed / 1000`；
- SV 积分 / 缓动、arc 采样、hold / arc tick 规则；
- shift 窗口与过渡。

建议放一份 `runtime-contract.md` + 一组 golden chart（固定谱面 + 固定时间点的期望位置 / 判定结果），
Web 预览和 Unity 各自跑测试，结果必须一致。

如果以后 Unity 侧逻辑复杂到两边难以同步，再把核心编译成 WASM / native library 给两边共用；
现阶段不值得。

### 1.3 舞台 manifest

给每张谱一个可选的舞台描述，而不是把 Unity 场景写死在代码里：

```json
{
  "stage": {
    "id": "infinity-heaven",
    "unityScene": "Assets/Stages/InfinityHeaven.unity",
    "preview": {
      "background": { "kind": "image", "asset": "sha256:..." },
      "fog": "#05060a",
      "camera": { "position": [0, 1.62, 0.52], "target": [0, 0.95, -1.4] }
    }
  }
}
```

- 编辑器只消费 `preview`：图片 / 视频 / 纯色 / 简单雾，够看构图和节奏即可；
- Unity 消费 `unityScene` / prefab / Addressables，真实背景和特效全在 Unity；
- 新增背景效果时，编辑器不需要改代码，只要支持新的 preview kind（或先降级为纯色）；
- `preview` 可以是低分辨率代理，不进入最终包。

### 1.4 需要看真实画面时

按成本从低到高：

1. **编辑器低模预览**（日常）——只保证玩法可读；
2. **Unity 远程预览**（推荐）——编辑器通过 WebSocket 把 `chart.json` + 时间 / 播放状态发给
   Unity standalone / Quest 构建；Unity 渲染，编辑器只控制走带。视觉一致，且不把 Unity 塞进浏览器；
3. **Unity WebGL 嵌入编辑器**（不推荐日常用）——包体大、加载慢、输入 / 音频 / WebXR 都麻烦，
   只适合偶尔截图。

### 1.5 Unity 导入链路

- Unity 端实现 `.parallax` / library 的 importer；
- 编辑器导出到 Unity 监听的目录，Unity 自动 reimport + 刷新当前谱面；
- 传送门：`Open in Unity` 按钮，带谱面路径和当前 playhead；
- 这样编辑器更新谱面，Unity 不需要重启。

---

## 2. 谱面包与共享资源

### 2.1 现在的问题

`infinity-heaven.parallax` 是 18.4MB，其中：

- `chart.json` 只有 8KB；
- FLAC 18.2MB；
- 封面 257KB。

单文件包每次改一个 note 都要重写 18MB，这在迭代期很低效。

### 2.2 三个层级

| 形态 | 用途 | 是否包含资源 |
| --- | --- | --- |
| **Workspace / 工作区** | 编辑器日常保存 | 只存谱面 + 资源引用 |
| **Standalone `.parallax`** | 发给别人 / 离线试玩 | 自包含快照 |
| **Library / 资源库** | 多张谱、共享背景 / 音频 | 资源只存一份 |

不要把「工作区」和「发行包」继续混成一个文件。

### 2.3 工作区布局

```text
project/
  project.json
  charts/
    infinity-heaven.json
  assets/
    audio/<sha256>.flac
    cover/<sha256>.jpg
    background/<sha256>.webp
  library.json
```

- 谱面引用**内容哈希**，不引用绝对路径；
- 资源不可变：改背景 = 新哈希，旧谱面仍可指旧版本；
- 保存一个 note 只写几 KB 的 chart JSON；
- 编辑器用 File System Access API 访问目录；不支持时退回 IndexedDB + 导入 / 导出 zip。

### 2.4 Library 索引

```json
{
  "version": 2,
  "assets": {
    "sha256:aaa...": { "path": "assets/audio/aaa.flac", "mime": "audio/flac", "size": 18199150 },
    "sha256:bbb...": { "path": "assets/background/bbb.webp", "mime": "image/webp", "size": 1200000 }
  },
  "charts": {
    "infinity-heaven": {
      "chart": "charts/infinity-heaven.json",
      "assets": {
        "audio": "sha256:aaa...",
        "cover": "sha256:ccc...",
        "background": "sha256:bbb..."
      }
    }
  }
}
```

- 多张谱共用背景：只保留一份 asset；
- 更新一张谱：只改 `charts/...json` 和 `library.json` 的 chart 条目；
- 更新共享背景：新增哈希，想升级的谱面改引用；不想动的谱面继续用旧哈希；
- 资源可以放本地目录、HTTP、Unity Addressables，索引格式不变。

### 2.5 外部索引的取舍

**要外部索引，但要有 fallback：**

- 迭代 / 在线发行：library + 外部资源，HTTP 缓存 / Addressables 去重；
- 单文件 `.parallax`：仍然保留，作为便携、离线、分享的「快照」；
- 不要只做外链：断链、CORS、文件移动都会让谱面不可玩；
- 单文件包可以引用外部资源，但导出时必须能选择「bundle 全部资源」生成自包含版本。

### 2.6 大背景 / 视频

- 不要塞进每次编辑的 chart 写入路径；
- 编辑器只用 `preview` 低清代理（图片 / 低码率视频）；
- Unity 用完整资源，走 Addressables / 本地库；
- 需要流式加载时，库索引里给 URL + hash + size，Unity / Web 各自缓存。

### 2.7 压缩与版本

- 单文件可以用 zip / zip64：JSON deflate，FLAC / 视频 store（已经压缩）；
- `.parallax` v1 读取器永久保留；v2 增加 library / asset 引用；
- 包 / 库 / 谱面各自有版本号，导入时做迁移；
- 资源哈希做完整性校验。

---

## 3. 建议的推进顺序

1. **冻结当前 v1 `.parallax`**：作为 Portable Snapshot，不再往里塞复杂资源逻辑；
2. **抽玩法契约 + golden tests**：Web 与未来 Unity 共用；
3. **编辑器加工作区**：资源缓存 + chart-only 保存 / 导出；
4. **加 library 索引**：多谱、共享背景、按哈希去重；
5. **Unity importer + Addressables**：读 `.parallax` 和 library；
6. **Unity 远程预览**：需要看真实画面时再接，不阻塞日常制谱。

日常路径应该是：

```text
编辑器保存 chart.json（KB 级）
  → Unity 监听目录热重载
  → 需要分享时才 build 成 .parallax（MB 级）
```
