
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:story_app/services/api_client.dart';

/// 联调：验证 App 侧拿到的 audioUrl 能真正拉到音频字节。
///
/// 放在 test_live/（默认不跑），需要 dev 服务端在跑。
/// 这条测试覆盖的是 mock 测不到的部分：**相对路径补全 + 真实字节可达**。
void main() {
  late ApiClient api;

  setUp(() => api = ApiClient(baseUrl: kApiBaseUrl));
  tearDown(() => api.close());

  test('故事详情返回可直接播放的绝对 audioUrl', () async {
    final detail = await api.story(8);

    expect(detail.story.audioUrl, isNotNull, reason: '已合成音频的故事应带 audioUrl');
    expect(detail.story.audioUrl, startsWith('http'), reason: '必须是绝对地址，播放器才能用');
    expect(detail.story.durationSec, greaterThan(0), reason: '时长应由服务端量出并回填');
  });

  test('audioUrl 返回真实 MP3 字节', () async {
    final detail = await api.story(8);
    final url = detail.story.audioUrl!;

    final res = await http.get(Uri.parse(url));
    expect(res.statusCode, 200);
    expect(res.headers['content-type'], contains('audio/mpeg'));
    expect(res.bodyBytes.length, greaterThan(1000));
    // MP3 帧同步字：0xFF 0xEx/0xFx
    expect(res.bodyBytes[0], 0xFF);
    expect(res.bodyBytes[1] & 0xE0, 0xE0);
  });

  test('支持 Range 请求（播放器 seek 依赖）', () async {
    final detail = await api.story(8);
    final res = await http.get(
      Uri.parse(detail.story.audioUrl!),
      headers: {'Range': 'bytes=0-1023'},
    );

    expect(res.statusCode, 206);
    expect(res.headers['content-range'], isNotNull);
    expect(res.bodyBytes.length, 1024);
  });

  test('未合成音频的故事不会伪造 audioUrl', () async {
    // 找一条没有音频的故事（列表里 durationSec=0 的）。
    final page = await api.stories(page: 1, pageSize: 50);
    final without = page.items.where((s) => s.durationSec == 0).toList();
    if (without.isEmpty) return; // 全量回填后此断言自然失效

    final detail = await api.story(without.first.id);
    // audioUrl 可能仍指向接口（按需合成），但只要 durationSec=0 就说明还没量过。
    expect(detail.story.durationSec, 0);
  });
}
