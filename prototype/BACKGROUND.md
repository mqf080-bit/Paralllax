# 背景规范（草案 v1）

> 状态：两个内置预设（`light` / `dark`）已实现并被游戏 / 制谱器使用；
> 下面的节点 / 时间线是**接下来**要按这个形状长出来的东西。写在这里是为了先锁死形状。

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
  制谱器导出时写一份 `background/scene.json`（当前是 `preset: light`）。

## 6. 版本

- `format` + `version`；未知节点跳过、未知字段忽略。
- 运行时必须能读 **version 1**；升 version 只在「老运行时读了会画错」时才做。
