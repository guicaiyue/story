// 今晚的列表：本地持久化 + 故事页加入/移出 + 播放器合并显示。
//
// 为什么单独一组：这条链路跨三层（StoryScreen → AppState → TonightStore），
// 任意一层断掉都表现为「加了没反应」，只测一层看不出来。

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:story_app/screens/player_screen.dart';
import 'package:story_app/screens/story_screen.dart';
import 'package:story_app/services/player_service.dart';
import 'package:story_app/services/tonight_store.dart';
import 'package:story_app/state/app_state.dart';

import 'helpers.dart';

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  group('本地存储', () {
    test('存进去再读出来，字段不丢', () async {
      final store = TonightStore();
      final story = storyFromJson(id: 42, title: '会飞的种子');
      await store.save([story]);

      final loaded = await store.load();
      expect(loaded, hasLength(1));
      expect(loaded.single.id, 42);
      expect(loaded.single.title, '会飞的种子');
      expect(loaded.single.ageBand, story.ageBand);
    });

    test('存坏了不崩，返回空列表', () async {
      SharedPreferences.setMockInitialValues({'tonight_list': '不是 JSON'});
      expect(await TonightStore().load(), isEmpty);
    });
  });

  group('故事页加入/移出', () {
    testWidgets('点一次加入，再点一次移出', (tester) async {
      final api = apiWith({
        '/api/stories/8': okEnvelope({
          ...storyJson(id: 8, title: '皮鞭下的猴子'),
          'content': '正文正文正文',
        }),
      });
      final state = AppState(api: api);
      await tester.pumpWidget(wrap(
        const StoryScreen(storyId: 8),
        api: api,
        player: FakePlayerService(),
        state: state,
      ));
      await tester.pumpAndSettle();
      expect(state.inTonight(8), isFalse);

      await tester.tap(find.byKey(const Key('story-tonight')));
      await tester.pumpAndSettle();
      expect(state.inTonight(8), isTrue);
      expect(find.text('已加入今晚的列表'), findsOneWidget);

      // 等提示条自己消失再点第二次：它停在底部，会盖住操作行。
      await tester.pump(const Duration(seconds: 5));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('story-tonight')));
      await tester.pumpAndSettle();
      expect(state.inTonight(8), isFalse);
    });
  });

  group('调整顺序', () {
    testWidgets('把第二集上移一位，顺序落盘', (tester) async {
      tester.view.physicalSize = const Size(1100, 900);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);

      final api = apiWith({
        '/api/stories': okEnvelope(pagedJson([
          storyJson(id: 8, title: '小兔子找月亮'),
          storyJson(id: 9, title: '会飞的种子'),
        ])),
      });
      final state = AppState(api: api);
      await state.setTonightOrder([
        storyFromJson(id: 8, title: '小兔子找月亮'),
        storyFromJson(id: 9, title: '会飞的种子'),
        storyFromJson(id: 10, title: '勇敢的小刺猬'),
      ]);

      await tester.pumpWidget(wrap(
        PlayerScreen(story: storyFromJson(id: 8, title: '小兔子找月亮')),
        api: api,
        player: FakePlayerService(),
        state: state,
      ));
      await tester.pumpAndSettle();
      expect(state.tonight.map((s) => s.id).toList(), [8, 9, 10]);

      await tester.tap(find.byKey(const Key('queue-up-10')));
      await tester.pumpAndSettle();

      expect(state.tonight.map((s) => s.id).toList(), [8, 10, 9],
          reason: '正在播的第 8 集保住首位，其余按新顺序');
      final stored = await TonightStore().load();
      expect(stored.map((s) => s.id).toList(), [8, 10, 9]);
    });

    testWidgets('第一项的上移按钮是禁用的', (tester) async {
      tester.view.physicalSize = const Size(1100, 900);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);

      final api = apiWith({
        '/api/stories': okEnvelope(pagedJson([storyJson(id: 8, title: '小兔子找月亮')])),
      });
      final state = AppState(api: api);
      await state.setTonightOrder([storyFromJson(id: 9, title: '会飞的种子')]);

      await tester.pumpWidget(wrap(
        PlayerScreen(story: storyFromJson(id: 8, title: '小兔子找月亮')),
        api: api,
        player: FakePlayerService(),
        state: state,
      ));
      await tester.pumpAndSettle();

      final button = tester.widget<IconButton>(find.byKey(const Key('queue-up-9')));
      expect(button.onPressed, isNull);
    });
  });

  group('播放器合并显示', () {
    testWidgets('用户加进来的故事出现在今晚的列表里', (tester) async {
      tester.view.physicalSize = const Size(1100, 800);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);

      final api = apiWith({
        '/api/stories': okEnvelope(pagedJson([storyJson(id: 8, title: '小兔子找月亮')])),
      });
      final state = AppState(api: api);
      await state.toggleTonight(storyFromJson(id: 77, title: '用户加的故事'));

      await tester.pumpWidget(wrap(
        PlayerScreen(story: storyFromJson(id: 8, title: '小兔子找月亮')),
        api: api,
        player: FakePlayerService(),
        state: state,
      ));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('player-playlist')), findsOneWidget);
      expect(find.text('用户加的故事'), findsOneWidget);
    });
  });
}
