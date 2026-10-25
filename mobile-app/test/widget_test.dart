import 'package:flutter_test/flutter_test.dart';
import 'package:whalegirl/api.dart';

void main() {
  test(
    'pairing refuses insecure origins, embedded credentials and invalid pins',
    () {
      for (final url in [
        'http://example.com',
        'https://user:pass@example.com',
        'https://example.com/path',
      ]) {
        expect(
          () => Pairing.parse('{"url":"$url","fingerprint":"${'a' * 64}"}'),
          throwsFormatException,
        );
      }
      expect(
        () =>
            Pairing.parse('{"url":"https://example.com","fingerprint":"bad"}'),
        throwsFormatException,
      );
    },
  );
  test('pairing round trips without dropping certificate pin', () {
    final pairing = Pairing.parse(
      '{"url":"https://192.168.1.2:3091","fingerprint":"${'a' * 64}","token":"test"}',
    );
    expect(Pairing.parse(pairing.serialize()).fingerprint, pairing.fingerprint);
    expect(pairing.url.port, 3091);
  });
}
