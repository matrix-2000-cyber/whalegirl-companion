# 开发与测试

Node.js 24。桌面和网关规则测试：

```powershell
npm ci --prefix mobile-gateway
node --test --test-isolation=none desktop-app/test/*.test.mjs mobile-gateway/test/*.test.mjs
```

插件集成测试需要已安装的兼容DSH包。Windows默认读取全局npm目录；其他目录用 `DSH_PACKAGE_JSON` 指向宿主package.json：

```powershell
$env:DSH_PACKAGE_JSON = '你的DSH安装目录/package.json'
node --experimental-vm-modules --test --test-isolation=none bridge-src/test/*.test.js
```

测试使用假OneBot和临时文件，不发送真实QQ消息，不调用付费模型。浏览器/真实麦克风、设备性能、网络、手机签名仍需另外验收。iOS工作流仅手动触发，输出未签名构建物。

请保持：主人/朋友记忆隔离、QQ固定收件人、视觉关闭后的结果丢弃、打断后不播放旧句子、最终文本不重复朗读、密钥只保存在本机。不要用清空历史或删除长期记忆的方式降低延迟。
