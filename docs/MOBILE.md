# Android / iOS 客户端

`mobile-app/` 是Flutter客户端，和电脑端共用HTTPS网关，但并非电脑网页的完整移植。目前为系统语音识别/朗读、按需分享摄像头帧、文字记录和轻量角色界面；电脑端的持续表情/手势Worker与书房图集体验以网页端为准。

## 构建

开发环境Flutter版本为3.47.8。安装Flutter、Android SDK后：

```sh
cd mobile-app
flutter pub get
flutter analyze
flutter test
flutter build apk --release
```

APK位于 `build/app/outputs/flutter-apk/`。仓库不附带发行签名；正式分发时配置自己的签名，并私下保存密钥。

iOS需要macOS与Xcode：

```sh
bash gen/build-ios.sh
open mobile-app/ios/Runner.xcworkspace
```

脚本生成未签名 `.app`，不能直接装到iPhone。选择自己的Apple团队、唯一Bundle ID后进行签名与真机测试；TestFlight需要相应Apple开发者资格。本项目未宣称iOS已完成签名或真机验收。

## 配对

首先在同一Wi-Fi测试。电脑网关默认回环，手机使用时显式开启局域网监听：

```powershell
pwsh -File gen/start-desktop.ps1 -Lan -NoOpen
pwsh -File gen/start-mobile.ps1 -Address '电脑局域网IP' -Role owner
# 朋友请另建独立身份：
pwsh -File gen/start-mobile.ps1 -Address '电脑局域网IP' -Role friend -Name '朋友'
```

若网关已按回环方式启动，先停止该项目记录的网关进程，再以 `-Lan` 重启，不要关闭不相关进程。脚本不改变防火墙；按自己的网络环境只开放必要网关端口。不要向互联网暴露DSH管理端口。

打开本机生成的 `.mobile-gateway/invite-owner.html` 或friend页面，用App扫码或复制配对内容。码10分钟有效、一次性使用，不要发布到GitHub。朋友不能共用主人配对码。

```powershell
node mobile-gateway/manage.mjs devices
node mobile-gateway/manage.mjs revoke '设备编号'
```

证书变更需要重新配对。锁屏/离开App会挂断；系统后台通话、推送与公网访问不属于当前已完成能力。
