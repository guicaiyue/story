import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config/app_config.dart';
import '../models/models.dart';
import 'token_store.dart';

/// API 基址统一由 `lib/config/app_config.dart` 定义（全 App 唯一来源）。
///
/// 这里**不再**自带默认值：旧的 `defaultValue: 'http://127.0.0.1:3000'` 会被
/// 静默编进发布包，导致 0.1.0 的 APK 在真机上指向手机自己（08 §1.9）。
///
/// re-export 是为了让既有调用点（`test_live/`）继续用 `kApiBaseUrl`，
/// 不必同时维护两套名字。
export '../config/app_config.dart' show kApiBaseUrl;

/// 接口错误。携带服务端返回的 code 与可读文案（02-architecture §4 的封套）。
class ApiException implements Exception {
  ApiException(this.message, {this.code = 'UNKNOWN', this.statusCode});

  final String message;
  final String code;
  final int? statusCode;

  @override
  String toString() => message;
}

/// 统一的 API 客户端。
///
/// 服务端响应恒为 `{ ok: true, data }` 或 `{ ok: false, error: { code, message } }`，
/// 这里负责解包并把失败转成 [ApiException]，页面只需处理成功值或错误文案。
class ApiClient {
  ApiClient({
    http.Client? httpClient,
    String? baseUrl,
    this.token,
    TokenStore? tokenStore,
  })  : _http = httpClient ?? http.Client(),
        baseUrl = normalizeApiBaseUrl(baseUrl ?? kApiBaseUrl),
        tokenStore = tokenStore ?? PrefsTokenStore();

  final http.Client _http;
  final String baseUrl;

  /// token 的持久化位置。
  ///
  /// **必须持久化**：`POST /api/auth/register-device` 每次调用都会新建一个
  /// 账号（服务端没有设备标识字段），如果每次启动都注册，用户每次重启都会
  /// 换一个身份，之前的「继续听/收藏」全部成为孤儿。因此把 token 存本地，
  /// 启动时优先复用。
  final TokenStore tokenStore;

  /// 游客/账号 token。为 null 时匿名访问（公开接口允许）。
  String? token;

  /// 「启动即注册」是否已完成（03-decisions D6）。
  bool get isRegistered => token != null;

  /// 避免并发请求同时触发重复注册。
  Future<void>? _registering;

  static const _timeout = Duration(seconds: 15);

  Map<String, String> get _headers => {
        'Accept': 'application/json',
        if (token != null) 'Authorization': 'Bearer $token',
      };

  Future<T> _get<T>(
    String path,
    Map<String, dynamic>? query,
    T Function(dynamic) parse, {
    bool retryOnUnauthorized = false,
  }) async {
    try {
      return await _getOnce<T>(path, query, parse);
    } on ApiException catch (e) {
      // 读取类接口默认不重试（公开接口匿名可读，401 通常是真无权）；
      // 但「继续听/收藏」这类需要登录的读取会显式打开重试。
      if (!retryOnUnauthorized || e.statusCode != 401) rethrow;
      await ensureRegistered(force: true);
      return _getOnce<T>(path, query, parse);
    }
  }

  Future<T> _getOnce<T>(String path, Map<String, dynamic>? query, T Function(dynamic) parse) async {
    final uri = Uri.parse('$baseUrl$path').replace(
      queryParameters: query?.map((k, v) => MapEntry(k, '$v')),
    );

    late final http.Response res;
    try {
      res = await _http.get(uri, headers: _headers).timeout(_timeout);
    } catch (e) {
      // 网络层失败（断开/超时）：给出可读文案，07 原则「失败即流失」。
      throw ApiException('网络连接失败，请检查网络后重试', code: 'NETWORK');
    }

    final dynamic body;
    try {
      body = jsonDecode(utf8.decode(res.bodyBytes));
    } catch (_) {
      throw ApiException('响应解析失败（HTTP ${res.statusCode}）', statusCode: res.statusCode);
    }

    if (body is! Map<String, dynamic>) {
      throw ApiException('响应格式异常', statusCode: res.statusCode);
    }
    if (body['ok'] != true) {
      final err = body['error'];
      throw ApiException(
        err is Map ? (err['message']?.toString() ?? '请求失败') : '请求失败',
        code: err is Map ? (err['code']?.toString() ?? 'UNKNOWN') : 'UNKNOWN',
        statusCode: res.statusCode,
      );
    }
    return parse(body['data']);
  }

  Future<T> _send<T>(
    String method,
    String path, {
    Map<String, dynamic>? body,
    T Function(dynamic)? parse,
    bool retryOnUnauthorized = true,
  }) async {
    try {
      return await _sendOnce<T>(method, path, body: body, parse: parse);
    } on ApiException catch (e) {
      // 401 说明 token 缺失/失效（例如被清数据、或服务端换了密钥）。
      // 先补一次游客注册再重试一次；仍失败就把错误交给调用方。
      if (!retryOnUnauthorized || e.statusCode != 401) rethrow;
      await ensureRegistered(force: true);
      return _sendOnce<T>(method, path, body: body, parse: parse);
    }
  }

  Future<T> _sendOnce<T>(
    String method,
    String path, {
    Map<String, dynamic>? body,
    T Function(dynamic)? parse,
  }) async {
    final uri = Uri.parse('$baseUrl$path');
    final headers = {..._headers, if (body != null) 'Content-Type': 'application/json'};

    late final http.Response res;
    try {
      final payload = body == null ? null : jsonEncode(body);
      res = await switch (method) {
        'POST' => _http.post(uri, headers: headers, body: payload).timeout(_timeout),
        'PUT' => _http.put(uri, headers: headers, body: payload).timeout(_timeout),
        'DELETE' => _http.delete(uri, headers: headers, body: payload).timeout(_timeout),
        _ => throw ArgumentError('unsupported method $method'),
      };
    } catch (e) {
      if (e is ArgumentError) rethrow;
      throw ApiException('网络连接失败，请检查网络后重试', code: 'NETWORK');
    }

    final dynamic decoded;
    try {
      decoded = jsonDecode(utf8.decode(res.bodyBytes));
    } catch (_) {
      throw ApiException('响应解析失败（HTTP ${res.statusCode}）', statusCode: res.statusCode);
    }

    if (decoded is! Map<String, dynamic>) {
      throw ApiException('响应格式异常', statusCode: res.statusCode);
    }
    if (decoded['ok'] != true) {
      final err = decoded['error'];
      throw ApiException(
        err is Map ? (err['message']?.toString() ?? '请求失败') : '请求失败',
        code: err is Map ? (err['code']?.toString() ?? 'UNKNOWN') : 'UNKNOWN',
        statusCode: res.statusCode,
      );
    }
    return parse == null ? null as T : parse(decoded['data']);
  }

  // —— 内容（02-architecture §4.1）——

  /// 把相对 audioUrl 补成绝对地址（播放器需要）。
  Story _abs(Story s) => s.audioUrl == null
      ? s
      : s.copyWith(audioUrl: s.absoluteAudioUrl(baseUrl));

  /// 首页聚合。
  ///
  /// [ageBand] 是**内容安全参数**，不是可选装饰：服务端 `/api/home` 用它同时
  /// 过滤 tonight 与 featured。不传时服务端按最保守的 `3-6` 处理（见
  /// content-routes.ts），但 App 仍应显式把孩子的年龄档传上来 —— 否则 6-9
  /// 或 9+ 的孩子永远只看到 3-6 的内容。默认值 3-6 只是为了「没拿到设置时
  /// 退到最安全的一档」。
  Future<HomeData> home({String ageBand = '3-6'}) => _get(
        '/api/home',
        {'ageBand': ageBand},
        (d) {
          final home = HomeData.fromJson(d as Map<String, dynamic>);
          return HomeData(
            tonight: home.tonight == null ? null : _abs(home.tonight!),
            featured: home.featured.map(_abs).toList(),
            categories: home.categories,
            continueListening: home.continueListening
                .map((e) => e.story == null ? e : ProgressEntry(
                      storyId: e.storyId,
                      positionSec: e.positionSec,
                      story: _abs(e.story!),
                    ))
                .toList(),
          );
        },
      );

  Future<Paged<Story>> stories({
    int page = 1,
    int pageSize = 20,
    int? categoryId,
    String? ageBand,
    String? q,
    bool? featured,
  }) =>
      _get(
        '/api/stories',
        {
          'page': page,
          'pageSize': pageSize,
          'categoryId': ?categoryId,
          if (ageBand != null && ageBand.isNotEmpty) 'ageBand': ageBand,
          if (q != null && q.isNotEmpty) 'q': q,
          'featured': ?featured,
        },
        (d) {
          final page = Paged.storiesFromJson(d as Map<String, dynamic>);
          return Paged<Story>(
            items: page.items.map(_abs).toList(),
            page: page.page,
            pageSize: page.pageSize,
            total: page.total,
            totalPages: page.totalPages,
          );
        },
      );

  Future<StoryDetail> story(int id) => _get(
        '/api/stories/$id',
        null,
        (d) {
          final detail = StoryDetail.fromJson(d as Map<String, dynamic>);
          return StoryDetail(story: _abs(detail.story), content: detail.content);
        },
      );

  Future<List<Category>> categories() => _get(
        '/api/categories',
        null,
        (d) => (d as List).whereType<Map<String, dynamic>>().map(Category.fromJson).toList(),
      );

  // —— 播放与收藏（需要登录）——

  Future<void> saveProgress(int storyId, int positionSec) => _send<void>(
        'PUT',
        '/api/progress/$storyId',
        body: {'positionSec': positionSec},
      );

  Future<List<ProgressEntry>> progress() => _get(
        '/api/progress',
        null,
        (d) => (d as List).whereType<Map<String, dynamic>>().map(ProgressEntry.fromJson).toList(),
        retryOnUnauthorized: true,
      );

  Future<void> addFavorite(int storyId) => _send<void>('POST', '/api/favorites/$storyId');

  Future<void> removeFavorite(int storyId) => _send<void>('DELETE', '/api/favorites/$storyId');

  Future<List<ProgressEntry>> favorites() => _get(
        '/api/favorites',
        null,
        (d) => (d as List).whereType<Map<String, dynamic>>().map(ProgressEntry.fromJson).toList(),
        retryOnUnauthorized: true,
      );

  Future<void> reportPlay({
    required int storyId,
    required String event,
    int positionSec = 0,
  }) =>
      _send<void>('POST', '/api/plays', body: {
        'storyId': storyId,
        'event': event,
        'positionSec': positionSec,
      });

  // —— 家长设置（需要登录，02-architecture §3.3）——

  /// 读取家长设置。服务端会在首次读取时自动建行（upsert）。
  Future<RemoteSettings> getSettings() => _get(
        '/api/settings',
        null,
        (d) => RemoteSettings.fromJson(d as Map<String, dynamic>),
        // 401 时先补注册再重试：启动流程刚注册完就可能读它。
        retryOnUnauthorized: true,
      );

  /// 保存家长设置（部分更新）。
  Future<RemoteSettings> putSettings(Map<String, dynamic> patch) => _send(
        'PUT',
        '/api/settings',
        body: patch,
        parse: (d) => RemoteSettings.fromJson(d as Map<String, dynamic>),
      );

  // —— 账号 ——

  /// 游客注册，返回并持久化 token（03-decisions D6：启动即注册）。
  ///
  /// 注意：服务端每次调用都会新建账号，所以**只在没有本地 token 时**调用；
  /// [ensureRegistered] 负责这个判断。
  Future<void> registerDevice() async {
    final data = await _send<Map<String, dynamic>>(
      'POST',
      '/api/auth/register-device',
      body: {},
      retryOnUnauthorized: false,
      // 必须显式给 parse：否则 _send 会走 `null as Map` 分支直接崩。
      // 这个 bug 一直潜伏，因为 registerDevice 此前从未被调用过。
      parse: (d) => d as Map<String, dynamic>,
    );
    final fresh = data['token'] as String?;
    if (fresh != null && fresh.isNotEmpty) {
      token = fresh;
      await tokenStore.write(fresh);
    }
  }

  /// 启动流程调用：优先复用本地 token，没有才注册。
  ///
  /// 失败**不抛异常** —— 游客注册失败不应该拦住 App 启动（公开内容仍可看）。
  Future<void> ensureRegistered({bool force = false}) async {
    if (!force && isRegistered) return;
    // 并发去重：多个请求同时 401 时只注册一次。
    final pending = _registering;
    if (pending != null) return pending;

    final future = _ensureRegisteredInner(force: force);
    _registering = future;
    try {
      await future;
    } finally {
      _registering = null;
    }
  }

  Future<void> _ensureRegisteredInner({required bool force}) async {
    if (!force) {
      final saved = await tokenStore.read();
      if (saved != null && saved.isNotEmpty) {
        token = saved;
        return;
      }
    }
    try {
      await registerDevice();
    } on ApiException {
      // 静默失败：启动不因注册失败而中断。
    }
  }

  void close() => _http.close();
}
