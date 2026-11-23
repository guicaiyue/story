import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:story_app/services/api_client.dart';

/// 请求头回归测试。
///
/// 背景（2026-11-23 在 waydroid 上验收 0.1.3 时发现）：生产入口前面有雷池 WAF，
/// **不带 User-Agent 的请求一律 403**，返回的是 `/.safeline/` 拦截页而不是服务端
/// JSON。Dart 的 `dart:io` HttpClient 默认不发 UA，于是 App 所有接口都 403、
/// 首页永远空白——0.1.2 和 0.1.3 都带着这个 bug 发出去过。
///
/// 这组测试盯住「发出去的请求必须带一个自有 UA」，防止将来有人把它删掉。
void main() {
  group('ApiClient 请求头', () {
    late Map<String, String> captured;

    ApiClient clientWith(void Function(http.Request) onRequest) {
      final mock = MockClient((request) async {
        onRequest(request);
        return http.Response(
          '{"ok":true,"data":{"items":[],"total":0}}',
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      });
      return ApiClient(httpClient: mock, baseUrl: 'https://example.test');
    }

    setUp(() => captured = {});

    test('GET 必须带 User-Agent（WAF 没有它直接 403）', () async {
      final client = clientWith((r) => captured = Map.of(r.headers));
      try {
        await client.categories();
      } catch (_) {
        // 解析失败无所谓，这里只关心请求头
      }
      expect(
        captured.keys.map((k) => k.toLowerCase()),
        contains('user-agent'),
        reason: '缺 User-Agent 会被雷池 WAF 拦成 403',
      );
    });

    test('User-Agent 不能是通用库名（在 WAF 扫描器指纹库里）', () async {
      final client = clientWith((r) => captured = Map.of(r.headers));
      try {
        await client.categories();
      } catch (_) {}
      final ua = captured.entries
          .firstWhere(
            (e) => e.key.toLowerCase() == 'user-agent',
            orElse: () => const MapEntry('', ''),
          )
          .value
          .toLowerCase();
      expect(ua, isNotEmpty);
      // 实测被拦的两种
      expect(ua, isNot(startsWith('okhttp')));
      expect(ua, isNot(startsWith('dart/')));
      // 应当是 App 自有标识
      expect(ua, contains('storynook'));
    });

    test('Accept 仍为 application/json', () async {
      final client = clientWith((r) => captured = Map.of(r.headers));
      try {
        await client.categories();
      } catch (_) {}
      final accept = captured.entries
          .firstWhere(
            (e) => e.key.toLowerCase() == 'accept',
            orElse: () => const MapEntry('', ''),
          )
          .value;
      expect(accept, contains('application/json'));
    });

    test('未登录时不发 Authorization', () async {
      final client = clientWith((r) => captured = Map.of(r.headers));
      try {
        await client.categories();
      } catch (_) {}
      expect(
        captured.keys.map((k) => k.toLowerCase()),
        isNot(contains('authorization')),
      );
    });
  });
}
