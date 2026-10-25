# 鲸鱼娘 · WhaleGirl Companion

一个能听、能看、会主动搭话的虚拟陪伴项目。使用 DSH 负责对话与长期记忆，浏览器呈现书房中的二维角色，并在本机识别面部动作与手势。

![书房场景素材](desktop-app/public/study-room.png)

> 当前版本：0.4.0 安装预览版。Windows 电脑网页端是主要体验；仓库同时提供 Flutter Android/iOS 客户端源码。它是分阶段语音与视觉交互原型，尚未达到真人视频电话的延迟与可靠性。

## Windows 安装包（推荐新用户）

从 [GitHub Releases](https://github.com/matrix-2000-cyber/whalegirl-companion/releases/tag/v0.4.0) 下载 `WhaleGirl-Setup-0.4.0-win-x64.exe`，运行安装向导。它会自动下载独立运行环境、手/脸识别模型、语音识别模型，安装 DSH 和记忆插件，并创建桌面入口。首次联网下载约 1.7 GB 以上，请预留 5 GB 空间；速度取决于 npm、PyPI、GitHub 和 Google 模型源的可达性。

首次启动仍需在“打开模型设置”中登录自己的模型服务、选择支持对话/工具调用/视觉的模型，再开始聊天。安装包不提供账号或额度。当前 EXE 尚无代码签名，属于预览版；下载页附 SHA256 校验值与[隐私检查说明](docs/RELEASE-AUDIT.md)。

程序默认位于 `%LOCALAPPDATA%\Programs\WhaleGirlCompanion`，记忆和配置位于 `%LOCALAPPDATA%\WhaleGirlCompanionData`。专用端口为 3180/3191/3192，仅本机访问；安装、修复保留数据，不接管你原有的 DSH、QQ 或 NapCat。详细步骤见[安装包说明](docs/WINDOWS-SETUP.md)。

## 功能

- **语音对话**：本机 SenseVoice 识别、真实文本增量输出、按完整句子朗读、后续句子预取、开口打断试用。
- **看见画面**：通话期间后台间隔分析摄像头画面，聊天复用短时观察；询问当前细节时重新取帧。
- **表情互动**：MediaPipe Face Landmarker 识别微笑、眉部收紧、闭眼、点头等可见动作；结合谈话轻量回应。
- **手势互动**：食指追踪驱动眼神、挥手触发回礼；在本机 Worker 中运行。
- **角色表现**：眨眼、呼吸、声音响度驱动嘴形，支持笑、哭、叹气短音效。
- **主动陪聊**：打开摄像头后问候、空闲时发起话题，有忙碌判断、冷却和未回应抑制。
- **长期记忆**：主人视频通话使用轻量独立会话，与原会话共享工作目录和记忆；朋友隔离会话与记忆。
- **可选 QQ 桥接**：OneBot/NapCat 收发；文本单条20字、一轮最多6条，白名单默认关闭。
- **可选服务**：Cloudflare FLUX 生图、阿里云百炼情绪语音适配器；均需自己配置，不附带任何账号或额度。

## 快速开始（Windows 电脑）

需要 Node.js **24**、PowerShell **7.2+**、Python **3.11/3.12**、FFmpeg，以及可用的 DSH 对话/视觉模型配置。开发环境验证的 DSH 版本为 `0.2.1-rc.2`、meow-memory 为 `0.31.0`，使用其他版本需自行检查兼容性。

```powershell
git clone https://github.com/matrix-2000-cyber/whalegirl-companion.git
cd whalegirl-companion
npm ci --prefix mobile-gateway
pwsh -File scripts/setup-runtime.ps1
```

安装脚本只在本仓库的 `.desktop-runtime/` 下载视觉组件、模型和创建 Python 环境，不含任何密钥。首次下载可能较大；先查看 [安装指南](docs/INSTALL.md)。FFmpeg 需自行安装并加入 PATH。

1. 安装并启动 DSH，配置支持对话、工具调用与视觉的模型；模型服务可能按用量收费。
2. 在 DSH 安装本地桥接插件：`dsh plugin --profile web add "你的仓库绝对路径\bridge-src"`。本地链接需要能解析宿主 peer dependencies，详见安装指南。
3. 安装/启用 meow-memory（若需要长期记忆）。创建主人会话，记下会话编号与工作目录。
4. 参考 [examples/whale-girl.preset.yml](examples/whale-girl.preset.yml) 添加角色预设；在桥接设置填写 `targetSessionId` 和 `agentPreset=whale-girl`。**不要填示例中的假账号作为实际联系人**。
5. 用 `pwsh -File scripts/start-dsh.ps1` 启动你配置好的 DSH。若 DSH 已运行，先配置同样的环境变量并按宿主方式重载，不要重复启动。
6. 双击 `WhaleGirl-PC.cmd`，打开 `http://127.0.0.1:3092/`。先测试文字，再试听声音，最后打开摄像头与视频陪聊。

**新电脑必须完成 DSH 模型、插件与会话配置。下载仓库不会自动获得模型服务或原作者的记忆。**

## 文档

| 内容 | 入口 |
|---|---|
| 安装、模型与本机环境 | [INSTALL](docs/INSTALL.md) |
| 摄像头、语音、手势和排障 | [使用说明](docs/USAGE.md) |
| Android / iOS 构建与配对 | [移动端](docs/MOBILE.md) |
| 对话流程、记忆隔离、延迟优化 | [架构](docs/ARCHITECTURE.md) |
| 数据、密钥与本地端口 | [隐私与安全](SECURITY.md) |
| 上游项目、声音和图像来源 | [第三方说明](THIRD_PARTY_NOTICES.md) |
| 开发与测试 | [贡献指南](CONTRIBUTING.md) |

## 目录

```text
desktop-app/       电脑网页、角色动画、本机识别与语音服务
mobile-gateway/    HTTPS 配对、身份隔离、视觉短时缓存
mobile-app/        Flutter Android / iOS 客户端
bridge-src/        DSH 插件与可选 QQ 桥接
scripts/          公开版环境准备和 DSH 启动脚本
gen/              桌面启动、证书初始化与手机配对脚本
examples/         不含私人信息的角色预设和环境变量模板
```

## 验证与限制

公开版源码会运行插件、桌面/网关与安装归档安全检查。它们覆盖消息路由、增量输出、断句去重、记忆权限、视觉缓存、面部与手势规则、声音队列与隔离安装；模拟检查不代表不同设备的真实效果。

开发机真实服务样本：约0.8秒开始出字，提交文字到收到第一段音频约4.5秒。该数字不含用户说完前的录音时间，也不是扬声器实际发声时刻；网络、模型与语音服务会影响结果。

面部动作是互动线索，不能可靠地判断真实内心情绪。本项目不做心理诊断。角色是二维精灵图集，并非3D模型、Live2D或持续调用视频生成模型。Flutter 手机端目前功能与电脑端不同：按需分享画面、系统语音识别与朗读；iOS 尚需 Mac 签名和真机验证。

## 许可证

项目代码采用 [MIT](LICENSE)，保留上游 `sj244/dsh-qq-bridge` 的版权声明。模型、声音素材、AI图像和云端服务分别遵循其来源条款，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。仓库不包含聊天记录、记忆数据库、私人参考截图、API密钥、证书、设备配对资料或签名私钥。
