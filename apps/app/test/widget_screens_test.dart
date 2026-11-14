import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:story_app/screens/category_screen.dart';
import 'package:story_app/screens/home_screen.dart';
import 'package:story_app/screens/launch_screen.dart';
import 'package:story_app/screens/mine_screen.dart';
import 'package:story_app/screens/parent_gate_screen.dart';
import 'package:story_app/screens/parent_screen.dart';
import 'package:story_app/screens/player_screen.dart';
import 'package:story_app/screens/story_screen.dart';
import 'package:story_app/services/player_service.dart';
import 'package:story_app/state/app_state.dart';

import 'helpers.dart';

void main() {
  // —— 启动页 ——
  group('启动页', () {
    testWidgets('展示品牌与副标题', (tester) async {
      await tester.pumpWidget(wrap(
        LaunchScreen(onFinished: () {}, delay: const Duration(seconds: 30)),
        api: apiWith({}),
        player: FakePlayerService(),
      ));
      expect(find.text('小故事铺'), findsOneWidget);
      expect(find.text('给中国家庭的睡前 20 分钟'), findsOneWidget);
      await tester.pump(const Duration(seconds: 31));
    });

    testWidgets('到时后回调 onFinished', (tester) async {
      var finished = false;
      await tester.pumpWidget(wrap(
        LaunchScreen(
          onFinished: () => finished = true,
          delay: const Duration(milliseconds: 50),
        ),
        api: apiWith({}),
        player: FakePlayerService(),
      ));
      expect(finished, isFalse);
      await tester.pump(const Duration(milliseconds: 60));
      expect(finished, isTrue);
    });
  });

  // —— 首页 ——
  group('首页', () {
    testWidgets('渲染今晚听什么大卡片（真实接口数据）', (tester) async {
      final api = apiWith({
        '/api/home': okEnvelope(homeJson()),
      });
      await tester.pumpWidget(wrap(HomeScreen(), api: api, player: FakePlayerService()));
      await tester.pumpAndSettle();

      expect(find.text('今晚听什么'), findsOneWidget);
      expect(find.text('小兔子找月亮'), findsOneWidget);
      expect(find.text('开始听'), findsOneWidget);
      expect(find.text('继续听'), findsOneWidget);
      expect(find.text('场景'), findsOneWidget);
    });

    testWidgets('推荐分类来自接口而不是写死', (tester) async {
      final api = apiWith({'/api/home': okEnvelope(homeJson())});
      await tester.pumpWidget(wrap(HomeScreen(), api: api, player: FakePlayerService()));
      await tester.pumpAndSettle();

      await tester.scrollUntilVisible(
        find.text('推荐分类'),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.pumpAndSettle();
      // 「194 篇」只出现在推荐分类卡片里（不是写死的数字）。
      expect(find.text('194 篇'), findsOneWidget);
      expect(find.text('198 篇'), findsOneWidget);
    });

    testWidgets('接口失败展示错误态与重试，不白屏', (tester) async {
      final api = apiWith({'/api/home': errEnvelope('数据库暂时不可用')});
      await tester.pumpWidget(wrap(HomeScreen(), api: api, player: FakePlayerService()));
      await tester.pumpAndSettle();

      expect(find.text('数据库暂时不可用'), findsOneWidget);
      expect(find.text('重试'), findsOneWidget);
    });

    testWidgets('tonight 为 null 时给出兜底文案而非崩溃', (tester) async {
      final api = apiWith({
        '/api/home': okEnvelope({
          'tonight': null,
          'featured': [],
          'categories': [],
          'continueListening': [],
        }),
      });
      await tester.pumpWidget(wrap(HomeScreen(), api: api, player: FakePlayerService()));
      await tester.pumpAndSettle();

      expect(find.text('暂时没有可推荐的故事'), findsOneWidget);
    });

    testWidgets('点击开始听会创建播放状态', (tester) async {
      final api = apiWith({'/api/home': okEnvelope(homeJson())});
      final state = AppState(api: api);
      final player = FakePlayerService();

      await tester.pumpWidget(wrap(HomeScreen(), api: api, player: player, state: state));
      await tester.pumpAndSettle();

      await tester.tap(find.text('开始听'));
      await tester.pumpAndSettle();

      expect(state.playback.storyId, 1);
      expect(state.playback.title, '小兔子找月亮');
    });
  });

  // —— 分类页 ——
  group('分类页', () {
    testWidgets('展示列表与分页信息', (tester) async {
      final api = apiWith({
        '/api/stories': okEnvelope(pagedJson([storyJson(id: 8, title: '皮鞭下的猴子')])),
        '/api/categories': okEnvelope([
          {'id': 1, 'name': '睡前故事', 'sortId': 10, 'storyCount': 194},
        ]),
      });
      await tester.pumpWidget(wrap(const CategoryScreen(), api: api, player: FakePlayerService()));
      await tester.pumpAndSettle();

      expect(find.text('皮鞭下的猴子'), findsOneWidget);
      expect(find.textContaining('共 2197 篇'), findsOneWidget);
    });

    testWidgets('年龄档与时长筛选可点选', (tester) async {
      final api = apiWith({
        '/api/stories': okEnvelope(pagedJson([storyJson()])),
        '/api/categories': okEnvelope([]),
      });
      await tester.pumpWidget(wrap(const CategoryScreen(), api: api, player: FakePlayerService()));
      await tester.pumpAndSettle();

      expect(find.text('3-6 岁'), findsOneWidget);
      await tester.tap(find.text('6-9 岁'));
      await tester.pumpAndSettle();

      await tester.tap(find.text('5 分钟内'));
      await tester.pumpAndSettle();
      // 全部故事 durationSec=0，时长筛选后为空 —— 应给出空态而不是空白。
      expect(find.textContaining('没有符合条件的故事'), findsOneWidget);
    });

    testWidgets('不传 initialAgeBand 时默认按孩子的年龄档筛选', (tester) async {
      // 分类页有两个入口不传年龄档（首页分类卡片、底部「分类」Tab）。
      // 默认若为 null 就等于不过滤，9+ 的聊斋/怪谈会混进孩子的列表。
      final seen = <String>[];
      final api = apiWith({
        '/api/stories': okEnvelope(pagedJson([storyJson()])),
        '/api/categories': okEnvelope([]),
      }, seen: seen);
      await tester.pumpWidget(wrap(const CategoryScreen(), api: api, player: FakePlayerService()));
      await tester.pumpAndSettle();

      expect(
        seen.any((c) => c.contains('/api/stories') && c.contains('ageBand=3-6')),
        isTrue,
        reason: '默认必须带上孩子年龄档（AppState.settings.ageFilter，默认 3-6）',
      );
    });

    testWidgets('空结果显示空态文案', (tester) async {
      final api = apiWith({
        '/api/stories': okEnvelope(pagedJson([], total: 0)),
        '/api/categories': okEnvelope([]),
      });
      await tester.pumpWidget(wrap(const CategoryScreen(), api: api, player: FakePlayerService()));
      await tester.pumpAndSettle();

      expect(find.textContaining('没有符合条件的故事'), findsOneWidget);
    });

    testWidgets('接口失败展示错误态', (tester) async {
      final api = apiWith({
        '/api/stories': errEnvelope('服务暂时不可用'),
        '/api/categories': okEnvelope([]),
      });
      await tester.pumpWidget(wrap(const CategoryScreen(), api: api, player: FakePlayerService()));
      await tester.pumpAndSettle();

      expect(find.text('服务暂时不可用'), findsOneWidget);
      expect(find.text('重试'), findsOneWidget);
    });
  });

  // —— 故事详情 ——
  group('故事详情', () {
    testWidgets('渲染标题、正文与字数', (tester) async {
      final api = apiWith({
        '/api/stories/8': okEnvelope({
          ...storyJson(id: 8),
          'content': '第一段。\n第二段。',
        }),
      });
      await tester.pumpWidget(wrap(const StoryScreen(storyId: 8), api: api, player: FakePlayerService()));
      await tester.pumpAndSettle();

      expect(find.text('皮鞭下的猴子'), findsOneWidget);
      expect(find.text('第一段。'), findsOneWidget);
      expect(find.text('第二段。'), findsOneWidget);
      expect(find.text('1242 字'), findsOneWidget);
      expect(find.text('开始听'), findsOneWidget);
    });

    testWidgets('收藏按钮切换状态', (tester) async {
      final api = apiWith({
        '/api/stories/8': okEnvelope({...storyJson(id: 8), 'content': '正文'}),
        '/api/favorites/8': okEnvelope(<String, dynamic>{}),
      });
      final state = AppState(api: api);
      await tester.pumpWidget(wrap(const StoryScreen(storyId: 8), api: api, player: FakePlayerService(), state: state));
      await tester.pumpAndSettle();

      expect(state.isFavorite(8), isFalse);
      await tester.tap(find.bySemanticsLabel('收藏'));
      await tester.pumpAndSettle();
      expect(state.isFavorite(8), isTrue);
    });

    testWidgets('故事不存在时展示错误', (tester) async {
      final api = apiWith({'/api/stories/999': errEnvelope('故事不存在', code: 'NOT_FOUND')});
      await tester.pumpWidget(wrap(const StoryScreen(storyId: 999), api: api, player: FakePlayerService()));
      await tester.pumpAndSettle();

      expect(find.text('故事不存在'), findsOneWidget);
    });
  });

  // —— 家长门 ——
  group('家长门', () {
    testWidgets('显示题目，答错给出提示且不放行', (tester) async {
      const challenge = MathChallenge(left: 12, right: 15); // 答案 27
      var popped = false;

      await tester.pumpWidget(wrap(
        Builder(
          builder: (context) => ParentGateScreen(challenge: challenge),
        ),
        api: apiWith({}),
        player: FakePlayerService(),
      ));
      await tester.pumpAndSettle();

      expect(find.text('12 + 15 = ?'), findsOneWidget);

      // 输入 26（错）
      await tapKey(tester, '2');
      await tapKey(tester, '6');
      await tester.tap(find.text('确认'));
      await tester.pumpAndSettle();

      expect(find.text('答案不对，再算一次'), findsOneWidget);
      expect(popped, isFalse);
    });

    testWidgets('答对后返回 true 并解锁', (tester) async {
      const challenge = MathChallenge(left: 12, right: 15); // 27
      final api = apiWith({});
      final state = AppState(api: api);

      await tester.pumpWidget(wrap(
        ParentGateScreen(challenge: challenge),
        api: api,
        player: FakePlayerService(),
        state: state,
      ));
      await tester.pumpAndSettle();

      await tapKey(tester, '2');
      await tapKey(tester, '7');
      await tester.tap(find.text('确认'));
      await tester.pumpAndSettle();

      expect(state.parentUnlocked, isTrue);
    });

    testWidgets('退格与清空按钮可用', (tester) async {
      const challenge = MathChallenge(left: 12, right: 15);
      await tester.pumpWidget(wrap(
        const ParentGateScreen(challenge: challenge),
        api: apiWith({}),
        player: FakePlayerService(),
      ));
      await tester.pumpAndSettle();

      await tapKey(tester, '9');
      // 输入框已显示 9（键盘上的 9 也还在，故用 byKey 断言输入值）。
      expect(
        tester.widget<Text>(find.byKey(const Key('gate-input'))).data,
        '9',
      );

      await tester.tap(find.text('⌫'));
      await tester.pump();
      expect(tester.widget<Text>(find.byKey(const Key('gate-input'))).data, '?');

      await tapKey(tester, '8');
      await tester.tap(find.text('C'));
      await tester.pump();
      expect(tester.widget<Text>(find.byKey(const Key('gate-input'))).data, '?');
    });

    testWidgets('答错三次给出更明确的家长提示', (tester) async {
      const challenge = MathChallenge(left: 12, right: 15);
      await tester.pumpWidget(wrap(
        const ParentGateScreen(challenge: challenge),
        api: apiWith({}),
        player: FakePlayerService(),
      ));
      await tester.pumpAndSettle();

      for (var i = 0; i < 3; i++) {
        await tapKey(tester, '9');
        await tester.tap(find.text('确认'));
        await tester.pumpAndSettle();
      }
      expect(find.text('答案不对哦，请让家长再试一次'), findsOneWidget);
    });
  });

  // —— 家长中心 ——
  group('家长中心', () {
    testWidgets('展示时长限制/年龄档并响应修改', (tester) async {
      final api = apiWith({
        '/api/progress': okEnvelope([]),
        '/api/favorites': okEnvelope([]),
      });
      final state = AppState(api: api);
      await tester.pumpWidget(wrap(const ParentScreen(), api: api, player: FakePlayerService(), state: state));
      await tester.pumpAndSettle();

      expect(find.text('每日时长限制'), findsOneWidget);
      expect(find.text('内容年龄档'), findsOneWidget);

      // 先在顶部区块操作（此时它还在视口内）。
      // 「30 分钟」同时出现在「每日时长限制」与「默认定时停止」，
      // 因此用区块 Key 限定范围。
      final thirtyInDaily = find.descendant(
        of: find.byKey(const Key('block-daily-limit')),
        matching: find.text('30 分钟'),
      );
      expect(thirtyInDaily, findsOneWidget);
      await tester.tap(thirtyInDaily);
      await tester.pumpAndSettle();
      expect(state.settings.dailyLimitMin, 30);

      await tester.tap(find.text('6-9 岁'));
      await tester.pumpAndSettle();
      expect(state.settings.ageFilter, '6-9');

      // 再滚到下方确认播放报告区块存在。
      await tester.scrollUntilVisible(
        find.text('播放报告'),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.pumpAndSettle();
      expect(find.text('播放报告'), findsOneWidget);
    });

    testWidgets('播放报告用真实计数，空数据给 0', (tester) async {
      final api = apiWith({
        '/api/progress': okEnvelope([]),
        '/api/favorites': okEnvelope([]),
      });
      await tester.pumpWidget(wrap(const ParentScreen(), api: api, player: FakePlayerService()));
      await tester.pumpAndSettle();

      await tester.scrollUntilVisible(
        find.text('在听的故事'),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.pumpAndSettle();
      expect(find.text('在听的故事'), findsOneWidget);
      expect(find.text('收藏的故事'), findsOneWidget);
    });

    testWidgets('退出家长中心会重新上锁', (tester) async {
      final api = apiWith({
        '/api/progress': okEnvelope([]),
        '/api/favorites': okEnvelope([]),
      });
      final state = AppState(api: api);
      state.unlockParent();
      expect(state.parentUnlocked, isTrue);

      await tester.pumpWidget(wrap(const ParentScreen(), api: api, player: FakePlayerService(), state: state));
      await tester.pumpAndSettle();

      await tester.scrollUntilVisible(
        find.text('退出家长中心'),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('退出家长中心'));
      await tester.pumpAndSettle();
      expect(state.parentUnlocked, isFalse);
    });
  });

  // —— 「我的」——
  group('我的', () {
    testWidgets('空数据时展示三个空态', (tester) async {
      final api = apiWith({
        '/api/progress': okEnvelope([]),
        '/api/favorites': okEnvelope([]),
      });
      await tester.pumpWidget(wrap(const MineScreen(), api: api, player: FakePlayerService()));
      await tester.pumpAndSettle();

      expect(find.text('还没有听过的故事'), findsOneWidget);
      expect(find.text('还没有收藏的故事'), findsOneWidget);
      expect(find.text('本次还没有播放记录'), findsOneWidget);
      await tester.scrollUntilVisible(
        find.text('家长中心'),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.pumpAndSettle();
      expect(find.text('家长中心'), findsOneWidget);
    });

    testWidgets('有数据时展示继续听与收藏', (tester) async {
      final api = apiWith({
        '/api/progress': okEnvelope([
          {'storyId': 8, 'positionSec': 65, 'story': storyJson(id: 8, title: '皮鞭下的猴子')},
        ]),
        '/api/favorites': okEnvelope([
          {'storyId': 9, 'positionSec': 0, 'story': storyJson(id: 9, title: '勇敢的小刺猬')},
        ]),
      });
      await tester.pumpWidget(wrap(const MineScreen(), api: api, player: FakePlayerService()));
      await tester.pumpAndSettle();

      expect(find.text('皮鞭下的猴子'), findsOneWidget);
      expect(find.text('勇敢的小刺猬'), findsOneWidget);
    });

    testWidgets('夜间模式开关能改变全局状态', (tester) async {
      final api = apiWith({
        '/api/progress': okEnvelope([]),
        '/api/favorites': okEnvelope([]),
      });
      final state = AppState(api: api);
      await tester.pumpWidget(wrap(const MineScreen(), api: api, player: FakePlayerService(), state: state));
      await tester.pumpAndSettle();

      expect(state.isNight, isFalse);
      await tester.scrollUntilVisible(
        find.byType(Switch),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byType(Switch));
      await tester.pumpAndSettle();
      expect(state.isNight, isTrue);
    });
  });

  // —— 播放器 ——
  group('播放器', () {
    testWidgets('渲染标题、控制按钮与定时/收藏', (tester) async {
      final api = apiWith({'/api/stories': okEnvelope(pagedJson([]))});
      final player = FakePlayerService();
      await tester.pumpWidget(wrap(
        PlayerScreen(story: storyFromJson()),
        api: api,
        player: player,
      ));
      await tester.pumpAndSettle();

      expect(find.text('皮鞭下的猴子'), findsOneWidget);
      expect(find.bySemanticsLabel('前进 15 秒'), findsOneWidget);
      expect(find.bySemanticsLabel('后退 15 秒'), findsOneWidget);
      expect(find.text('定时停止'), findsOneWidget);
      expect(find.text('收藏'), findsOneWidget);
      expect(find.text('自动下一集'), findsOneWidget);
      expect(player.loadedStoryId, 8);
      expect(player.calls, contains('play'));
    });

    testWidgets('点击暂停会调用 player.pause', (tester) async {
      final api = apiWith({'/api/stories': okEnvelope(pagedJson([]))});
      final player = FakePlayerService();
      final state = AppState(api: api);
      state.startPlayback(storyId: 8, title: '皮鞭下的猴子');

      await tester.pumpWidget(wrap(
        PlayerScreen(story: storyFromJson()),
        api: api,
        player: player,
        state: state,
      ));
      await tester.pumpAndSettle();

      await tester.tap(find.bySemanticsLabel('暂停'));
      await tester.pumpAndSettle();

      expect(player.calls, contains('pause'));
      expect(state.playback.isPlaying, isFalse);
    });

    testWidgets('15 秒进退会 seek 到正确位置', (tester) async {
      final api = apiWith({'/api/stories': okEnvelope(pagedJson([]))});
      final player = FakePlayerService(duration: const Duration(seconds: 300));
      final state = AppState(api: api);
      state.startPlayback(storyId: 8, title: 'T');

      await tester.pumpWidget(wrap(
        PlayerScreen(story: storyFromJson()),
        api: api,
        player: player,
        state: state,
      ));
      await tester.pumpAndSettle();

      // 播放位置由 player 的事件流驱动（不是 state 单方面设置）。
      player.emitPosition(const Duration(seconds: 60));
      await tester.pumpAndSettle();

      await tester.tap(find.bySemanticsLabel('前进 15 秒'));
      await tester.pumpAndSettle();
      expect(player.calls, contains('seek:75'));

      await tester.tap(find.bySemanticsLabel('后退 15 秒'));
      await tester.pumpAndSettle();
      expect(player.calls, contains('seek:60'));
    });

    testWidgets('定时停止可选择 15 分钟并写入状态', (tester) async {
      final api = apiWith({'/api/stories': okEnvelope(pagedJson([]))});
      final player = FakePlayerService();
      final state = AppState(api: api);
      state.startPlayback(storyId: 8, title: 'T');

      await tester.pumpWidget(wrap(
        PlayerScreen(story: storyFromJson()),
        api: api,
        player: player,
        state: state,
      ));
      await tester.pumpAndSettle();

      await tester.tap(find.text('定时停止'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('15 分钟').last);
      await tester.pumpAndSettle();

      expect(state.playback.sleepTimerRemaining, isNotNull);
      await tester.pump(const Duration(seconds: 2));
    });

    testWidgets('播放结束且开启自动下一集时会切到下一首', (tester) async {
      final api = apiWith({
        '/api/stories': okEnvelope(pagedJson([
          storyJson(id: 9, title: '勇敢的小刺猬'),
        ])),
      });
      final player = FakePlayerService();
      final state = AppState(api: api);
      state.startPlayback(storyId: 8, title: '皮鞭下的猴子');

      await tester.pumpWidget(wrap(
        PlayerScreen(story: storyFromJson()),
        api: api,
        player: player,
        state: state,
      ));
      await tester.pumpAndSettle();

      player.emitCompletion();
      await tester.pumpAndSettle();

      expect(state.playback.title, '勇敢的小刺猬');
      expect(player.calls, contains('load:9'));
    });

    testWidgets('关闭自动下一集后播放结束不再切歌', (tester) async {
      final api = apiWith({
        '/api/stories': okEnvelope(pagedJson([storyJson(id: 9, title: '勇敢的小刺猬')])),
      });
      final player = FakePlayerService();
      final state = AppState(api: api);
      state.startPlayback(storyId: 8, title: '皮鞭下的猴子');
      state.updatePlayback(state.playback.copyWith(autoplayNext: false));

      await tester.pumpWidget(wrap(
        PlayerScreen(story: storyFromJson()),
        api: api,
        player: player,
        state: state,
      ));
      await tester.pumpAndSettle();

      player.emitCompletion();
      await tester.pumpAndSettle();

      expect(player.calls, isNot(contains('load:9')));
    });

    testWidgets('夜间播放器使用深靛背景', (tester) async {
      final api = apiWith({'/api/stories': okEnvelope(pagedJson([]))});
      await tester.pumpWidget(wrap(
        PlayerScreen(story: storyFromJson(), nightMode: true),
        api: api,
        player: FakePlayerService(),
      ));
      await tester.pumpAndSettle();

      // 夜间配色：找到根 Material 的颜色。
      final material = tester.widget<Material>(
        find.descendant(of: find.byType(PlayerScreen), matching: find.byType(Material)).first,
      );
      expect(material.color, const Color(0xFF1E1B2E));
    });

    testWidgets('收藏按钮在播放器上可切换', (tester) async {
      final api = apiWith({
        '/api/stories': okEnvelope(pagedJson([])),
        '/api/favorites/8': okEnvelope(<String, dynamic>{}),
      });
      final state = AppState(api: api);
      state.startPlayback(storyId: 8, title: 'T');

      await tester.pumpWidget(wrap(
        PlayerScreen(story: storyFromJson()),
        api: api,
        player: FakePlayerService(),
        state: state,
      ));
      await tester.pumpAndSettle();

      expect(state.isFavorite(8), isFalse);
      await tester.tap(find.text('收藏'));
      await tester.pumpAndSettle();
      expect(state.isFavorite(8), isTrue);
    });

    testWidgets('有 audioUrl 时把音频地址交给播放器', (tester) async {
      final api = apiWith({'/api/stories': okEnvelope(pagedJson([]))});
      final player = FakePlayerService();
      final state = AppState(api: api);
      state.startPlayback(storyId: 8, title: 'T');

      await tester.pumpWidget(wrap(
        PlayerScreen(story: storyWithAudio()),
        api: api,
        player: player,
        state: state,
      ));
      await tester.pumpAndSettle();

      // 服务端量出的真实时长应被用于进度条总长。
      expect(find.text('04:27'), findsOneWidget);
      expect(player.loadedStoryId, 8);
    });

    testWidgets('音频时长为 0 时进度条不崩（除零保护）', (tester) async {
      final api = apiWith({'/api/stories': okEnvelope(pagedJson([]))});
      final player = FakePlayerService(duration: Duration.zero);
      final state = AppState(api: api);
      state.startPlayback(storyId: 8, title: 'T', duration: Duration.zero);

      await tester.pumpWidget(wrap(
        PlayerScreen(story: storyFromJson()),
        api: api,
        player: player,
        state: state,
      ));
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
    });
  });
}
