# 安装与配置

Windows 新用户优先使用[安装包](WINDOWS-SETUP.md)。以下是源码手动部署流程，端口与安装版不同。

## 1. 环境

主要支持 Windows 10/11。安装 Node.js 24、PowerShell 7.2以上、Python 3.11/3.12及 FFmpeg，确保 `node`、`pwsh`、`python`、`ffmpeg` 可以执行。Node 24用于内置WebSocket和测试接口。

```powershell
npm ci --prefix mobile-gateway
pwsh -File scripts/setup-runtime.ps1
```

准备脚本会：在 `.desktop-runtime/venv` 创建独立Python环境，安装 `edge-tts==7.3.1`、`numpy`、`sherpa-onnx`；将 MediaPipe Tasks Vision 1.1.1 安装到 `.desktop-runtime/vision`；从Google下载手部和面部模型；从sherpa-onnx官方GitHub Release下载SenseVoice模型。只想先准备视觉时可加 `-SkipSpeech`。

所需网络包括 npm/PyPI、Google模型存储与GitHub；运行时还需访问你配置的对话/视觉服务、Edge TTS或可选百炼服务。仓库不附带代理。Edge TTS是第三方客户端使用的网络服务，没有可用性承诺；可用 `WHALE_TTS_PROXY` 指定代理，或设置 `WHALE_TTS_USE_SYSTEM_PROXY=1` 使用系统环境代理。

## 2. DSH 和记忆

按 [DSH](https://github.com/deepseek-ai) 当前官方说明安装/配置。开发环境使用npm包 `@deepseek-ai/dsh@0.2.1-rc.2`；本项目依赖它的插件、agent和流式事件接口。

```powershell
npm install -g @deepseek-ai/dsh@0.2.1-rc.2
npm install --prefix bridge-src --ignore-scripts
dsh plugin --profile web add "你的仓库绝对路径\bridge-src"
```

`npm install`用于本地链接的peer依赖解析。若解析到与宿主不兼容的版本，应使用宿主实际安装的 `@deepseek-ai/*` 对应版本；不要复制他人的整个私密profile。桥接本身是MIT代码，DSH作为外部依赖安装，不在本仓库分发。

需要记忆时安装/启用 `meow-memory@0.31.0`。将 `examples/whale-girl.preset.yml` 的角色预设合入你自己的profile配置（不要覆盖整份配置）。在DSH界面创建主人会话，设置桥接的 `targetSessionId`、`agentPreset` 与可用 `visionModel`。对应配置字段见 `bridge-src/cordis.patch.yml`。

视频专用会话从主人会话取得真实工作目录；meow-memory通常在该目录的 `.dsh-meow/memory.db`。它不会自动复制别人的数据库；首次部署空记忆是正常的。朋友有各自独立工作目录。

公开版默认文件位置基于 `WHALEGIRL_ROOT`；启动DSH时使用：

```powershell
pwsh -File scripts/start-dsh.ps1
```

这个脚本设置项目路径、Python、模型和TTS脚本位置后启动DSH。已运行的DSH不会自动继承另一个终端的环境变量。QQ视频/语音文件的独立离线转写可以另设 `QQ_BRIDGE_ASR_SCRIPT`；本仓库桌面陪聊使用内置常驻识别器，不要求额外的meeting-tools目录。

## 3. 启动电脑端

```powershell
pwsh -File gen/start-desktop.ps1
```

脚本生成只留在本机的HTTPS证书并启动3091网关、3092网页。默认只监听回环地址。访问 `http://127.0.0.1:3092/`，电脑版由本机自动配对，无需扫手机二维码。

## 4. 可选服务

- **QQ**：自行安装/配置NapCat，在桥接设置填写OneBot地址和白名单。访问令牌通过环境变量或DSH凭据服务引用，不写入源码。默认OneBot地址和白名单为空。
- **定时QQ问候**：公开版中的数字为假账号。使用前用 `qq_bridge_greeting` 配置你自己的 `ownerId`、`wooId`、时间和开关；不需要时关闭。QQ出站仍必须命中白名单。
- **生图**：复制 `examples/env.example` 为根目录 `.env.local`，填写自己的Cloudflare配置。只有你确认免费计划时设置 `CLOUDFLARE_FREE_PLAN_CONFIRMED=1`。每日本地最多10次，失败也计数；供应商额度和政策以账户为准。
- **情绪语音**：仓库包含百炼适配器，不包含密钥或已购买的音色。免费默认路径为Edge TTS加短音效。百炼凭据文件格式见 `desktop-app/aliyun-voice.mjs`，只在本机创建，云服务按其定价结算。
- **B站发布/截图等旧扩展**：不包含本机账号、登录助手或私人脚本；必须自己显式配置外部脚本路径，核心陪聊不依赖它们。
