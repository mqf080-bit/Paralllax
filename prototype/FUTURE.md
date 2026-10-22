# FUTURE — 玩法 / 编辑器 / Unity 计划

> 2026-10-22 ｜ 近期玩法 / 编辑器计划见 §0；Unity 与资源库见 §1 以后。
> 结论先写：**Web 编辑器继续作为制谱工具；Unity 负责最终画面；单文件 `.parallax` 保留为便携快照，日常工作区改为「谱面 + 资源引用」。**

---
## 0. 近期玩法 / 编辑器计划（2026-10-22）

> 状态：**记录为主**；§0.5 Combo HUD 已于 2026-10-22 实现，其余仍未开工。
> 顺序按“低风险、先解锁内容”排列；timing 会改谱面格式，放后面。

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

现状：Result 只有分数、Perfect / Good / Miss 和 early/late，没有字母 / 等级评级。

**阈值已定（2026-10-22）**，按准确率百分比：

| 区间 | 评级 |
| --- | --- |
| < 80% | `D` |
| 80–85% | `C` |
| 85–90% | `B` |
| 90–95% | `A` |
| 95–97% | 待定（见下） |
| 97–98% | 待定 |
| 98–99% | 待定 |
| 99–100% | 待定 |

- 准确率 = `(perfect + 0.6 × good) / 总物量`；因为总分也按同权重分配，**分数百分比与准确率一致**，不需要两套阈值。
- 健康归零仍然是独立的 `FAILED`，不并入 `D`。

计划：

- **方向已定（2026-10-22）**：95% 以上用「三字母简写 + 数学同一性符号」的锁版。
  样张在 [`../design/grade-lab/`](../design/grade-lab/)：每个符号单独一页，符号是自绘 SVG，
  波纹逐级消失（`≈` 两波 → `≃` 一波一横 → `≅` 一波两横 → `≡` 三横），不依赖字体覆盖。
- **锁版规则**：符号与字同宽（取字母实测包围盒，再收半个描边做视觉修正）、描边 = 字干
  （cap height 的 11.5%）、记号底边离 cap line 0.16 cap；行距一律量**墨迹间隙**
  （波浪间 10%、波浪到横线 5%、横线间 3.5%），波纹振幅 9.5% cap。
  默认摆法是「整枚记号压在字上方」。
- 恰好 100% 记为 **`IDN+`**（`IDN` 覆盖 99–100%，`IDN+` 只在满分时出现）。
- 字母词表待定（当前提案 `APX / ASM / CGR / IDN`）。
- 其它候选族（仅记录）：
  1. **公差 / 计量**：`FINE` → `TIGHT` → `EXACT` → `ZERO`
  2. **相位锁定**：`SYNC` → `LOCK` → `PHASE` → `COHERENT`
  3. **加速器能量**：`MeV` → `GeV` → `TeV` → `PeV`
  4. **计量标准等级**：`CALIBRATED` → `CERTIFIED` → `REFERENCE` → `PRIMARY`
  5. **光圈 / f 值**：`f/2.8` → `f/2` → `f/1.4` → `f/1.0`
  6. **公差读数**：`±0.5` → `±0.2` → `±0.05` → `±0.00`
  7. **授时精度**：`QUARTZ` → `RUBIDIUM` → `CESIUM` → `OPTICAL`
  8. **雷达锁定**：`PAINT` → `TRACK` → `LOCK` → `SOLID`
  9. **化学纯度**：`TECH` → `REAGENT` → `ANALYTICAL` → `SPECTRO`
  10. **视差重合**：`OFFSET` → `ALIGNED` → `COINCIDENT` → `PARALLAX 0`
- 符号 / 秘仪类候选（气质接近 Lobotomy 的危险等级）：
  - **数学同一性**：`≈` → `≃` → `≅` → `≡`（≡ = 完全相同）
  - **占星相位**：`☍` → `□` → `△` → `☌`（☌ = 0° 合相，最紧）
  - **炼金金属**：`♄` → `♃` → `♀` → `☉`（铅 → 金）
  - **视差角秒**：`1″` → `0.1″` → `0.01″` → `0.001″`
  - **秘仪词**：`NIGREDO` → `ALBEDO` → `CITRINITAS` → `RUBEDO`
  - **卡巴拉四世界**：`ASSIAH` → `YETZIRAH` → `BRIAH` → `ATZILUTH`
  - **光谱项**：`s` → `p` → `d` → `f`（sharp / principal / diffuse / fundamental）
  - 注意：特殊字形（☌ ⚹ ♄ ♃ ♀ ☉）、希伯来字母等 Quest 浏览器不保证有字体覆盖，需要用自带字体或矢量绘制。
- 命名标准：1–5 字符、1.35m 可读、不与 `PERFECT / GOOD / MISS` 及 tier 名冲突、不靠颜色区分。
- 评级字体作为独立设计项：大字号、窄体 / 几何 display 字、纸面 / 仪表两种方向都先出样张；
  不使用默认 UI 字体直接放大，不加大面积金色 / 渐变 / 奖杯拟物。
- 样张放在独立环境（`design/`），选定后再移植进 Result。
- Result 上评级是主视觉之一，但分数仍是第一信息；Perfect / Good / Miss 继续保留。
- 需要覆盖：FAIL / 低分 / 满分 / 长标题 / 小屏 VR 面板。

验收：

- 1.35m 面板距离下，评级在 1 秒内可读出；
- 评级不依赖颜色（有字母 / 形状）；
- 评级与 tier 主题色不冲突；不改计分公式。

### 0.3 自由拍号与动态小节

现状：

- `TimingPoint` 只有 `{ time, bpm, beats }`，`beats` 是每小节拍数，没有分母；
- `4:3`、`5:6` 这类 `n/d` 拍号无法输入；
- 编辑器网格 / 下拉菜单、`track.ts` 的合成鼓组、游戏小节线都按这套整数 `beats` 工作。

计划：

- 扩展 timing：增加 `numerator` / `denominator`（或 `meter: [n, d]`），保留旧 `beats` 作为 `n/4` 兼容；
- 明确 **BPM 的参照单位**：是以四分音符为 BPM，还是以分母拍为 BPM；这会影响 5/6 的拍长；
- 编辑器：
  - 在播放头所在 timing 段显示当前拍号；
  - `TIMING` 输入 / 下拉菜单按当前拍号给出合法选项；
  - 小节线、拍线、细分线、小节编号按每段 timing 重新计算；
  - 拍号变化处不被平滑掉；必要时支持弱起 / pickup；
- 音频：`collectBeats` / 合成鼓组 / 节拍器重音跟随拍号；
- 兼容：旧谱 `beats: 4` 读成 `4/4`；未知分母时给出迁移提示。

验收：

- 能在同一张谱里写 `4/3` 与 `5:6`，并在指定时间切换；
- 小节线 / 拍线 / 下拉菜单在播放头处自动适应当前拍号；
- 合成鼓组 / 节拍器的重音落在新小节第一拍；
- 旧谱仍能打开、导出不丢 timing。

### 0.4 Trace / 引导线

目标：类似 Arcaea 的 trace，**细、半透明、无物量、不影响判定**；帮助玩家定位空中 note，也方便制谱。

建议：

- 数据层用独立的 `traces[]`，不塞进 `notes[]`，避免物量 / 计分 / 判定被污染；
- `trace` 至少包含起止时间、点列（相对时间、x、z、easing），可选颜色 / 可见性；
- 渲染：细管或细线，半透明、低亮度，贴台面 / 空中均可；无 hand、无 tick、无 hitbox；
- 游戏：不参与物量、分数、血量、判定、回收；只在视觉上辅助；
- 编辑器：
  - 新增 TRACE 工具 / 图层，可在 2D 与 3D 中画点、拖点；
  - 点击 trace 的任意点，可按当前时间吸附放置 hit / drag / arc（通常保留节奏吸附）；
  - trace 的编辑不应和 arc 选点抢命中，需要独立的可见性 / 选择优先级；
- 校验：trace 不占用 shift 窗口？还是允许超出窗口但变暗？这个要定；推荐允许存在，运行时按窗口亮度处理。

验收：

- 有 trace 的谱面，物量 / 分数 / 判定与无 trace 完全一致；
- trace 在游戏里能看清，但不遮挡 note；
- 编辑器中可在 trace 任意点放置 note，且落点与谱面坐标一致；
- 关闭 trace 显示后，不影响任何编辑数据。

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

1. 难度 tier UI（默认 `IN` 已去掉 ✅ 2026-10-22；主题色已定稿，剩结构化字段与徽章）；
2. ~~游玩 Combo HUD~~ ✅ 2026-10-22 已实现；
3. 评级字体 / 样式（表现层，可与 tier 一起做样张）；
4. 自由拍号 / 动态小节（会改 schema、编辑器、音频合成）；
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
