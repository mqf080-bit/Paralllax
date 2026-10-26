# 背景规范（草案 v1）

> 状态：两个内置预设（`light` / `dark`）已实现并被游戏 / 制谱器使用；
> 下面的节点 / 时间线是**规范形状**，还不是当前实现范围。
> **2026-10-26 决定**：`scene.json` 加载器、`gltf` / `text` / `image` 节点、时间线与音频参数运行时
> **推迟到 Unity 项目开始**；在此之前只维护两个程序化预设，规范先锁形状、不改。

## 0. 结论

1. **不写自己的脚本语言。** 背景 = **一棵场景树 + 一条时间线**，节点类型是**封闭集合**。
2. **模型 / 材质 / 动画一律用 glTF 2.0（`.glb`）**——three.js 和 Unity 都原生读，这是唯一不需要写两个导出的资产格式。
3. **演出 / 文本是时间线上的 cue 节点**，不是代码。
4. **音频反应是命名参数通道**（`level/low/mid/high/beat`），节点声明绑定，不是回调。
5. 一个包**自带** `background/` 目录；`.parallax` 头部只做索引（`"background": "background/scene.json"`），或写 `"builtin:light"` 用内置的。

## 1. 为什么不是脚本语言

| 方案 | 问题 |
| --- | --- |
| 自带 JS 沙箱 | Unity 里跑不了；要写第二个解释器 |
| 自造 DSL | 等于自造语言 + 两个实现 + 一套调试器 |
| 脚本能读时钟 / 随机 / 网络 | 同一个包两次不一样，无法复现、无法回放 |
| 脚本没有 UI | 作者只能写代码，做不了「拖一个节点到 12.5 秒」 |

数据驱动 + 封闭节点集合的代价是：**每加一种能力，两端各实现一次**。
但这个代价是线性的、可预期的；自造语言是平方级的。所以选前者。

## 2. 容器

```
background/
  scene.json        # 场景树 + 时间线（本规范）
  models/*.glb      # 可选：模型 / 材质 / 动画（Blender 导出）
  textures/*.png    # 可选
```

```json
// .parallax header
{ "background": "background/scene.json" }
```

头部也可以写 `"builtin:light"` / `"builtin:dark"`；**不写** = 游戏默认（`light`）。
玩家在设置里选的默认背景只在包没写背景时生效。

## 3. `scene.json`

```json
{
  "format": "parallax.background",
  "version": 1,
  "preset": "light",
  "palette": { "skyBand": "#f4f6f6" },
  "nodes": [
    { "id": "sky", "type": "procedural.sky", "palette": {}, "radius": 320 },
    { "id": "terrain", "type": "procedural.terrain", "cell": 1, "step": 0.3 },
    { "id": "diamond", "type": "procedural.diamond", "dist": 45, "halfH": 50.4 },
    { "id": "rig", "type": "gltf", "src": "models/rig.glb", "animation": "Idle", "loop": true },
    { "id": "title", "type": "text", "text": "PHASE 01", "size": 4.2,
      "transform": { "position": [0, 30, -60] } }
  ],
  "timeline": [
    { "at": 0, "type": "anim.play", "target": "rig", "animation": "Idle" },
    { "at": 42000, "type": "fade", "target": "title", "to": 1, "duration": 0.8 }
  ],
  "reactive": [
    { "target": "diamond", "path": "rim", "param": "beat", "amount": 1.0, "decay": 0.12 }
  ]
}
```

- `preset` 先取内置预设，再被 `palette` / 节点字段覆盖；全省略 = `preset` = `light`。
- 未知 `type`：**跳过 + 记一条警告**，其余照常渲染（前向兼容：老运行时读新包不会炸）。
- 未知字段：忽略。

### 3.1 节点类型（v1 封闭集合）

| type | 作用 | 关键字段 |
| --- | --- | --- |
| `procedural.sky` | 天空渐变球 | `palette`, `radius` |
| `procedural.terrain` | 体素台地 | `cell`, `step`, `floor`, `xExtent`, `zEnd` |
| `procedural.diamond` | 菱形巨构 | `dist`, `apexElevDeg`, `slope`, `halfH`, `rim`, `depth` |
| `gltf` | 引入 `.glb` | `src`, `transform`, `animation`, `loop` |
| `group` | 变换容器 | `transform`, `nodes` |
| `text` | 3D 文本 | `text`, `font`, `size`, `align`, `transform` |
| `image` | 贴图平面 | `src`, `size`, `transform` |

`transform` = `{ "position": [x,y,z], "rotation": [x,y,z]（度）, "scale": [x,y,z] }`，右手系、+Y 上、−Z 前（和游戏一致）。

### 3.2 时间线

```json
{ "at": 42000, "type": "fade", "target": "title", "to": 1, "duration": 0.8, "easing": "sine" }
```

| type | 关键字段 |
| --- | --- |
| `fade` | `target`, `to`, `duration`, `easing` |
| `node.set` | `target`, `path`, `value`（点路径，如 `palette.skyBand`） |
| `anim.play` / `anim.stop` | `target`, `animation`, `speed`, `loop` |
| `cue` | `name`（给外部逻辑 / 统计用，运行时只广播） |
| `camera.cut` | `preset`（背景自己的镜头，不影响玩法镜头） |

**时间基准是谱面时间（ms）**，和 note 同一个时钟——这样 `offset` / BPM 变化自动对齐。
需要「进谱面就开始」的动画，用 `at: 0`；需要墙钟的，节点上写 `"clock": "wall"`。

### 3.3 音频反应

参数通道是**固定集合**：`level`、`low`、`mid`、`high`、`beat`（0–1）。

```json
{ "target": "diamond", "path": "rim", "param": "beat", "amount": 1.0, "decay": 0.12 }
```

两端各自实现一次分析器（Web Audio AnalyserNode / Unity OnAudioFilterRead），
绑定表由数据驱动——**不回调、不跑作者代码**。

## 4. 跨引擎映射

| 节点 | three.js | Unity |
| --- | --- | --- |
| `procedural.*` | `scene/background/build.ts` 的三个生成器 | 一份数学相同的 C# 生成器 |
| `gltf` | `GLTFLoader` | glTFast / UnityGLTF |
| `text` | Troika（或 canvas 贴图） | TextMeshPro |
| `image` | `PlaneGeometry` + `Texture` | Quad + Material |
| `timeline` | 每帧按 `chart time` 求值 | 同 |
| `reactive` | AnalyserNode → 参数 | 音频线程 → 参数 |

关键：**几何是数学，不是资产**。三个 `procedural.*` 生成器只有 ~300 行，
两端各抄一次的成本远低于维护两套导出管线。

## 5. 怎么编辑

- **模型 / 材质 / 动画**：在 Blender 里做，导出 `.glb`；背景编辑器只负责摆位、接时间线。
- **背景编辑器（未来）**：节点列表 + 时间线 + 参数曲线，输出 `scene.json`。
- **现在**：两个内置预设就是三个 `procedural.*` 节点的固定组合；
  制谱器的 `VIEW → BG` 选择这个包默认带的背景（记在本机），导出时写进
  `background/scene.json`。

## 6. 场景族（免费曲的复用单位）

免费曲**不新建场景**，而是从「场景族」里选一个，再覆盖少量参数。
族本身是一次性投入（一族约 2 天），之后每首免费曲只花 30–60 分钟调参。

| 族 | 几何特征 | 观感 |
| --- | --- | --- |
| `plateau` | 基准：`innerBase 1.25`、`innerSlope 0.6`、`rise 1.15`、菱形 45 m / 半高 50.4 | 高处的荒原（现用） |
| `canyon` | 走廊更窄更陡：`innerBase 1.0`、`innerSlope 0.35`、`rise 1.6`、`riseScale 1.2`、`zEnd 14`、`step 0.4` | 被两侧夹住 |
| `open` | 台地压平、迅速让开：`innerBase 1.4`、`innerSlope 1.0`、`rise 0.7`、`riseScale 2.0`、`zEnd 6` | 空旷 |
| `low` | 菱形更近更低：`dist 28`、`halfH 34`、`slope 0.95`、`apexElevDeg −14` | 压迫感 |
| `far` | 菱形更远更高：`dist 70`、`halfH 66`、`slope 0.75`、`apexElevDeg −4` | 远景巨构 |

配色是与族**正交**的另一维：每个族配 2–3 套 `palette`（冷 / 暖 / 夜），
所以 5 个族 ≈ 12–15 种观感，够一年 26 首免费曲用。

**族本身也会慢慢更新**：新族随版本加入，旧族会调参、修 bug、补配色。
所以有一个硬规则——

- **包里写展开后的完整参数**（`palette` 全量 + `geometry` 全量），
  `preset` 只作为来源注释；
- 运行时**不查族表**，只读包里的值 → 族怎么改都不影响已经发出去的包；
- 万一某个族必须重调（观感崩了），改 id（`canyon` → `canyon@2`），
  不要原地改——原地改等于偷偷改掉老曲子的样子。

**规则**：

- 免费曲：`{ preset: 'plateau', palette: {...}, geometry: {...} }`——
  允许选族、允许覆盖调色板，**不允许新增节点**；
- 付费曲：可以在族的基础上新增 `gltf` / `text` 节点、写时间线与音频绑定，
  也就是「专属演出」。免费与付费的差别是**有没有专属编排**，不是「有没有背景」。

## 7. 版本

- `format` + `version`；未知节点跳过、未知字段忽略。
- 运行时必须能读 **version 1**；升 version 只在「老运行时读了会画错」时才做。

## 8. 能力分级与预算

「官方能做更多」靠**词汇量 + 预算**，不是「官方能写 shader」。任何效果都是**有名字的节点**，
three.js 与 Unity 各实现一次；文件里只有名字和参数。

### 8.1 UGC 唯一的材质接口：toon

```json
{ "effect": "toon",
  "params": { "ramp": 3, "rim": 0.4, "tint": "#cfe0f2",
              "emissive": "#000000", "emissiveStrength": 0, "outline": 0 } }
```

| 参数 | 范围 | 含义 |
| --- | --- | --- |
| `ramp` | 2–4 | 光照量化阶数（卡通感的来源） |
| `rim` | 0–1 | 边缘光强度 |
| `tint` | `#rrggbb` | 基色 |
| `emissive` / `emissiveStrength` | 颜色 / 0–4 | 自发光 |
| `outline` | 0 或 1–3 | 反壳描边，宽度按屏幕像素 |

### 8.2 大气效果（官方专属，UGC 只能调场景族参数）

| 效果 | 做法 | 代价 |
| --- | --- | --- |
| 天空渐变 | 顶点色 | 0 |
| 远景透视 | 烘进台地顶点色 | 0 |
| 地平线雾带 | 一张水平渐变贴片 | 1 层透明 |
| 地面薄雾 | 台地边缘软贴片 | 1–2 层透明 |
| 光柱 | 3–6 张加法贴片 | overdraw，必须克制 |
| 浮尘 | ≤ 200 个小加法面片 | 便宜，但依赖叠层 |
| 体积雾 | **不做** | VR 里太贵 |

UGC 的大气能力 = 场景族参数（`hazeColor` / `hazeHeight`），只能调数值，不能加贴片。

### 8.3 烘焙

| 想烘的 | 能否 | 原因 |
| --- | --- | --- |
| 漫反射光照 / AO / 接触阴影 | ✅ | 与视角无关 |
| 阴影形状 | ✅ | 同上 |
| 镜面高光 / 反射 | ❌ | 与视角相关，头一动就穿帮 |
| 环境反射（粗糙金属） | ⚠️ | 要实时环境贴图，只给少量主力道具 |

- 烘到**标准贴图或顶点色**，不要用 Unity lightmap（format 绑定 Unity，three.js 无法匹配，两边会不一致）；
- 光泽只有三种选择：固定高光（假的，远景可用）/ 环境贴图（≤ 3 件主力道具）/ 不做。

### 8.4 预算

| 项 | UGC | 官方 |
| --- | --- | --- |
| 节点数 | ≤ 32 | 实测 |
| 三角面 | ≤ 40k | 实测 |
| 贴图 | ≤ 4 张，单张 ≤ 2K，合计 ≤ 8 MB | 每曲 ≤ 16 MB |
| **透明叠层** | **任意像素 ≤ 2 层** | ≤ 4 层，且不得整屏 |
| 后期（泛光） | ❌ | 仅官方演出段落，必须实测 72fps |
| 实时光 | ❌ | 台面那一盏 |
| 音频参数绑定 | ≤ 8 条 | 不限 |

### 8.5 透明叠层怎么测（不靠肉眼）

按“张数”限制没有意义，要按**屏幕上任意像素最多叠了几层**。两种可落地的做法：

1. **静态检查（导出时跑，推荐）**：把每个透明面的四角投影到屏幕，按 64×36 网格累加覆盖，
   取网格最大值。背景的透明面基本都在固定深度上，头部平移对它影响很小，所以这个近似足够准。
   `max_overdraw > 2` 就拒绝导出，并指出是哪几个面。
2. **运行时验证（dev build）**：一张 1 通道的加法缓冲，每个透明 draw 加 1，读回最大值。
   比静态检查准（含动画），但只在开发版里开，Quest 上代价可接受。

于是“叠层”从一个拍脑袋的规则变成一个**可测量、可拒绝**的指标。
