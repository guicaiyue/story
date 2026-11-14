import 'package:flutter_test/flutter_test.dart';
import 'package:story_app/services/api_client.dart';
import 'package:story_app/services/token_store.dart';

import 'helpers.dart';

/// 03-decisions D6：游客注册时机 = 启动即注册。
///
/// 这里最要紧的一条是「**不能每次启动都新建账号**」：
/// 服务端 `POST /api/auth/register-device` 每次调用都会创建新账号（没有设备
/// 标识字段），所以如果无条件注册，用户每次重启都会换身份，之前的
/// 继续听/收藏全部变成孤儿数据。因此启动时必须优先复用本地 token。
void main() {
  group('启动即注册', () {
    test('没有本地 token 时注册一次并持久化', () async {
      final store = MemoryTokenStore();
      final calls = <String>[];
      final api = ApiClient(
        httpClient: mockHttp({
          '/api/auth/register-device': okEnvelope({'token': 'tok-1', 'accountId': 'a1'}),
        }, seen: calls),
        baseUrl: 'http://test.local',
        tokenStore: store,
      );

      await api.ensureRegistered();

      expect(api.token, 'tok-1');
      expect(await store.read(), 'tok-1', reason: 'token 必须落本地');
      // mockHttp 的 seen 现在记录完整 URL（含 query），方便断言筛选参数。
      expect(calls, ['POST http://test.local/api/auth/register-device']);
    });

    test('已有本地 token 时直接复用，不重复注册', () async {
      final store = MemoryTokenStore('saved-tok');
      final calls = <String>[];
      final api = ApiClient(
        httpClient: mockHttp({}, seen: calls),
        baseUrl: 'http://test.local',
        tokenStore: store,
      );

      await api.ensureRegistered();

      expect(api.token, 'saved-tok');
      // 关键断言：没有发起注册请求，因此不会多出一个孤儿账号。
      expect(calls, isEmpty);
    });

    test('重复调用只注册一次（并发去重）', () async {
      final store = MemoryTokenStore();
      final calls = <String>[];
      final api = ApiClient(
        httpClient: mockHttp({
          '/api/auth/register-device': okEnvelope({'token': 'tok-x', 'accountId': 'a1'}),
        }, seen: calls),
        baseUrl: 'http://test.local',
        tokenStore: store,
      );

      await Future.wait([
        api.ensureRegistered(),
        api.ensureRegistered(),
        api.ensureRegistered(),
      ]);

      expect(api.token, 'tok-x');
      expect(
        calls.where((c) => c.contains('register-device')).length,
        1,
        reason: '并发调用不应产生多个账号',
      );
    });

    test('注册失败不抛异常（不阻塞 App 启动）', () async {
      final api = ApiClient(
        httpClient: mockHttp({}), // 全部 404
        baseUrl: 'http://test.local',
        tokenStore: MemoryTokenStore(),
      );

      // 不应抛出。
      await api.ensureRegistered();
      expect(api.token, isNull);
      expect(api.isRegistered, isFalse);
    });

    test('注册失败后再次调用会重试', () async {
      final store = MemoryTokenStore();
      var attempt = 0;
      final api = ApiClient(
        httpClient: mockHttpWith((path) {
          if (path == '/api/auth/register-device') {
            attempt++;
            if (attempt == 1) return jsonResponse(errEnvelope('暂时不可用', code: 'INTERNAL'), status: 500);
            return jsonResponse(okEnvelope({'token': 'tok-retry', 'accountId': 'a1'}));
          }
          return jsonResponse(errEnvelope('not found', code: 'NOT_FOUND'), status: 404);
        }),
        baseUrl: 'http://test.local',
        tokenStore: store,
      );

      await api.ensureRegistered();
      expect(api.token, isNull);

      await api.ensureRegistered();
      expect(api.token, 'tok-retry');
      expect(attempt, 2);
    });
  });

  group('401 兜底：补注册后重试', () {
    test('写接口 401 时补注册并重试一次（成功）', () async {
      final store = MemoryTokenStore();
      var registerCalls = 0;
      var progressCalls = 0;
      final api = ApiClient(
        httpClient: mockHttpWith((path) {
          if (path == '/api/auth/register-device') {
            registerCalls++;
            return jsonResponse(okEnvelope({'token': 'tok-new', 'accountId': 'a1'}));
          }
          if (path == '/api/progress/8') {
            progressCalls++;
            // 第一次 401，补注册后第二次成功。
            return progressCalls == 1
                ? jsonResponse(errEnvelope('未登录', code: 'UNAUTHORIZED'), status: 401)
                : jsonResponse(okEnvelope(<String, dynamic>{}));
          }
          return jsonResponse(errEnvelope('not found', code: 'NOT_FOUND'), status: 404);
        }),
        baseUrl: 'http://test.local',
        tokenStore: store,
      );

      await api.saveProgress(8, 30);

      expect(registerCalls, 1);
      expect(progressCalls, 2, reason: '应重试一次');
      expect(await store.read(), 'tok-new');
    });

    test('读取「继续听」401 时补注册并重试', () async {
      final store = MemoryTokenStore();
      var reads = 0;
      final api = ApiClient(
        httpClient: mockHttpWith((path) {
          if (path == '/api/auth/register-device') {
            return jsonResponse(okEnvelope({'token': 'tok-r', 'accountId': 'a1'}));
          }
          if (path == '/api/progress') {
            reads++;
            return reads == 1
                ? jsonResponse(errEnvelope('未登录', code: 'UNAUTHORIZED'), status: 401)
                : jsonResponse(okEnvelope([
                    {'storyId': 8, 'positionSec': 65},
                  ]));
          }
          return jsonResponse(errEnvelope('not found', code: 'NOT_FOUND'), status: 404);
        }),
        baseUrl: 'http://test.local',
        tokenStore: store,
      );

      final list = await api.progress();

      expect(list, hasLength(1));
      expect(list.first.positionSec, 65);
      expect(reads, 2);
    });

    test('补注册后仍 401 则如实抛出，不无限重试', () async {
      final store = MemoryTokenStore();
      var writes = 0;
      final api = ApiClient(
        httpClient: mockHttpWith((path) {
          if (path == '/api/auth/register-device') {
            return jsonResponse(okEnvelope({'token': 'tok-bad', 'accountId': 'a1'}));
          }
          if (path == '/api/favorites/8') {
            writes++;
            return jsonResponse(errEnvelope('仍未授权', code: 'UNAUTHORIZED'), status: 401);
          }
          return jsonResponse(errEnvelope('not found', code: 'NOT_FOUND'), status: 404);
        }),
        baseUrl: 'http://test.local',
        tokenStore: store,
      );

      await expectLater(
        api.addFavorite(8),
        throwsA(isA<ApiException>().having((e) => e.statusCode, 'status', 401)),
      );
      // 只重试一次，不能反复打。
      expect(writes, 2);
    });

    test('播放埋点 401 时补注册并重试', () async {
      final store = MemoryTokenStore();
      var plays = 0;
      final api = ApiClient(
        httpClient: mockHttpWith((path) {
          if (path == '/api/auth/register-device') {
            return jsonResponse(okEnvelope({'token': 'tok-p', 'accountId': 'a1'}));
          }
          if (path == '/api/plays') {
            plays++;
            return plays == 1
                ? jsonResponse(errEnvelope('未登录', code: 'UNAUTHORIZED'), status: 401)
                : jsonResponse(okEnvelope(<String, dynamic>{}));
          }
          return jsonResponse(errEnvelope('not found', code: 'NOT_FOUND'), status: 404);
        }),
        baseUrl: 'http://test.local',
        tokenStore: store,
      );

      await api.reportPlay(storyId: 8, event: 'start');

      expect(plays, 2);
      expect(api.token, 'tok-p');
    });

    test('公开接口的 401 不会触发注册（避免无谓请求）', () async {
      final calls = <String>[];
      final api = ApiClient(
        httpClient: mockHttpWith((path) {
          calls.add('GET $path');
          return jsonResponse(errEnvelope('wrapped', code: 'UNAUTHORIZED'), status: 401);
        }),
        baseUrl: 'http://test.local',
        tokenStore: MemoryTokenStore(),
      );

      await expectLater(api.categories(), throwsA(isA<ApiException>()));
      expect(calls.any((c) => c.contains('register-device')), isFalse);
    });
  });

  group('TokenStore', () {
    test('内存实现可读写清空', () async {
      final store = MemoryTokenStore();
      expect(await store.read(), isNull);
      await store.write('t');
      expect(await store.read(), 't');
      await store.clear();
      expect(await store.read(), isNull);
    });
  });
}
