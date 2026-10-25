// Local diagnostic: exercise the actual Dart TLS client without pairing or
// sending a conversation. No private keys or credentials are printed.
import 'dart:convert';
import 'dart:io';
import 'package:crypto/crypto.dart';
import 'package:whalegirl/api.dart';

Future<void> main() async {
  final tls = jsonDecode(File('../.mobile-gateway/tls.json').readAsStringSync()) as Map;
  final pem = (tls['cert'] as String).split('\n').where((s) => !s.startsWith('---')).join();
  final pin = sha256.convert(base64Decode(pem)).toString();
  final url = Uri.parse('https://127.0.0.1:3091');
  final good = WhaleApi(Pairing(url, pin, ''));
  final wrong = WhaleApi(Pairing(url, '0' * 64, ''));
  try {
    final result = await good.request('/health');
    if (result['ok'] != true) throw StateError('Gateway health check failed');
    var refused = false;
    try { await wrong.request('/health'); } on ApiError { refused = true; }
    if (!refused) throw StateError('Wrong TLS pin was accepted');
    stdout.writeln(jsonEncode({'gatewayHealthy': true, 'incorrectCertificateRejected': true}));
  } finally { good.close(); wrong.close(); }
}
