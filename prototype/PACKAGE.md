# `.parallax` 谱面包

## 结论

**用一个自定义单文件 `.parallax` 作为发行格式**，而不是让游戏 / 编辑器去读一个运行时
`resources/` 目录。

- 开发时可以保留 `resources/` 作为**素材源目录**（谱面、音轨、主题、背景），
  但它不是运行时依赖；
- 发行时编辑器把谱面 + 音轨 + 主题 / 背景等资源打成一个 `.parallax`；
- 游戏和编辑器都能直接读取同一个文件，不需要用户再分别传 JSON 和音频；
- 旧的 `.parallax.json` / `?chart=` / `?audio=` 仍然保留，方便调试和兼容。

## 文件结构

`.parallax` 是一个很小的自定义二进制容器：

```
offset 0    "PARALLAXPAK\0"        12 字节 magic
offset 12   u16 容器版本            当前 = 1
offset 14   u32 头部 JSON 字节数
offset 18   头部 JSON（UTF-8）
之后         文件字节，按 header.files 的顺序拼接
```

头部示例：

```json
{
  "format": "parallax.package",
  "version": 1,
  "chart": "chart.json",
  "audio": "audio/track.mp3",
  "cover": "cover/front.jpg",
  "theme": "theme/dark.json",
  "background": "background/stage.webp",
  "files": [
    { "path": "chart.json", "size": 12034, "type": "application/json" },
    { "path": "audio/track.mp3", "size": 4123456, "type": "audio/mpeg" },
    { "path": "cover/front.jpg", "size": 256888, "type": "image/jpeg" },
    { "path": "theme/dark.json", "size": 512, "type": "application/json" },
    { "path": "background/stage.webp", "size": 98765, "type": "image/webp" }
  ]
}
```

- 不做压缩：音频本身是压缩格式，谱面 / 主题很小；省掉解压依赖。
- 文件路径不允许 `..` / 绝对路径 / 重复；解包时会校验长度和越界。
- `audio` / `cover` 可以是 `null`：游戏退回合成鼓组 / 不画封面；`theme` / `background` 可选。
- 一个包当前只放**一张谱**；多谱、DLC、签名 / 加密以后可以升 `version`。

格式实现：`src/pack/format.ts`；浏览器读取辅助：`src/pack/io.ts`。

## 编辑器

- `EXPORT` → 导出 `.parallax`（当前谱面 + 已导入的音轨 + 导入包时保留的其它资源）；
- `JSON` → 仍导出旧的 `.parallax.json`，用于调试 / 兼容；
- `IMPORT` 接受 `.parallax` 和 `.json`；
- 导入包时会把音频自动载入，不需要再单独拖音频；
- 音频里的 FLAC PICTURE / Vorbis `METADATA_BLOCK_PICTURE`、MP3 ID3 `APIC`
  会自动取封面；没有就显示 `NO COVER`，可以在检查器 `COVER` 里手动选图片；
- 主题 / 背景等未知资源会被原样保留在包内并随下一次导出写回；当前编辑器还没有
  主题 / 背景 UI，但格式已经预留。

## 游戏

```text
?pack=/packages/air-example.parallax
?pack=air-example                 # 自动补 /packages/air-example.parallax
```

仓库自带示例：`public/packages/air-example.parallax`（只有谱面 + 一个主题 JSON，没有音轨）。

`public/packages/` 只是一个静态目录，**不会自动扫描成曲目列表**；当前菜单只显示
“当前加载的包 + 两张内置谱”。要加载包，必须用 `?pack=`，或在页面左下角 `LOAD .parallax`。
一次只保留一个本地包，后加载的会替换前一个。

**不想复制文件时**：游戏页左下角有 `LOAD .parallax`，选择 / 拖入导出的包会写进
IndexedDB 然后 reload 成 `?localPack=1` 直接开始玩。适合桌面和 Quest 浏览器。

> IndexedDB 按 **origin** 隔离：在 `localhost:5173` 加载的包不会出现在
> `parallax-vr.pages.dev`。要在 Quest 的 Pages 页面里重新 Load，或直接用
> `?pack=/packages/xxx.parallax`。

旧的加载方式仍可用：

```text
?chart=/charts/air-example.json
?audio=/audio/track.mp3
```

## 素材源目录（建议）

```text
resources/
  charts/          # 工作用谱面 JSON（也可以直接由编辑器导出）
  audio/           # 原始音轨
  themes/          # dark.json / light.json
  backgrounds/     # 背景图 / 视频
```

这个目录只用于作者整理素材；发行物是 `.parallax`。如果以后做批量打包，
可以加一个 `npm run pack`，把 `resources/` 里的条目打成包，但当前先用编辑器导出。

## 当前限制

- 不做压缩 / 加密 / 签名；
- 一个包一张谱；
- 音频封面目前只解析 FLAC / MP3；M4A / OGG 的内嵌封面留到后续；
- `theme` / `background` 只是被携带和保留，游戏还没有读取它们来切换外观；
- 浏览器下载 / 导入文件仍受 File API 限制，音频不会进 localStorage 草稿。
