import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';

class Pairing {
  final Uri url;
  final String fingerprint;
  final String token;
  const Pairing(this.url, this.fingerprint, this.token);
  factory Pairing.parse(String value) {
    final json = jsonDecode(value) as Map<String, dynamic>;
    final url = Uri.parse(json['url'] as String);
    if (url.scheme != 'https' ||
        url.host.isEmpty ||
        url.userInfo.isNotEmpty ||
        (url.path.isNotEmpty && url.path != '/') ||
        url.hasQuery ||
        url.hasFragment) {
      throw const FormatException('配对地址必须是 HTTPS 服务地址');
    }
    final pin = (json['fingerprint'] as String).toLowerCase();
    if (!RegExp(r'^[a-f0-9]{64}$').hasMatch(pin)) {
      throw const FormatException('配对信息缺少证书指纹');
    }
    return Pairing(url, pin, json['token'] as String? ?? '');
  }
  String serialize() => jsonEncode({
    'url': url.toString(),
    'fingerprint': fingerprint,
    'token': token,
  });
}

class ApiError implements Exception {
  final String message;
  final int status;
  const ApiError(this.message, [this.status = 0]);
  @override
  String toString() => message;
}

class WhaleApi {
  final Pairing pairing;
  late final HttpClient _client;
  WhaleApi(this.pairing) {
    _client = HttpClient(context: SecurityContext(withTrustedRoots: false));
    _client.connectionTimeout = const Duration(seconds: 12);
    _client.badCertificateCallback = (cert, host, port) =>
        host == pairing.url.host &&
        port == pairing.url.port &&
        sha256.convert(cert.der).toString() == pairing.fingerprint;
  }
  Future<Map<String, dynamic>> request(
    String path, {
    Map<String, dynamic>? data,
  }) async {
    try {
      final req = await _client.openUrl(
        data == null ? 'GET' : 'POST',
        pairing.url.resolve(path),
      );
      req.followRedirects = false;
      req.headers.contentType = ContentType.json;
      if (pairing.token.isNotEmpty) {
        req.headers.set('authorization', 'Bearer ${pairing.token}');
      }
      if (data != null) req.write(jsonEncode(data));
      final res = await req.close().timeout(const Duration(seconds: 20));
      final text = await res
          .transform(utf8.decoder)
          .join()
          .timeout(const Duration(seconds: 20));
      final result = jsonDecode(text) as Map<String, dynamic>;
      if (res.statusCode >= 300) {
        throw ApiError(result['error'] as String? ?? '连接失败', res.statusCode);
      }
      return result;
    } on ApiError {
      rethrow;
    } on HandshakeException {
      throw const ApiError('服务器证书与配对信息不一致，请重新配对');
    } on SocketException {
      throw const ApiError('连不上电脑，请检查电脑服务和手机网络');
    } on TimeoutException {
      throw const ApiError('网络等待超时，发送结果可能尚未返回，请刷新查看');
    } catch (_) {
      throw const ApiError('连接暂时不可用，请稍后刷新查看');
    }
  }

  void close() => _client.close(force: true);
}
