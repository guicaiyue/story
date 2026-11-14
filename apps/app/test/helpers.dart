import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:story_app/models/models.dart';
import 'package:story_app/services/api_client.dart';
import 'package:story_app/services/player_service.dart';
import 'package:story_app/state/app_state.dart';
import 'package:story_app/theme/tokens.dart';

/// 用 MockClient 造真实形状的响应，页面拿到的就是与服务端一致的数据。
///
/// 所有 fixture 都取自 2026-11-09 对 dev 库的真实响应（字段名/类型一致），
/// 因此这些测试能发现「字段名对不上」这类真实缺陷。
http.Client mockHttp(Map<String, dynamic> routes, {List<String>? seen}) {
  return MockClient((request) async {
    final path = request.url.path;
    // 记录完整 URL（含 query）：「年龄档有没有真的传上去」是要断言的，
    // 只记 path 就看不到 ?ageBand=3-6。
    seen?.add('${request.method} ${request.url}');
    for (final entry in routes.entries) {
      if (path == entry.key) {
        return http.Response(
          jsonEncode(entry.value),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      }
    }
    return http.Response(
      jsonEncode({
        'ok': false,
        'error': {'code': 'NOT_FOUND', 'message': '接口不存在：$path'},
      }),
      404,
      headers: {'content-type': 'application/json; charset=utf-8'},
    );
  });
}

/// 用回调决定响应，便于做「第一次 401、第二次成功」这类状态化测试。
///
/// 回调返回**已构造好的 [http.Response]**（用 [jsonResponse] 包封套），
/// 这样状态化测试不用自己拼 JSON。
http.Client mockHttpWith(
  http.Response Function(String path) handler, {
  List<String>? seen,
}) {
  return MockClient((request) async {
    seen?.add('${request.method} ${request.url.path}');
    return handler(request.url.path);
  });
}

/// 把封套 map 包成 HTTP 响应，供 [mockHttpWith] 的回调返回。
http.Response jsonResponse(Map<String, dynamic> envelope, {int status = 200}) =>
    http.Response(
      jsonEncode(envelope),
      status,
      headers: {'content-type': 'application/json; charset=utf-8'},
    );

/// 构建一个成功封套。
Map<String, dynamic> okEnvelope(Object? data) => {'ok': true, 'data': data};

/// 构建一个失败封套。
Map<String, dynamic> errEnvelope(String message, {String code = 'INTERNAL'}) => {
      'ok': false,
      'error': {'code': code, 'message': message},
    };

/// 构造故事 JSON（与 /api/stories 的真实字段一致）。
Map<String, dynamic> storyJson({
  int id = 8,
  String title = '皮鞭下的猴子',
  String? categoryName = '睡前故事',
  String ageBand = '3-6',
  int durationSec = 0,
  int length = 1242,
}) =>
    {
      'id': id,
      'title': title,
      'excerpt': '楚国有个好吃懒做的人……',
      'categoryId': 1,
      'categoryName': categoryName,
      'ageBand': ageBand,
      'tags': <String>[],
      'durationSec': durationSec,
      'coverUrl': null,
      'audioUrl': null,
      'featured': false,
      'length': length,
    };

/// `/api/home` 的响应。
///
/// ⚠️ 默认 tonight 刻意用 **3-6** 的故事：服务端 `/api/home` 默认按 3-6 过滤，
/// 而 fixture 曾经把 9+ 的《卷七《细柳》》当成 tonight —— 那正好复刻了
/// 「聊斋进了 3-6 首页」这个内容安全 bug，等于让测试替错误行为背书。
/// 需要 9+ 数据的用例请显式传 [tonight]。
Map<String, dynamic> homeJson({Map<String, dynamic>? tonight}) => {
      'tonight': tonight ??
          storyJson(
            id: 1,
            title: '小兔子找月亮',
            categoryName: '睡前故事',
            ageBand: '3-6',
            durationSec: 320,
          ),
      'featured': [storyJson(id: 7, ageBand: '3-6')],
      'categories': [
        {'id': 1, 'name': '睡前故事', 'sortId': 10, 'storyCount': 194},
        {'id': 4, 'name': '儿童故事', 'sortId': 9, 'storyCount': 198},
      ],
      'continueListening': [
        {
          'storyId': 8,
          'positionSec': 65,
          'story': storyJson(id: 8),
        },
      ],
    };

Map<String, dynamic> pagedJson(List<Map<String, dynamic>> items, {int total = 2197}) => {
      'items': items,
      'page': 1,
      'pageSize': 20,
      'total': total,
      'totalPages': 110,
    };

/// 把被测 widget 包进与真实 App 相同的 Provider/主题环境。
Widget wrap(
  Widget child, {
  required ApiClient api,
  required PlayerService player,
  AppState? state,
}) {
  final appState = state ?? AppState(api: api);
  return MultiProvider(
    providers: [
      ChangeNotifierProvider<AppState>.value(value: appState),
      Provider<PlayerService>.value(value: player),
    ],
    child: StoryPaletteScope(
      palette: StoryPalette.day,
      child: MaterialApp(
        home: Scaffold(body: child),
      ),
    ),
  );
}

/// 在键盘范围内点某个键（数字同时出现在输入框与键盘上，必须限定范围）。
Future<void> tapKey(WidgetTester tester, String key) async {
  await tester.tap(find.descendant(
    of: find.byKey(const Key('gate-keypad')),
    matching: find.text(key),
  ));
  await tester.pump();
}

/// 组装一份默认的 ApiClient（用 mock HTTP）。
ApiClient apiWith(Map<String, dynamic> routes, {List<String>? seen}) =>
    ApiClient(httpClient: mockHttp(routes, seen: seen), baseUrl: 'http://test.local');

/// 便捷构造：从 JSON 得到 Story（测试里少写样板）。
Story storyFromJson({int id = 8, String title = '皮鞭下的猴子'}) =>
    Story.fromJson(storyJson(id: id, title: title));

/// 已合成音频的故事：带绝对 audioUrl 与服务端量出的 267 秒时长。
Story storyWithAudio({int id = 8, String title = '皮鞭下的猴子'}) => Story.fromJson({
      ...storyJson(id: id, title: title, durationSec: 267),
      'audioUrl': 'http://test.local/api/stories/$id/audio',
    });
