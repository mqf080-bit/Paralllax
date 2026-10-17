# Parallax 谱面格式 v0

> 目标：能写**极端 SV**、能写 **shift**、能把 **arc 的直角 / 钝角 / 曲线**记下来，同时尽量贴 Arcaea 的 AFF 概念，少造轮子。
> 代码：`src/chart/schema.ts`（类型）、`src/chart/timeline.ts`（时间轴 / 校验）、`src/chart/demo.ts`（示例）。

---

## 1. 时间基

- 一切都用**毫秒**，绝对时间（和 AFF 一样）。
- `meta.offset`：音频偏移，和 AFF 的 `AudioOffset` 同义。
- **判定只看 note 的 `time`**，不看位置——这是前几轮定下的规则，谱面格式必须配合它。

## 2. 结构

```jsonc
{
  "meta":    { "title": "…", "offset": 0, "difficulty": "IN 7", … },
  "timing":  [ { "time": 0, "bpm": 180, "beats": 4 } ],
  "sections":[ { "time": 0, "label": "A" }, … ],           // 制谱器对齐用
  "speed":   [ { "time": 0, "multiplier": 1 }, … ],         // SV
  "shift":   [ { "time": 4000, "target": "left", "duration": 350 }, … ],
  "notes":   [ … ]
}
```

| 段 | 作用 | 备注 |
| --- | --- | --- |
| `timing` | BPM + 每小节拍数 | **只用来画小节 / 对齐**，不参与滚动速度 |
| `sections` | 段落标记 | 纯制谱器信息 |
| `speed` | 视觉流速（SV） | 支持 0 / 负数 / 极端值 |
| `shift` | 4 轨窗口滑动 | `duration` = shift 的速度 |
| `notes` | 键与物量 | 见下 |

## 3. Notes

公共字段：`time`（毫秒）、`lane`（**绝对轨号 0–5**）、`hand`（`left` / `right`，省略 = 中性）。

| type | 额外字段 | 说明 |
| --- | --- | --- |
| `hit` | — | 需要一次挥击；有 PERFECT / GOOD |
| `drag` | — | 扫过；只有 PERFECT / MISS |
| `hold` | `duration`、`objects?`、`notesPerSecond?` | 贴轨平片；物量均匀分布 |
| `arc` | `hand`、`points`、`keyObjects?`、`notesPerSecond?` | 跟随；见下一节 |

**轨号用绝对值 0–5**，不是窗口内的 0–3：谱面必须自己保证 note 落在当时的窗口里，校验器会报错。
这样做的好处是「0 / 5 上的键只在 shift 时出现」这件事在数据层就是显式的。

## 4. arc 的形状

`arc.points` 是**按时间排的点列**，每个点：

```ts
{ time: 毫秒（相对弧起点）, x: 轨号 0–5（可小数）, y: 台面上方米数, easing: 'linear'|'sine'|'cosine'|'bezier' }
```

`easing` 描述**从上一个点走到这个点**的插值。于是：

- **直角 / 钝角**：连续两个 `linear` 段在同一个点相接（方向突变）；
- **曲线**：`sine` / `cosine` / `bezier` 段；
- **任意形状**：点列本身就是折线 / 曲线混合。

示例（两个直角 + 两段曲线）：

```json
{
  "type": "arc", "time": 4600, "hand": "right",
  "keyObjects": [400, 800],
  "points": [
    { "time": 0,    "x": 1, "y": 0.08, "easing": "linear" },
    { "time": 400,  "x": 1, "y": 0.40, "easing": "sine"   },
    { "time": 800,  "x": 3, "y": 0.40, "easing": "linear" },
    { "time": 1200, "x": 3, "y": 0.08, "easing": "sine"   }
  ]
}
```

**物量**：

- `keyObjects`：**关键物量**（对应 AFF 的 `arctap`），时间相对起点；必须在体积判定内接住，不能靠重连补；
- `notesPerSecond`：**普通物量**密度，沿弧均匀生成，可以重连。

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
| `timing(t, bpm, beats)` | `timing: {time, bpm, beats}` |
| `(t, lane)` | `{type:'hit', time, lane}` |
| `hold(t0, t1, lane)` | `{type:'hold', time, duration, lane}` |
| `arc(t0, t1, x0, x1, easing, y0, y1, …)` | `arc.points` 的一段（每段一个端点 + 缓动） |
| `[arctap(t), …]` | `arc.keyObjects` |
| BPM 变负做 SV | `speed` 独立轨道（可负） |
| `timinggroup()` | v0 不做 |

参考：[Arcaea 谱面格式（wiki）](https://wiki.arcaea.cn/index.php?title=%E8%B0%B1%E9%9D%A2%E6%A0%BC%E5%BC%8F)、[arcfutil 文档：aff 编辑](https://docs.arcaea.icu/guide/package-aff.html)、[arcfutil 文档：缓动](https://docs.arcaea.icu/guide/easing.html)。

## 8. 校验

`validateChart(chart)` 返回问题列表，已经覆盖：

- timing / speed / shift 的排序与取值范围；
- 地面键 lane 必须是 0–5 的整数、并且落在当时的窗口里；
- arc 至少两个点、首个点 time = 0、点时间递增、x / y 范围、关键物量在弧长内。

## 9. 状态

- ✅ **播放器**：`src/game/player.ts` 已按本格式读谱面（hit / drag / hold / arc、SV 积分、shift 窗口）。
- ⬜ **制谱器辅助**：小节 / 拍线、SV 曲线预览、shift 时间轴、arc 点编辑。
- ⬜ **极端 SV 的可读性**：负 SV 时键往后退，需要确认不会和「漏键」的视觉混淆。
- ⬜ **音频**：目前谱面时间是「假时钟」，还没有和音轨对齐。
