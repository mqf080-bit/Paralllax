# Parallax 谱面格式 v0

> 目标：能写**极端 SV**、能写 **shift**、能把 **arc 的直角 / 钝角 / 曲线**记下来，同时尽量贴 Arcaea 的 AFF 概念，少造轮子。
> 代码：`src/chart/schema.ts`（类型）、`src/chart/timeline.ts`（时间轴 / 校验）、`src/chart/easing.ts`（缓动）、`src/chart/demo.ts`（示例）。
> 制谱器：[`EDITOR.md`](EDITOR.md)；入口 `http://127.0.0.1:5173/editor.html`。

---

## 1. 时间基

- 一切都用**毫秒**，绝对时间（和 AFF 一样）。
- `meta.offset`：**作者音频偏移**，和 AFF 的 `AudioOffset` 同义（正值 = 谱面时间比音频提前）。游戏内部映射为 `chartOffsetMs`；玩家校准是 Settings 的 `offsetMs`，两者独立。
- **判定只看 note 的 `time`**，不看位置——这是前几轮定下的规则，谱面格式必须配合它。
- **时钟是音频时钟**：运行时读的是 `AudioContext.currentTime`（含输出延迟补偿），不是逐帧累加。
  所以谱面必须写在 `timing` 的拍点上，否则音轨与键会各走各的。
- 起播前留 `leadInMs`（默认 2000ms）的空拍：这段里**谱面时间是负数**，键从远处滑进来。

## 2. 结构

```jsonc
{
  "meta":    { "title": "…", "offset": 0, "difficulty": "Ballistic 7", … },
  "audio":   "track.mp3",                                  // 只记录文件名
  "timing":  [ { "time": 0, "bpm": 150, "beats": 4, "numerator": 4, "denominator": 4 } ],
  "sections":[ { "time": 0, "label": "A" }, … ],           // 制谱器对齐用
  "speed":   [ { "time": 0, "multiplier": 1 }, … ],         // SV
  "shift":   [ { "time": 4000, "target": "left", "duration": 350 }, … ],
  "notes":   [ … ]
}
```

| 段 | 作用 | 备注 |
| --- | --- | --- |
| `meta` | 标题 / 难度 / offset / duration / cover | `offset` 正 = 谱面比音频提前，运行时进入 `chartOffsetMs`；`difficulty` 目前是自由字符串（新谱默认留空，作者显式填 tier + level）；tier 主题色已定稿但 UI 未实现；`duration` 毫秒；`cover` 可放 URL / data URL |
| `audio` | 音轨文件名 | 只记录；`.parallax` 包里音频是真实文件，旧 JSON 用 `?audio=/track.mp3` |
| `timing` | BPM + 拍号 | 画小节 / 对齐；**也是合成音轨的拍点**；不参与滚动速度。拍号用 `numerator` / `denominator`（`4/4`、`5/6` 都可以），旧谱只有 `beats` 时按 `beats/4` 读 |
| `sections` | 段落标记 | 纯制谱器信息 |
| `speed` | 视觉流速（SV） | 支持 0 / 负数 / 极端值 |
| `shift` | 4 轨窗口滑动 | `duration` = shift 的速度 |
| `notes` | 键与物量 | 见下 |
| `limits` | 覆盖高度上限 | `{ "maxHeight": 0.81 }`，一般不用写 |

### 2.1 拍号与 BPM 的参照

**BPM 以四分音符为参照**：`bpm = 150` 时四分音符 = 400ms，和拍号无关。

一拍（分母拍）的长度：

```text
beat = (60000 / bpm) × (4 / denominator)
bar  = beat × numerator
```

- `4/4` @150：beat 400ms，bar 1600ms；
- `3/4` @150：beat 400ms，bar 1200ms；
- `5/6` @150：beat 266.67ms，bar 1333.33ms（一拍是六分音符 = 2/3 个四分音符）。

分母不要求是 2 的幂，`4/3`、`5/6` 都能写。`beats` 保留为兼容字段：没有
`numerator` 时按 `beats/4` 读；两个字段都在时忽略 `beats`。

小节编号跨 timing 段**连续累加**（换拍号不会回到 1）；每段从自己的 `time` 重新起拍，
不插值、不平滑——和 AFF 的 `timing` 语义一致。

## 3. Notes

**坐标约定**：`x` = 横向（轨号单位），`y` = 时间（字段是 `time`，毫秒），`z` = 高度（米）。
（Three.js 预览内部是 y-up；**谱面坐标**始终用 x / z，y 不表示高度。）

公共字段：`time`（毫秒）、`lane`（**整数轨号 0–5，兼容旧谱面**）、
`x?`（**横向位置**）、`z?`（**中心离台面高度，米**）、`hand`（`left` / `right`，省略 = 中性）。

| type | 额外字段 | 说明 |
| --- | --- | --- |
| `hit` | `x?`、`z?` | 需要一次挥击；有 PERFECT / GOOD；可在地面或空中 |
| `drag` | `x?`、`z?` | 扫过；只有 PERFECT / MISS；可在地面或空中 |
| `hold` | `x?`、`duration`、`objects?`、`notesPerSecond?` | 平片；物量均匀分布；**只能贴地（z 固定 0.004m）** |
| `arc` | `hand`、`points`、`ticks?`、`keyObjects?`、`notesPerSecond?` | 跟随；见下一节 |

**横向位置 `x`：默认对齐轨道，离轨是刻意的例外**

- `0` = 0 号轨中心，`2.5` = 台面中心，`5` = 5 号轨中心；
- 地面键（hit / drag / hold）**默认写整数 `x`（轨中心）**，这是写谱规矩；
- 空中 hit / drag（z > 0.07m）在编辑器里按 **1/4 轨**吸附（和 arc 点一样），因为空中位置本身就是自由的；
- 离轨（`1.25`、`3.5` 之类）允许，但必须显式写 `x`，编辑器里也要专门操作
  （检查器 X、`Ctrl` 临时自由、关闭 `SNAP XZ`）；
- 省略 `x` 时等于整数 `lane`（旧谱面行为不变）；
- 4 轨窗口的范围是连续的：常态 `[0.5, 4.5]`，左移 `[−0.5, 3.5]`，右移 `[1.5, 5.5]`；
  超出窗口的 note 校验器会报错。

**高度 `z` 是 note 中心相对台面的米数**：

- 省略时按类型默认：hit / drag **0.07m**、hold **0.004m**；
- hit / drag 可以写任意 `z`（受 `limits.maxHeight` 限制）；**hold 不能飞天**，
  z 会被忽略 / 校验器报错；
- 地面键不是「0 高度」，而是贴着台面浮起一点；要放到胸口就写 `z: 0.33`。

## 4. arc 的形状

`arc.points` 是**按时间排的点列**，每个点：

```ts
{ time: 毫秒（相对弧起点）, x: 轨号 −0.5–5.5（连续，2.5 = 台面中心）, z: 台面上方米数, easing: 缓动, easingZ?: 高度方向缓动 }
```

`easing` 描述 **x（横向）** 从上一个点走到这个点的插值；`easingZ` 描述 **z（高度）**。
`easingZ` 省略时跟随 `easing`（旧谱面行为），所以可以做到「平面直线、高度缓入」或反过来。于是：

- **直线**：`linear`；运行时的管是折线，所以 `linear` 段是真的直，**不会**被 Catmull-Rom 磨圆；
- **直角 / 钝角**：连续两个 `linear` 段在同一个点相接（方向突变，管在拐点处是硬角）；
- **曲线**：`sine` / `cosine` / `bezier` 段；
- **平面与高度分开**：`easing: 'linear', easingZ: 'sine'` = 横向匀速、高度缓入；
- **任意形状**：点列本身就是折线 / 曲线混合。

示例（一个直角 + 一段曲线）：

```json
{
  "type": "arc", "time": 4600, "hand": "right",
  "ticks": [
    { "time": 0,    "key": false },
    { "time": 400,  "key": true  },
    { "time": 800,  "key": false },
    { "time": 1200, "key": false }
  ],
  "points": [
    { "time": 0,    "x": 1, "z": 0.08, "easing": "linear" },
    { "time": 400,  "x": 1, "z": 0.40, "easing": "linear" },
    { "time": 800,  "x": 3, "z": 0.40, "easing": "linear" },
    { "time": 1200, "x": 3, "z": 0.08, "easing": "sine", "easingZ": "cosine" }
  ]
}
```

**物量**：

- `ticks`：**显式物量表**，时间相对起点。存在时**完全替代** `notesPerSecond` / `keyObjects` 的自动生成。
  - `key: false` = 普通物量，200ms 窗口，可以断连重连；
  - `key: true` = 关键物量（黄铜珠），80ms 窗口，不能断连补；
  - **没有 tick 的时间就没有物量**：直角蛇的拐角如果不需要结算，就不要在那里放 tick，
    手大致划过即可。这正是「不是所有拐点都需要关键物量」的表达方式。
- 可选旧字段（没有 `ticks` 时生效）：
  - `keyObjects`：关键物量时间，对应 AFF 的 `arctap`；
  - `notesPerSecond`：普通物量密度，沿弧均匀生成。
- 编辑器里 `MAKE EXPLICIT` 会把当前自动物量转成 `ticks[]`，之后可以逐条增删 / 切 key。

## 5. SV（极端变速）

`speed` 是一条独立轨道：

```ts
{ time, multiplier, easing?, duration? }
```

- `multiplier`：相对基准流速。`0` 停住、负数倒流、`8` 八倍速都可以；
- `duration`：从上一档过渡到这一档的时长（毫秒，0 = 瞬变）；
- 运行时位置 = `判定带 − ∫ 速度 dt`，所以负 SV 会让键往回走；
- **判定完全不受影响**（只认绝对时间）。

AFF 用「BPM 变负」来表达 SV；我们把它拆成独立轨道，BPM 只负责小节——这样谱面作者不用为了变速去改小节，制谱器也更好画。

## 6. shift

```ts
{ time, target: 'normal' | 'left' | 'right', duration? }
```

- `duration` 就是窗口滑动的速度（毫秒）；
- 窗口值连续插值（smoothstep），台面、分割线、判定带、浮空显示都跟着它走；
- 校验器会检查每颗 note 是否落在它当时的窗口里。

## 7. 与 AFF 的对照

| AFF | Parallax |
| --- | --- |
| `AudioOffset:248` | `meta.offset` |
| `timing(t, bpm, beats)` | `timing: {time, bpm, beats}`（`beats` 是 `n/4` 的兼容写法） |
| `(t, lane)` | `{type:'hit', time, lane}` |
| `hold(t0, t1, lane)` | `{type:'hold', time, duration, lane}` |
| `arc(t0, t1, x0, x1, easing, y0, y1, …)` | `arc.points` 的一段（每段一个端点 + 缓动） |
| `[arctap(t), …]` | `arc.keyObjects` |
| BPM 变负做 SV | `speed` 独立轨道（可负） |
| `timinggroup()` | v0 不做 |

参考：[Arcaea 谱面格式（wiki）](https://wiki.arcaea.cn/index.php?title=%E8%B0%B1%E9%9D%A2%E6%A0%BC%E5%BC%8F)、[arcfutil 文档：aff 编辑](https://docs.arcaea.icu/guide/package-aff.html)、[arcfutil 文档：缓动](https://docs.arcaea.icu/guide/easing.html)。

## 8. 高度基准线与上限

台面是 0.95m。玩家站着，身体给出三条**高度基准线**（相对台面，`src/chart/schema.ts` 的 `HEIGHT_LEVELS`）：

| 线 | 相对台面 | 世界高度（台面 0.95 时） | 用途 |
| --- | --- | --- | --- |
| `chest` 胸 | 0.33m | 1.28m | 最舒服的高位，arc 常用 |
| `face` 面 | 0.61m | 1.56m | 需要抬一点手 |
| `head` 头顶 | 0.81m | 1.76m | 上限；连续交互会累 |

- 这三条线**只是制谱用的参考，不在游戏里画出来**（`HEIGHT_LEVELS`，定义在 `src/chart/schema.ts`）。
  制谱器会在编辑视图里画它们，玩家看不到。
- 谱面高度就按这三条线读：**不要写「差不多 0.4」这种数**。
- **硬上限 = 头顶线（0.81m）**，可以在谱面里覆盖：
  ```jsonc
  "limits": { "maxHeight": 0.81 }
  ```
- **超过上限的 note 不生成**：不参与判定、不计入物量、不参与回收（`player.ts` 构建时跳过）。
- `validateChart()` 会报错：`note@26000: 高度 0.9m 超过上限 0.81m（不会生成）`。
- **hit / drag 可以带 `z`**（默认 0.07m）；**hold 只能贴地**（0.004m，不能飞天）；arc 用每个点的 `z`。
  编辑器的高度轨会同时显示 arc 曲线、hit/drag 点；hold 固定在地面。

## 9. 音频与时钟

运行时（`src/audio/`）：

| 文件 | 作用 |
| --- | --- |
| `clock.ts` | 音频时钟：`now()` 返回「正在被听到的」谱面时间；play / pause / resume / 校准偏移；可选载入真实音轨 |
| `track.ts` | 从 `timing` 生成拍点，并用 WebAudio 现场合成鼓组 / 贝斯 / 节拍器 |

- 没有音轨时，合成轨就是音轨（`DRUMS`），它和谱面共用同一张 `timing`，天然对齐。
- 有真实音轨时（`?audio=/track.mp3`，文件放 `prototype/public/`），合成轨退化成可选节拍器（设置面板 / 调试面板）。
- 主时钟优先用音频时钟；浏览器没给自动播放权限时退回 `performance.now()`，游戏照常跑，只是没声音。
- 音频被系统挂起、或从 `performance` 切到音频时钟时，会**重打锚点**，谱面时间保持连续。
- 校准：`meta.offset` 只进入 `chartOffsetMs`（作者偏移）；玩家校准用 Settings 的 `offsetMs`，可以 ±5ms 微调，两者不互相覆盖。

## 10. 校验

`validateChart(chart)` 返回问题列表，已经覆盖：

- timing / speed / shift 的排序与取值范围；
- **hit / drag / arc 的 z 不超过 `limits.maxHeight`**，z 不能为负；hold 的 z 必须贴地；
- 地面键的 `lane` 必须是 0–5 的整数；有效 `x` 必须在当时的连续窗口里；
- `x` / `z` 范围（x 允许 −0.5–5.5，z ≥ 0）；
- arc 至少两个点、首个点 time = 0、点时间递增、x / z 范围；
- 显式 `ticks[]` 必须落在弧长内、按时间递增且不重复；旧 `keyObjects` 同样检查。

## 11. 示例谱

| 文件 | 时长 | 内容 |
| --- | --- | --- |
| `src/chart/test.ts`（默认） | **41.6s** | 79 notes：四种键型、**两次 shift**（12s 左 / 30s 右）、2 处 SV（慢速 / 200ms 停表）、4 条 arc（胸 / 面高度） |
| `src/chart/demo.ts` | 12s | 格式示例，`?chart=demo` 切回 |
| `public/charts/air-example.json` | 8s | 空中 hit/drag + 地面 hold + 显式 arc ticks，`?chart=/charts/air-example.json` |

## 12. 状态

- ✅ **播放器**：`src/game/player.ts` 已按本格式读谱面（hit / drag / hold / arc、SV 积分、shift 窗口）。
- ✅ **高度上限**：`limits.maxHeight`（默认 **0.81m = 头顶线**），超限的 note 不生成，校验器报错。
- ✅ **30–60s 测试谱**：`src/chart/test.ts`，41.6s、两次 shift。
- ✅ **音频时钟**：以 `AudioContext` 为准，带 lead-in、暂停 / 恢复、offset 校准、可选真实音轨。
- ✅ **视距淡出**：note 只在台面最后 4m 里渐显，远端不再 pop-in。
- ✅ **制谱器（Step 5）**：6 轨主视图 / 高度轨 / SV 轨 / 波形、吸附、arc 点编辑、shift / SV 编辑、
  3D 播放器预览（自动打 / 暂停 / 慢放 / 倒放）、JSON 导入导出、localStorage 草稿。见 [`EDITOR.md`](EDITOR.md)。
- ✅ **游戏读取导出的谱**：`?chart=/charts/文件名.json`（示例 `public/charts/example.json`、`air-example.json`）。
- ✅ **任意 x / z**：hit / drag 可以浮空、离开轨中心；hold 贴地；3D 视图可直接放置 / 拖动。
- ✅ **时间吸附**：预设 + `DIV / DOT / 三连` 自定义参数（五连、附点、1/24、1/32 都能直接写）；`Ctrl` 临时自由。
- ✅ **底部 Blender 式时间线**：概览、scrub、视口框平移。
- ✅ **显式 arc 物量**：`ticks[]` + 编辑器逐条编辑；线性段是真正直线，直角不会被磨圆。
- ⬜ **极端 SV 的可读性**：负 SV 时键往后退，需要确认不会和「漏键」的视觉混淆。

## 13. 编辑器的数据约定

- **时间吸附**按拍计算，参数是 `DIV`（每全音符几份）+ `DOT`（×1.5）+ `三连`（×2/3），网格来自 `timing`；`DIV 8` = 半个拍。网格按当前 timing 段的拍号生成（`n/d` 任意正整数，含 `5/6` 这类分母），换段时小节线和编号连续累加。
- **坐标是 x / z**：hit / drag 用 `note.z`（中心高度），arc 用 `points[].z`；hold 固定贴地。
- **地面键默认整轨对齐**：离轨要显式改 `x`（编辑器里 Ctrl / 检查器 / 关闭 SNAP XZ）。
- **x 是连续轨号坐标**：`x = 2` 是 2 号轨的中心，`x = 2.5` 是 2 / 3 轨之间；
  编辑器允许 `−0.5–5.5`，窗口校验用 `[0.5+w, 4.5+w]`。
- **arc 显示的是折线**：`linear` 段是直线，直角是硬角；`STRAIGHTEN` 把所有段设成 `linear`。
- **3D 直接编辑 arc**：选中弧后拖白点 = x/z，青点 = 只改 x，黄铜点 = 只改 z；ARC 工具点弧身加点，点物量珠切 KEY。
- **arc 物量可以是显式列表**：`ticks[]` 存在时只结算列表里的时间；拐角不放 tick 就没有物量。
- **缓动**归「这一段终点的点」所有：`points[i].easing` 描述从 `i−1` 走到 `i` 的插值。
- `meta.audio` / `audio` 只记文件名，音频文件不进 JSON。
- 编辑器导出的谱面可以直接被 `?chart=` 读取；`?audio=` 负责音轨。

