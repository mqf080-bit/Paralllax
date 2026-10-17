# 素材来源与版权

`manifest.csv` 记录每张入选图片的：

| 字段 | 含义 |
| --- | --- |
| `local_path` | 在 `references/` 下的相对路径 |
| `game` | 所属游戏 |
| `role` | `gameplay` / `menu` / `result` / `note close-up` |
| `source` | App Store / Google Play / Steam / Fandom Wiki |
| `source_url` | 原始图片直链 |
| `dimensions` | 像素尺寸 |
| `kb` | 文件大小 |

## 选取原则

1. 优先官方商店页与官方 wiki，避免二次转载的压缩图。
2. 同一画面只保留信息量最大的一张。
3. 游玩画面优先于宣传图；宣传图只在其展示了纯游玩画面时保留，并在 `role` 中标注 `marketing overlay`。
4. 尺寸低于 1280px 宽的只保留键型近景（唯一可用的形状参考）。

## 版权

所有截图版权归各发行商/开发商所有：

- Arcaea © lowiro
- Phigros © Pigeon Games
- Beat Saber © Beat Games
- Synth Riders © Kluge Interactive
- AUDICA © Harmonix
- Pistol Whip © Cloudhead Games

本目录仅用于内部设计研究，不随产品分发，不用于商业宣传。
