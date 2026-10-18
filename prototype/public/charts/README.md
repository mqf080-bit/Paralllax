# public/charts

制谱器导出的谱面 JSON 放这里。

游戏页用 URL 直接读：

```
http://127.0.0.1:5173/?chart=/charts/example.json
http://127.0.0.1:5173/?chart=/charts/air-example.json   # 空中 note + 显式 arc ticks
```

文件名随意；`?chart=demo` 仍切回内置的 12 秒示例，`?chart=test` / 不写参数跑内置验收谱。
音轨不会被写进 JSON；需要的话把音频也放到 `public/`，再加 `?audio=/your-track.mp3`。
