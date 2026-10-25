import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:speech_to_text/speech_to_text.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:camera/camera.dart';
import 'package:uuid/uuid.dart';
import 'package:image/image.dart' as img;

import 'api.dart';

const ocean = Color(0xFF136B85), paper = Color(0xFFF0F7FA);
const storage = FlutterSecureStorage();
Uint8List compressFrame(Uint8List bytes) {
  final decoded = img.decodeImage(bytes);
  if (decoded == null) throw const FormatException('无法读取画面');
  final oriented = img.bakeOrientation(decoded);
  return Uint8List.fromList(
    img.encodeJpg(
      img.copyResize(
        oriented,
        width: oriented.width > 640 ? 640 : oriented.width,
      ),
      quality: 65,
    ),
  );
}

class WhaleApp extends StatelessWidget {
  const WhaleApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: '鲸鱼娘',
    debugShowCheckedModeBanner: false,
    theme: ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(seedColor: ocean),
      scaffoldBackgroundColor: paper,
      appBarTheme: const AppBarTheme(backgroundColor: paper),
    ),
    home: const HomePage(),
  );
}

class HomePage extends StatefulWidget {
  const HomePage({super.key});
  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> with WidgetsBindingObserver {
  WhaleApi? api;
  final input = TextEditingController(), scroll = ScrollController();
  final tts = FlutterTts();
  final speech = SpeechToText();
  List<Map<String, dynamic>> messages = [];
  String person = '', notice = '', partial = '';
  bool loading = true,
      busy = false,
      inCall = false,
      speaking = false,
      listening = false;
  bool micMuted = false,
      shareOnVoice = false,
      cameraBusy = false,
      voicePreparing = false;
  CameraController? camera;
  bool foreground = true;
  Timer? restart;
  int callEpoch = 0, listenEpoch = 0, submittedEpoch = -1;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_load());
  }

  Future<void> _load() async {
    try {
      final value = await storage.read(key: 'pairing');
      if (value != null) {
        api = WhaleApi(Pairing.parse(value));
        await _refresh();
      }
      await tts.setLanguage('zh-CN');
      await tts.setSpeechRate(0.48);
      await tts.awaitSpeakCompletion(true);
    } catch (e) {
      notice = e.toString();
    }
    if (mounted) setState(() => loading = false);
  }

  Future<void> _refresh() async {
    final client = api;
    if (client == null) return;
    final me = await client.request('/v1/me'),
        history = await client.request('/v1/history');
    if (!mounted || client != api) return;
    setState(() {
      person = (me['principal'] as Map)['name'] as String;
      messages = (history['messages'] as List)
          .map((v) => Map<String, dynamic>.from(v as Map))
          .toList();
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && scroll.hasClients) {
        unawaited(
          scroll.animateTo(
            scroll.position.maxScrollExtent,
            duration: const Duration(milliseconds: 240),
            curve: Curves.easeOut,
          ),
        );
      }
    });
  }

  void _error(Object e) {
    if (mounted) setState(() => notice = e.toString());
  }

  Future<void> _pair() async {
    final text = await Navigator.of(context)
        .push<String>(MaterialPageRoute(builder: (_) => const PairPage()));
    if (text == null || !mounted) return;
    WhaleApi? candidate;
    try {
      final json = jsonDecode(text) as Map<String, dynamic>,
          pairing = Pairing.parse(text);
      candidate = WhaleApi(pairing);
      final result = await candidate.request(
        '/v1/pair',
        data: {
          'code': json['code'],
          'deviceName': Platform.isIOS ? 'iPhone' : 'Android',
        },
      );
      final paired = Pairing(
        pairing.url,
        pairing.fingerprint,
        result['token'] as String,
      );
      await storage.write(key: 'pairing', value: paired.serialize());
      await storage.delete(key: 'pending-message');
      api?.close();
      api = WhaleApi(paired);
      if (mounted) {
        setState(() {
          notice = '';
          messages = [];
        });
      }
      await _refresh();
    } catch (e) {
      _error(e);
    } finally {
      candidate?.close();
    }
  }

  Future<void> _unpair() async {
    await _hangup();
    await storage.delete(key: 'pairing');
    await storage.delete(key: 'pending-message');
    api?.close();
    api = null;
    if (mounted) {
      setState(() {
        messages = [];
        person = '';
        notice = '';
      });
    }
  }

  Future<void> _send(String text, {String? image}) async {
    final client = api;
    if (client == null || busy || text.trim().isEmpty) return;
    final epoch = callEpoch;
    setState(() {
      busy = true;
      notice = '';
      partial = '';
      listening = false;
    });
    restart?.cancel();
    await speech.stop();
    final id = const Uuid().v4();
    try {
      await storage.write(key: 'pending-message', value: id);
      input.clear();
      var job = await client.request(
        '/v1/chat',
        data: {'id': id, 'text': text.trim(), 'image': ?image},
      );
      await _refresh();
      final deadline = DateTime.now().add(const Duration(seconds: 210));
      while (job['status'] == 'pending') {
        if (DateTime.now().isAfter(deadline)) {
          throw const ApiError('她还没有回完，稍后点刷新查看；消息不会自动重发');
        }
        await Future<void>.delayed(const Duration(milliseconds: 900));
        if (!mounted || api != client) return;
        job = await client.request('/v1/jobs/$id');
      }
      if (job['status'] != 'done') {
        throw ApiError(job['error'] as String? ?? '暂时没有回复');
      }
      await storage.delete(key: 'pending-message');
      await _refresh();
      if (inCall && epoch == callEpoch && mounted) {
        setState(() {
          speaking = true;
        });
        try {
          await tts.speak(job['text'] as String);
        } finally {
          if (mounted) setState(() => speaking = false);
        }
      }
    } catch (e) {
      _error(e);
    } finally {
      if (mounted) {
        setState(() => busy = false);
        _scheduleListen();
      }
    }
  }

  Future<void> _recover() async {
    try {
      final id = await storage.read(key: 'pending-message');
      if (id != null && api != null) {
        final job = await api!.request('/v1/jobs/$id');
        if (job['status'] == 'done') {
          await storage.delete(key: 'pending-message');
          if (mounted) setState(() => notice = '已找回上一条回复');
        } else if (job['status'] == 'pending') {
          if (mounted) setState(() => notice = '她仍在回复上一条，请稍后刷新');
        } else {
          await storage.delete(key: 'pending-message');
          _error(ApiError(job['error'] as String? ?? '上次请求未完成'));
        }
      }
      await _refresh();
    } catch (e) {
      _error(e);
    }
  }

  Future<void> _call() async {
    if (api == null) {
      await _pair();
      return;
    }
    try {
      final ok = await speech.initialize(
        onStatus: (status) {
          if (!mounted) return;
          setState(() => listening = speech.isListening);
          if (status == 'done' || status == 'notListening') _scheduleListen();
        },
        onError: (e) {
          if (mounted) {
            setState(() {
              listening = false;
              notice = '暂时没听清，可重新开麦或打字（${e.errorMsg}）';
            });
          }
          if (!e.permanent) _scheduleListen();
        },
      );
      if (!ok) throw const ApiError('系统语音识别不可用，请检查麦克风和语音服务权限');
      if (!mounted || !foreground) return;
      setState(() {
        inCall = true;
        micMuted = false;
        notice = '';
        callEpoch++;
      });
      await _listen();
    } catch (e) {
      _error(e);
    }
  }

  void _scheduleListen() {
    restart?.cancel();
    if (foreground &&
        inCall &&
        !micMuted &&
        !busy &&
        !speaking &&
        !voicePreparing) {
      restart = Timer(
        const Duration(milliseconds: 850),
        () => unawaited(_listen()),
      );
    }
  }

  Future<void> _listen() async {
    if (!mounted ||
        !foreground ||
        !inCall ||
        micMuted ||
        busy ||
        speaking ||
        voicePreparing ||
        speech.isListening) {
      return;
    }
    final epoch = ++listenEpoch;
    try {
      final chinese = (await speech.locales())
          .where((l) => l.localeId.toLowerCase().startsWith('zh'))
          .toList();
      if (!mounted || !foreground || !inCall || micMuted || busy || speaking) {
        return;
      }
      await speech.listen(
        listenOptions: SpeechListenOptions(
          localeId: chinese.isEmpty ? null : chinese.first.localeId,
          listenFor: const Duration(seconds: 50),
          pauseFor: const Duration(seconds: 3),
          partialResults: true,
          cancelOnError: true,
          listenMode: ListenMode.dictation,
        ),
        onResult: (result) {
          if (!mounted || !inCall || micMuted || epoch != listenEpoch) return;
          setState(() => partial = result.recognizedWords);
          if (result.finalResult &&
              result.recognizedWords.trim().isNotEmpty &&
              submittedEpoch != epoch &&
              !busy &&
              !voicePreparing) {
            submittedEpoch = epoch;
            unawaited(_sendVoice(result.recognizedWords));
          }
        },
      );
      if (!mounted || !foreground || !inCall || epoch != listenEpoch) {
        await speech.stop();
        return;
      }
      setState(() => listening = speech.isListening);
    } catch (e) {
      _error(e);
    }
  }

  Future<void> _sendVoice(String text) async {
    final epoch = callEpoch;
    voicePreparing = true;
    listenEpoch++;
    restart?.cancel();
    try {
      await speech.stop();
      String? frame;
      if (shareOnVoice && camera != null) {
        try {
          frame = await _frame();
        } catch (e) {
          _error(e);
        }
      }
      if (!shareOnVoice) frame = null;
      if (inCall && epoch == callEpoch && mounted) {
        await _send(text, image: frame);
      }
    } finally {
      voicePreparing = false;
      _scheduleListen();
    }
  }

  Future<void> _interrupt() async {
    await tts.stop();
    if (mounted) setState(() => speaking = false);
    _scheduleListen();
  }

  Future<void> _toggleMic() async {
    setState(() {
      micMuted = !micMuted;
      listening = false;
      listenEpoch++;
    });
    restart?.cancel();
    await speech.stop();
    if (!micMuted) _scheduleListen();
  }

  Future<void> _camera() async {
    if (camera != null) {
      final old = camera;
      camera = null;
      shareOnVoice = false;
      if (mounted) setState(() {});
      await old?.dispose();
      return;
    }
    if (cameraBusy) return;
    cameraBusy = true;
    final epoch = callEpoch;
    CameraController? next;
    try {
      final devices = await availableCameras();
      if (devices.isEmpty) throw const ApiError('没有可用摄像头');
      final front = devices.where(
        (d) => d.lensDirection == CameraLensDirection.front,
      );
      next = CameraController(
        front.isNotEmpty ? front.first : devices.first,
        ResolutionPreset.medium,
        enableAudio: false,
        imageFormatGroup: ImageFormatGroup.jpeg,
      );
      await next.initialize();
      if (!mounted || !inCall || epoch != callEpoch) {
        await next.dispose();
        return;
      }
      setState(() => camera = next);
    } catch (e) {
      await next?.dispose();
      _error(e);
    } finally {
      cameraBusy = false;
    }
  }

  Future<String> _frame() async {
    final active = camera;
    if (active == null || !active.value.isInitialized) {
      throw const ApiError('请先打开摄像头');
    }
    final shot = await active.takePicture();
    try {
      final bytes = await compute(compressFrame, await shot.readAsBytes());
      if (bytes.length > 330000) throw const ApiError('画面较大，请稍后再试');
      return base64Encode(bytes);
    } finally {
      try {
        await File(shot.path).delete();
      } catch (_) {}
    }
  }

  Future<void> _share() async {
    if (busy || cameraBusy || voicePreparing) return;
    final epoch = callEpoch;
    try {
      final frame = await _frame();
      if (inCall && camera != null && epoch == callEpoch && mounted) {
        await _send('看看我现在的画面，陪我聊两句。', image: frame);
      }
    } catch (e) {
      _error(e);
    }
  }

  Future<void> _hangup() async {
    restart?.cancel();
    callEpoch++;
    listenEpoch++;
    if (mounted) {
      setState(() {
        inCall = false;
        speaking = false;
        listening = false;
        partial = '';
        shareOnVoice = false;
      });
    }
    await speech.stop();
    await tts.stop();
    final old = camera;
    camera = null;
    await old?.dispose();
    if (mounted) setState(() {});
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) foreground = true;
    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.detached) {
      foreground = false;
      unawaited(_hangup());
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    restart?.cancel();
    callEpoch++;
    listenEpoch++;
    unawaited(speech.cancel());
    unawaited(tts.stop());
    unawaited(camera?.dispose() ?? Future<void>.value());
    api?.close();
    input.dispose();
    scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = speaking
        ? '她正在说话'
        : busy
        ? '本鱼在想怎么回你…'
        : listening
        ? '在听你说话'
        : inCall
        ? '陪着你呢'
        : '今天也想听你说说话';
    return Scaffold(
      appBar: AppBar(
        title: const Text('鲸鱼娘', style: TextStyle(fontWeight: FontWeight.w700)),
        actions: [
          if (api != null)
            IconButton(
              onPressed: busy ? null : _recover,
              icon: const Icon(Icons.refresh),
              tooltip: '刷新记录',
            ),
          PopupMenuButton<String>(
            onSelected: (v) =>
                v == 'pair' ? unawaited(_pair()) : unawaited(_unpair()),
            itemBuilder: (_) => [
              const PopupMenuItem(value: 'pair', child: Text('配对手机')),
              if (api != null)
                const PopupMenuItem(value: 'leave', child: Text('断开这台手机')),
            ],
          ),
        ],
      ),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : SafeArea(
              child: Column(
                children: [
                  Container(
                    margin: const EdgeInsets.fromLTRB(16, 4, 16, 10),
                    padding: const EdgeInsets.all(18),
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        colors: [Color(0xFFD8EFF6), Color(0xFFE8F6F5)],
                      ),
                      borderRadius: BorderRadius.circular(26),
                    ),
                    child: Row(
                      children: [
                        AnimatedScale(
                          scale: speaking ? 1.12 : 1,
                          duration: const Duration(milliseconds: 450),
                          child: const CircleAvatar(
                            radius: 34,
                            backgroundColor: Colors.white70,
                            child: Text('🐋', style: TextStyle(fontSize: 42)),
                          ),
                        ),
                        const SizedBox(width: 16),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                api == null ? '让本鱼住进手机里' : '你好呀，$person',
                                style: const TextStyle(
                                  fontSize: 19,
                                  fontWeight: FontWeight.bold,
                                  color: ocean,
                                ),
                              ),
                              const SizedBox(height: 7),
                              Text(
                                state,
                                style: const TextStyle(
                                  color: Color(0xFF537889),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (notice.isNotEmpty)
                    Container(
                      width: double.infinity,
                      margin: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 4,
                      ),
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: const Color(0xFFFFF0D7),
                        borderRadius: BorderRadius.circular(14),
                      ),
                      child: Text(notice, style: const TextStyle(fontSize: 13)),
                    ),
                  if (camera != null && camera!.value.isInitialized)
                    SizedBox(
                      height: 145,
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(18),
                        child: AspectRatio(
                          aspectRatio: camera!.value.aspectRatio,
                          child: CameraPreview(camera!),
                        ),
                      ),
                    ),
                  if (camera != null)
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        TextButton.icon(
                          onPressed: busy ? null : _share,
                          icon: const Icon(Icons.photo_camera_outlined),
                          label: const Text('给她看一下'),
                        ),
                        const Text('随语音分享'),
                        Switch(
                          value: shareOnVoice,
                          onChanged: (v) => setState(() => shareOnVoice = v),
                        ),
                      ],
                    ),
                  Expanded(
                    child: api == null
                        ? Center(
                            child: Padding(
                              padding: const EdgeInsets.all(32),
                              child: Column(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  const Text(
                                    '扫码连接电脑上的鲸鱼娘\n聊天和记忆都会接着走',
                                    textAlign: TextAlign.center,
                                    style: TextStyle(
                                      fontSize: 19,
                                      height: 1.8,
                                      color: ocean,
                                    ),
                                  ),
                                  const SizedBox(height: 24),
                                  FilledButton.icon(
                                    onPressed: _pair,
                                    icon: const Icon(Icons.qr_code_scanner),
                                    label: const Text('配对我的手机'),
                                  ),
                                  const SizedBox(height: 18),
                                  const Text(
                                    '你和朋友各用自己的配对码',
                                    style: TextStyle(color: Colors.blueGrey),
                                  ),
                                ],
                              ),
                            ),
                          )
                        : messages.isEmpty
                        ? const Center(
                            child: Text(
                              '说声“在吗”，本鱼就来啦～',
                              style: TextStyle(color: Colors.blueGrey),
                            ),
                          )
                        : ListView.builder(
                            controller: scroll,
                            padding: const EdgeInsets.symmetric(
                              horizontal: 18,
                              vertical: 12,
                            ),
                            itemCount: messages.length,
                            itemBuilder: (_, i) {
                              final m = messages[i], mine = m['role'] == 'user';
                              return Align(
                                alignment: mine
                                    ? Alignment.centerRight
                                    : Alignment.centerLeft,
                                child: Container(
                                  constraints: const BoxConstraints(
                                    maxWidth: 320,
                                  ),
                                  margin: const EdgeInsets.only(bottom: 12),
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 16,
                                    vertical: 12,
                                  ),
                                  decoration: BoxDecoration(
                                    color: mine ? ocean : Colors.white,
                                    borderRadius: BorderRadius.circular(18),
                                  ),
                                  child: SelectableText(
                                    m['text'] as String,
                                    style: TextStyle(
                                      fontSize: 16,
                                      height: 1.5,
                                      color: mine
                                          ? Colors.white
                                          : const Color(0xFF254655),
                                    ),
                                  ),
                                ),
                              );
                            },
                          ),
                  ),
                  if (partial.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.all(8),
                      child: Text(
                        '听到：$partial',
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(color: ocean),
                      ),
                    ),
                  if (inCall)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      child: Wrap(
                        alignment: WrapAlignment.center,
                        spacing: 10,
                        children: [
                          IconButton.filledTonal(
                            onPressed: _toggleMic,
                            icon: Icon(micMuted ? Icons.mic_off : Icons.mic),
                            tooltip: micMuted ? '开麦' : '闭麦',
                          ),
                          IconButton.filledTonal(
                            onPressed: _interrupt,
                            icon: const Icon(Icons.back_hand_outlined),
                            tooltip: '打断她',
                          ),
                          IconButton.filledTonal(
                            onPressed: cameraBusy ? null : _camera,
                            icon: Icon(
                              camera == null
                                  ? Icons.videocam_outlined
                                  : Icons.videocam_off_outlined,
                            ),
                            tooltip: camera == null ? '打开摄像头' : '关闭摄像头',
                          ),
                          IconButton.filled(
                            onPressed: _hangup,
                            style: IconButton.styleFrom(
                              backgroundColor: const Color(0xFFD75564),
                            ),
                            icon: const Icon(Icons.call_end),
                            tooltip: '挂断',
                          ),
                        ],
                      ),
                    ),
                  if (inCall)
                    const Padding(
                      padding: EdgeInsets.only(bottom: 8),
                      child: Text(
                        '系统语音服务可能联网 · 离开 App 自动挂断',
                        style: TextStyle(fontSize: 11, color: Colors.blueGrey),
                      ),
                    ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 4, 14, 12),
                    child: Row(
                      children: [
                        if (!inCall)
                          IconButton.filledTonal(
                            onPressed: busy ? null : _call,
                            icon: const Icon(Icons.call_outlined),
                            tooltip: '语音陪聊',
                          ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: TextField(
                            controller: input,
                            maxLength: 2000,
                            minLines: 1,
                            maxLines: 3,
                            decoration: InputDecoration(
                              counterText: '',
                              hintText: '和本鱼说点什么…',
                              filled: true,
                              fillColor: Colors.white,
                              border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(24),
                                borderSide: BorderSide.none,
                              ),
                            ),
                            onSubmitted: (s) => unawaited(_send(s)),
                          ),
                        ),
                        const SizedBox(width: 8),
                        IconButton.filled(
                          onPressed: api == null || busy
                              ? null
                              : () => _send(input.text),
                          icon: busy
                              ? const SizedBox(
                                  width: 18,
                                  height: 18,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                    color: Colors.white,
                                  ),
                                )
                              : const Icon(Icons.arrow_upward),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
    );
  }
}

class PairPage extends StatefulWidget {
  const PairPage({super.key});
  @override
  State<PairPage> createState() => _PairPageState();
}

class _PairPageState extends State<PairPage> {
  final input = TextEditingController();
  @override
  void dispose() {
    input.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('配对鲸鱼娘')),
    body: ListView(
      padding: const EdgeInsets.all(24),
      children: [
        const Text(
          '在电脑上打开配对页面',
          style: TextStyle(
            fontSize: 24,
            fontWeight: FontWeight.bold,
            color: ocean,
          ),
        ),
        const SizedBox(height: 12),
        const Text(
          '每台手机单独扫码。配对码10分钟有效；你和朋友不要共用同一个码。',
          style: TextStyle(height: 1.7),
        ),
        const SizedBox(height: 24),
        FilledButton.icon(
          onPressed: () async {
            final value = await Navigator.of(
              context,
            ).push<String>(MaterialPageRoute(builder: (_) => const ScanPage()));
            if (value != null && context.mounted) {
              Navigator.of(context).pop(value);
            }
          },
          icon: const Icon(Icons.qr_code_scanner),
          label: const Text('扫描电脑上的二维码'),
        ),
        const SizedBox(height: 28),
        const Text('也可以粘贴配对信息'),
        const SizedBox(height: 10),
        TextField(
          controller: input,
          maxLines: 5,
          decoration: const InputDecoration(
            hintText: '粘贴电脑配对页面里的整段信息',
            border: OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: 16),
        OutlinedButton(
          onPressed: () => Navigator.of(context).pop(input.text.trim()),
          child: const Text('使用这段配对信息'),
        ),
      ],
    ),
  );
}

class ScanPage extends StatefulWidget {
  const ScanPage({super.key});
  @override
  State<ScanPage> createState() => _ScanPageState();
}

class _ScanPageState extends State<ScanPage> {
  final controller = MobileScannerController();
  bool found = false;
  @override
  void dispose() {
    unawaited(controller.dispose());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('扫描配对码')),
    body: MobileScanner(
      controller: controller,
      onDetect: (capture) {
        if (found) return;
        final raw = capture.barcodes
            .map((b) => b.rawValue)
            .whereType<String>()
            .firstOrNull;
        if (raw == null) return;
        try {
          Pairing.parse(raw);
          found = true;
          Navigator.of(context).pop(raw);
        } catch (_) {
          /* Unrelated QR code. */
        }
      },
    ),
  );
}
