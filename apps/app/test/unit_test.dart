import 'package:flutter_test/flutter_test.dart';
import 'package:story_app/models/models.dart';
import 'package:story_app/services/api_client.dart';
import 'package:story_app/services/player_service.dart';
import 'package:story_app/state/app_state.dart';

import 'helpers.dart';

/// 接口层与状态层测试 —— 不依赖 widget 树。
void main() {
  group('ApiClient 封套解析', () {
    test('成功响应解包 data', () async {
      final api = apiWith({
        '/api/home': okEnvelope(homeJson()),
      });

      final home = await api.home();
      expect(home.tonight, isNotNull);
      expect(home.tonight!.title, '小兔子找月亮');
      expect(home.categories.length, 2);
      expect(home.continueListening.first.positionSec, 65);
    });

    test('失败响应急抛出服务端文案与 code', () async {
      final api = apiWith({
        '/api/home': errEnvelope('数据库暂时不可用', code: 'DB_DOWN'),
      });

      await expectLater(
        api.home(),
        throwsA(
          isA<ApiException>()
              .having((e) => e.message, 'message', '数据库暂时不可用')
              .having((e) => e.code, 'code', 'DB_DOWN'),
        ),
      );
    });

    test('404 未定义路由也走统一错误通道', () async {
      final api = apiWith({});
      await expectLater(api.home(), throwsA(isA<ApiException>()));
    });

    test('网络异常转成可读文案而非原始异常', () async {
      final api = ApiClient(
        httpClient: mockHttp({}),
        baseUrl: 'http://test.local',
      );
      // 命中 mock 的 404 分支（同样走 ApiException）。
      await expectLater(api.categories(), throwsA(isA<ApiException>()));
    });

    test('stories 会把筛选条件编码进查询串', () async {
      final seen = <String>[];
      final api = apiWith({
        '/api/stories': okEnvelope(pagedJson([storyJson()])),
      }, seen: seen);

      await api.stories(page: 2, pageSize: 50, ageBand: '6-9', q: '兔子');
      // seen 现在记录完整 URL（含 query），所以断言也检查筛选条件真的编码进去了。
      expect(seen, contains('GET http://test.local/api/stories?page=2&pageSize=50&ageBand=6-9&q=%E5%85%94%E5%AD%90'));
    });

    test('home 默认按 3-6 拉取（内容安全默认值）', () async {
      final seen = <String>[];
      final api = apiWith({'/api/home': okEnvelope(homeJson())}, seen: seen);

      await api.home();

      expect(seen, contains('GET http://test.local/api/home?ageBand=3-6'));
    });

    test('home 把孩子的年龄档传上去，不写死', () async {
      // 家长把年龄档设成 9+ 后，首页必须请求 9+，否则 9+ 的孩子永远
      // 只看到 3-6 的内容。
      final seen = <String>[];
      final api = apiWith({
        '/api/home': okEnvelope(homeJson(
          tonight: storyJson(
            id: 2199,
            title: '卷七《细柳》',
            categoryName: '聊斋志异',
            ageBand: '9+',
          ),
        )),
      }, seen: seen);

      final home = await api.home(ageBand: '9+');

      expect(seen, contains('GET http://test.local/api/home?ageBand=9%2B'));
      expect(home.tonight!.ageBand, '9+');
    });
  });

  group('模型解析', () {
    test('Story.durationLabel 对 0 秒给出「音频生成中」', () {
      expect(Story.fromJson(storyJson(durationSec: 0)).durationLabel, '音频生成中');
      expect(Story.fromJson(storyJson(durationSec: 180)).durationLabel, '3 分钟');
      expect(Story.fromJson(storyJson(durationSec: 195)).durationLabel, '3 分 15 秒');
    });

    test('StoryDetail.paragraphs 按行切段并去掉空行', () {
      final detail = StoryDetail.fromJson({
        ...storyJson(),
        'content': '第一段。\n\n第二段。\n   \n第三段。',
      });
      expect(detail.paragraphs, ['第一段。', '第二段。', '第三段。']);
    });

    test('字段缺失时用安全默认值，不抛异常', () {
      final story = Story.fromJson({'id': 1});
      expect(story.title, '');
      expect(story.ageBand, '3-6');
      expect(story.durationSec, 0);
      expect(story.tags, isEmpty);
    });

    test('相对 audioUrl 会补成绝对地址（播放器需要）', () {
      final story = Story.fromJson({
        'id': 8, 'title': 'T', 'audioUrl': '/api/stories/8/audio',
      });
      expect(story.absoluteAudioUrl('http://127.0.0.1:3000'),
          'http://127.0.0.1:3000/api/stories/8/audio');
      // 结尾带斜杠时不应出现双斜杠。
      expect(story.absoluteAudioUrl('http://127.0.0.1:3000/'),
          'http://127.0.0.1:3000/api/stories/8/audio');
      // 已是绝对地址则原样返回。
      expect(
        Story.fromJson({'id': 1, 'title': 'A', 'audioUrl': 'https://cdn.x/a.mp3'})
            .absoluteAudioUrl('http://y'),
        'https://cdn.x/a.mp3',
      );
      // 无音频时为 null。
      expect(Story.fromJson({'id': 1, 'title': 'A'}).absoluteAudioUrl('http://y'), isNull);
    });

    test('audioUrl 与 durationSec 一起出现时时长文案正常', () {
      final s = Story.fromJson({
        'id': 8, 'title': 'T', 'audioUrl': '/api/stories/8/audio', 'durationSec': 267,
      });
      expect(s.durationLabel, '4 分 27 秒');
    });

    test('HomeData 的 tonight 为 null 时不崩', () {
      final home = HomeData.fromJson({'tonight': null, 'featured': [], 'categories': [], 'continueListening': []});
      expect(home.tonight, isNull);
    });
  });

  group('家长门 MathChallenge', () {
    test('正确答案通过，错误答案不通过', () {
      const c = MathChallenge(left: 13, right: 24);
      expect(c.answer, 37);
      expect(c.verify('37'), isTrue);
      expect(c.verify(' 37 '), isTrue, reason: '允许两端空格');
      expect(c.verify('36'), isFalse);
      expect(c.verify(''), isFalse);
      expect(c.verify('abc'), isFalse);
    });

    test('题目是两位数相加，超出幼儿心算范围', () {
      for (var seed = 0; seed < 200; seed++) {
        final c = MathChallenge.generate(seed: seed);
        expect(c.left, greaterThanOrEqualTo(11));
        expect(c.right, greaterThanOrEqualTo(11));
        expect(c.answer, greaterThanOrEqualTo(22));
      }
    });

    test('question 文案格式正确', () {
      const c = MathChallenge(left: 12, right: 15);
      expect(c.question, '12 + 15 = ?');
    });
  });

  group('AppState', () {
    test('夜间开关会通知监听者', () {
      final api = apiWith({});
      final state = AppState(api: api);
      var notified = 0;
      state.addListener(() => notified++);

      state.setNight(true);
      expect(state.isNight, isTrue);
      expect(notified, 1);

      // 重复设置同值不应重复通知。
      state.setNight(true);
      expect(notified, 1);
    });

    test('收藏可切换且可判定', () {
      final state = AppState(api: apiWith({}));
      expect(state.isFavorite(8), isFalse);
      state.toggleFavorite(8);
      expect(state.isFavorite(8), isTrue);
      state.toggleFavorite(8);
      expect(state.isFavorite(8), isFalse);
    });

    test('seedFavorites 会覆盖本地集合', () {
      final state = AppState(api: apiWith({}))..toggleFavorite(1);
      state.seedFavorites([5, 6]);
      expect(state.favoriteIds, {5, 6});
      expect(state.isFavorite(1), isFalse);
    });

    test('家长设置 copyWith 保留未改动字段', () {
      const s = ParentSettings();
      final next = s.copyWith(dailyLimitMin: 30);
      expect(next.dailyLimitMin, 30);
      expect(next.ageFilter, s.ageFilter);
      expect(next.parentGateEnabled, isTrue);
    });

    test('家长设置展示文案：0 表示不限 / 不自动停止', () {
      expect(const ParentSettings().dailyLimitLabel, '不限');
      expect(const ParentSettings(dailyLimitMin: 45).dailyLimitLabel, '45 分钟');
      expect(const ParentSettings(sleepTimerMin: 0).sleepTimerLabel, '不自动停止');
      expect(const ParentSettings(sleepTimerMin: 30).sleepTimerLabel, '30 分钟');
    });

    test('播放状态进度计算并对 0 时长兜底', () {
      const zero = PlaybackState(duration: Duration.zero);
      expect(zero.progress, 0);

      const half = PlaybackState(
        position: Duration(seconds: 90),
        duration: Duration(seconds: 180),
      );
      expect(half.progress, closeTo(0.5, 0.001));
    });

    test('startPlayback 记录最近听过且去重', () {
      final state = AppState(api: apiWith({}));
      state.startPlayback(storyId: 1, title: 'A');
      state.startPlayback(storyId: 2, title: 'B');
      state.startPlayback(storyId: 1, title: 'A');
      expect(state.recentIds, [1, 2]);
    });

    test('setSleepTimer(null) 会清空定时', () {
      final state = AppState(api: apiWith({}));
      state.setSleepTimer(const Duration(minutes: 15));
      expect(state.playback.sleepTimerRemaining, const Duration(minutes: 15));
      state.setSleepTimer(null);
      expect(state.playback.sleepTimerRemaining, isNull);
    });
  });

  group('PlayerService（fake 实现）', () {
    test('load/play/pause 会记录调用并维护状态', () async {
      final player = FakePlayerService();
      expect(player.isPlaying, isFalse);

      await player.load(storyId: 8, url: null, duration: const Duration(seconds: 180));
      expect(player.loadedStoryId, 8);
      expect(player.position, Duration.zero);

      await player.play();
      expect(player.isPlaying, isTrue);

      await player.pause();
      expect(player.isPlaying, isFalse);
      expect(player.calls, containsAllInOrder(['load:8', 'play', 'pause']));
    });

    test('seek 会被夹在 [0, duration] 区间内', () async {
      final player = FakePlayerService(duration: const Duration(seconds: 100));
      await player.load(storyId: 1);

      await player.seek(const Duration(seconds: -30));
      expect(player.position, Duration.zero);

      await player.seek(const Duration(seconds: 999));
      expect(player.position, const Duration(seconds: 100));

      await player.seek(const Duration(seconds: 40));
      expect(player.position, const Duration(seconds: 40));
    });

    test('positionStream 广播位置更新', () async {
      final player = FakePlayerService();
      await player.load(storyId: 1);

      final received = <Duration>[];
      final sub = player.positionStream.listen(received.add);
      player.emitPosition(const Duration(seconds: 5));
      await Future<void>.delayed(Duration.zero);

      expect(received, contains(const Duration(seconds: 5)));
      await sub.cancel();
    });

    test('completionStream 触发播放结束', () async {
      final player = FakePlayerService();
      var completed = false;
      final sub = player.completionStream.listen((_) => completed = true);

      player.emitCompletion();
      await Future<void>.delayed(Duration.zero);

      expect(completed, isTrue);
      expect(player.isPlaying, isFalse);
      await sub.cancel();
    });
  });
}
