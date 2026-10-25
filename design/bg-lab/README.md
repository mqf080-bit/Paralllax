# bg-lab —— 3D 背景实验室

露天几何背景：**没有地面**，下半画面是天空球自己暗下去的一段渐变；
倒三角悬在空中；体素台地只在两侧余光里，把轨道的根部托住。

**这里只回答「应该长什么样」**，不接游戏状态、不接谱面、不接音频；
定稿后才迁进 `prototype/src/scene/backdrop.ts`。

- 生成脚本：[bg_lab.py](bg_lab.py)
- 渲染输出：`renders/bg-light.png` / `renders/bg-dark.png`（1600×900）
- 参数快照：`lab-spec.json`（每次运行覆盖）

## 1. 一页规则

| 项 | 值 |
| --- | --- |
| 坐标 | Blender X→three X，Y→−Z（+Y 是前方），Z→Y（+Z 是上） |
| 相机 | three `(0, 1.62, 0.52)`，垂直 FOV 58°，far 80 |
| 台面 | 顶面 y=0.95，近端 z=0.34，远端 z=9.66，宽 1.62（6 轨 × 0.27） |
| 渲染 | EEVEE，Standard 色彩，无光照；材质全是 Emission + 顶点色 |
| 面数 | **5 565 三角面**（天空球占大头） |

渲染是**无光照**的：材质 = Emission + 顶点色，等价于 three.js 的
`MeshBasicMaterial + vertexColors`。渲染图 ≈ 浏览器里看到的样子，
不需要补灯光 / 雾 / 后处理——渐变和明暗全部烘进顶点色。

## 2. 部件

| 名字 | 形状 | 参数 | 作用 |
| --- | --- | --- | --- |
| `BG-sky` | 球壳 96 段 × 51 环 | R=320，随相机 | 唯一的大气：Catmull-Rom 顶点色渐变 |
| `MEGA-face` | 菱形板（倒三角 + 镜像） | 距离 45，下尖 −8.5°，单侧高 50.4，半宽 45.4，厚 3 | 悬空的巨构 |
| `MEGA-rim` | 等宽边线 | 0.30 m | 唯一的一条线 |
| `BG-terrain` | 体素台地（格 1m、高 0.30m 一档） | 见 §4 | 只在余光：两侧台地 + 脚下 |
| `STG-*` | 台面板 + 远端亮边 | 见上 | 只是代用品，用来判断背景关系 |
| `NOTE-*` | 8 个白色薄片 | 台面上 2 cm | 假 note，判断判定带会不会被抢 |

**没有**地面、网格、山脊、城市天际线、楼层横纹、漂浮方块。

## 3. 天空渐变

球壳 R=320（必须容得下整颗菱形），96 段 × 51 环，环在地平线附近最密（0.2° 一级）。
关键色之间用 **Catmull-Rom** 插值（C1 连续）——之前用 smoothstep 会在每个关键角上
把导数压成 0，看起来是一圈一圈的平板色带。

按仰角分段插值（`SKY_STOPS`）：

| 仰角 | dark | light |
| --- | --- | --- |
| 90° | `#071528` | `#6d8cb6` |
| 38° | `#0a2440` | `#8faac9` |
| 14° | `#103659` | `#c3d6e6` |
| 4° | `#1b4a74` | `#e9f0f4` |
| **0.4°** | `#2f6f9e` | `#f4f6f6` |
| −1.6° | `#14344f` | `#cfd8de` |
| −6° | `#08131f` | `#5d6d80` |
| −22° 以下 | `#04070c` | `#131d29` |

地平线是一条**亮带**：0.4° 处最亮，往下 6° 内掉暗——地面不存在，
所以「暗」是天空自己暗下去。

## 4. 菱形巨构

```
下尖    仰角 −8.5°（已经落到地平线亮带以下，被台面挡住）
单侧高  50.4 m，半宽 45.4 m（slope 0.9）
腰线    仰角 45.3°，宽度 ±45.4 m
上尖    仰角 64.4°
```

平视时只看到下半颗（下尖被台面挡住、上尖在画外）；
`renders/bg-<palette>-up.png` 是抬头 27° + 100° 竖直 FOV 的验证图，整颗菱形一屏可见。
厚度 3 m 只有歪头才有视差。

> 这颗菱形是按「在 .blend 里整体放大 1.68×」的修改反推回脚本的：
> 顶点从 +1.2° 挪到 −8.5°，单侧高 30 → 50.4。

## 5. 地形：只留在余光里

台地不是一整片地，是一个**向前的楔形缺口**：

```python
第 z 行走廊的内边界  inner(z) = 1.25 + max(0, z - 0.9) * 0.60   # 米
格子在不在            abs(x) > inner(z)  或  z <= 0.9（玩家脚下）
高度                  floor + 1.15 * (1 - exp(-k / 1.6))，k = abs(x) - inner(z)
```

- 玩家脚下（z ≤ 0.9）有地，两侧 |x| > inner 有台地；
- 正前方是一块切掉的楔形：**轨道直接从崖边飞出去**；
- 台地高度随「离内边界多远」抬升，所以画面最外侧是高台、靠轨道的一侧是低台；
- 高度量化到 0.30m、格子 1m，只在相邻格子更低或没有格子处补竖直面 → 体素感。

台地面色随距离混向天空的暗部（`terrain_haze`），最远 14m 处混 30%。

## 6. 跑一次

```bash
blender -b --factory-startup -P design/bg-lab/bg_lab.py
# 产物：renders/bg-light.png、renders/bg-dark.png、lab-spec.json
```

约 1.2 s。调参：`VARIANTS` 里的 `mega` dict（`slope` 宽窄、`apex_elev` 顶点高度、
`d` 距离），地形在 `terrain_exists` / `terrain_height` 两个函数里。
调试图：`BG_DEBUG_TERRAIN=1` 把地形染红；`BG_DEBUG_ISO=1` 换等距视角看全场景。

## 7. 迁到 three.js

1. **几何**：天空球、巨构、台地都是低模平面着色，`build_*` 一一对应。
   台地是一个合并的 BufferGeometry（顶点色烘死）。
2. **材质**：只有两种——
   - 顶点色 → `MeshBasicMaterial({vertexColors:true})`（天空 / 巨构 / 台地）
   - 纯色 → `MeshBasicMaterial({color})`（台面 / note）
3. **两个预设 = 两张色表**。几何一份，切换只改顶点色与 `material.color`。
4. **不需要**灯光、阴影、fog、后处理、贴图。
5. ⚠️ **远平面**：天空球 R=320，而游戏相机现在 `far = 80`。
   迁进去时把 `camera.far` 提到 ≥ 400（近平面 0.03 时 24 位深度的精度仍然够），
   或者把天空换成全屏渐变 shader（不参与深度）。

## 8. three.js 实验台

`prototype/bg-lab.html` + `prototype/src/lab/backdropLab.ts`——独立页面，不 import 任何游戏代码。

```bash
cd prototype && npm run dev
# http://127.0.0.1:5173/bg-lab.html
# ?pal=dark&pitch=27&notes=0  直接定格到某个状态
```

| 项 | 做法 |
| --- | --- |
| 几何 | 三个 `build*` 函数逐条照搬 `bg_lab.py` 的数学（球壳 / 高度场 / 菱形），**不导 glTF** |
| 材质 | 一个 `MeshBasicMaterial({ vertexColors: true, side: DoubleSide })`，三块网格共用 |
| 颜色 | `new THREE.Color(hex)` 自动做 sRGB→线性；渲染器 `outputColorSpace = SRGBColorSpace`、`toneMapping = NoToneMapping` |
| 预设 | 换配色 = 重建顶点色（< 5 ms），几何重建也行，只有 11k 面 |
| 面数 / 批次 | **11 128 tris / 3 draw calls**（背景 + 台面 + note） |
| 相机 | `(0, 1.62, 0.52)`，FOV 58°，near 0.03 / **far 400**（天空球 R=320） |

**不需要**：灯光、阴影、fog、后处理、贴图、glTF loader。

## 9. 还没定的

- **音频反应**：最便宜的三处是 ①巨构边线亮度随底鼓 ②台地 `material.color` 随低频
  ③天空亮带随高频。都是改颜色，不加几何、不加 draw call。
- 台地内边界的斜线现在很直，要不要加横向起伏（现在只有高度噪声）。
- 三角顶点 1.2°，还可以更低（贴到地平线下沿）。
