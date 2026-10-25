# 上游与素材

## 代码与组件

- [sj244/dsh-qq-bridge](https://github.com/sj244/dsh-qq-bridge)：QQ桥接上游，MIT，Copyright (c) 2026 sj244。原版权保留于 `bridge-src/LICENSE` 与根LICENSE；本仓库为定制扩展，不代表上游官方发行。
- DSH (`@deepseek-ai/dsh`) 与meow-memory：作为外部宿主/记忆插件使用，不随本仓库分发；遵循各包自身许可。
- [MediaPipe](https://github.com/google-ai-edge/mediapipe)：Tasks Vision 1.1.1，Apache-2.0。运行时由安装脚本下载；手/脸模型来自Google官方存储，模型遵循其发布条款。
- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)：本机语音识别接口，Apache-2.0；SenseVoice模型由其官方release下载，模型许可证以发布包为准。
- [edge-tts](https://github.com/rany2/edge-tts)：LGPL-3.0，作为独立Python依赖安装。Microsoft语音服务本身并非本项目开源代码，使用受服务条款约束。
- Flutter及各pub依赖、Node qrcode：外部依赖，许可见各依赖包；本项目的MIT许可不替代它们。

## Windows 在线安装器的外部下载

安装 EXE 内含本项目干净源码和安装脚本，不内嵌第三方可执行文件、模型或账号。安装时从 `installer/dependencies.json` 声明的官方地址下载指定版本，并核对 SHA256；npm/PyPI 的依赖按版本和软件包完整性机制下载。依赖的许可证及通知保留在各自安装目录，不能视为本项目 MIT 代码。

- Node.js 24.20.0：Node.js 许可及捆绑第三方通知，见 https://github.com/nodejs/node/blob/v24.20.0/LICENSE 。
- PowerShell 7.5.4：MIT 及第三方通知，见 https://github.com/PowerShell/PowerShell/tree/v7.5.4 。
- Python 3.12.10：PSF 许可，见 https://www.python.org/downloads/release/python-31210/ 。
- pip 25.3：MIT，见 https://github.com/pypa/pip/tree/25.3 。
- FFmpeg 7.1.1 essentials：由 GyanD 编译的外部 GPL 构建，官方构建与源码信息 https://www.gyan.dev/ffmpeg/builds/ ，对应版本 https://github.com/GyanD/codexffmpeg/releases/tag/7.1.1 ，FFmpeg 源码 https://github.com/FFmpeg/FFmpeg/tree/n7.1.1 。本项目不重新封装其二进制；安装器保留下载包中的 LICENSE/说明。
- MediaPipe、SenseVoice、sherpa-onnx、DSH、meow-memory、edge-tts、numpy 和其传递依赖各自适用原许可；下载包与 Python/npm 元数据是最终依据。

## 笑、哭、叹气

当前自然短音效来自Freesound的CC0素材，经裁切、响度调整、重采样和淡入淡出处理，没有进行音色克隆。

- DarkNightPrincess: https://freesound.org/people/DarkNightPrincess/sounds/611781/
- DarkNightPrincess: https://freesound.org/people/DarkNightPrincess/sounds/621773/
- mvVoiceActing: https://freesound.org/people/mvVoiceActing/sounds/218184/
- CC0 1.0: https://creativecommons.org/publicdomain/zero/1.0/

详细来源见 `bridge-src/assets/voice-clips/natural/ATTRIBUTION.md`。`cute/`、`gentle/`中的旧素材为TTS生成输出，声音输出不因代码MIT许可而获得第三方音色权益。

## 图像

书房背景、站姿及坐姿图集为项目开发时以提供的角色/场景参考进行AI生成的演示素材，未包含私人原始参考截图。`whale.png`为客户端角色图标。代码许可不替代任何可能涉及的参考角色、商标和素材权益；需要明确可再许可角色资产的场景，请使用自己拥有权利的图像替换。

图集格式：1536×1024、三列两行RGBA；第一行为睁眼、第二行为闭眼，各列为闭嘴/小开口/中开口。精确裁切与桌面合成见 `desktop-app/public/avatar.mjs`。背景与人物拆开，人物嘴形由实际播放声音响度驱动。
