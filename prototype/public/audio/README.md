# Audio assets

- `hit-click.wav` — 取自 Kenney 的 **UI Audio** 包（`click5.wav`），授权 **CC0 1.0**。
  原始素材：https://kenney.nl/assets/ui-audio
  仓库镜像：https://github.com/Calinou/kenney-ui-audio
  用途：游玩端 hit / drag 的轻打击音。运行时再经过低通和低增益处理，避免太尖、太响。
  hit 还叠一层极短的低频合成音（186→74Hz）作为“重量层”；drag 仍只播放原始 sample。
