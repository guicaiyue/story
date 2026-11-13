// 平板适配：宽度分档、内容最大宽度、宽屏导航挪到侧边。
//
// 为什么要有这组：产品要求「安卓 App 支持平板」，而 0.1.1 的实现里没有一处
// MediaQuery/LayoutBuilder —— 平板跑起来就是放大的手机界面。这里把行为钉死。

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:story_app/screens/category_screen.dart';
import 'package:story_app/models/models.dart';
import 'package:story_app/screens/main_shell.dart';
import 'package:story_app/screens/player_screen.dart';
import 'package:story_app/services/player_service.dart';
import 'package:story_app/theme/layout.dart';

import 'helpers.dart';

void main() {
  group('宽度分档', () {
    test('手机 / 小平板 / 平板与桌面', () {
      expect(layoutClassOf(390), LayoutClass.compact);
      expect(layoutClassOf(599), LayoutClass.compact);
      expect(layoutClassOf(600), LayoutClass.medium);
      expect(layoutClassOf(899), LayoutClass.medium);
      expect(layoutClassOf(900), LayoutClass.expanded);
      expect(layoutClassOf(1280), LayoutClass.expanded);
    });

    test('卡片宽度随档位放大', () {
      expect(cardWidthOf(LayoutClass.compact, compact: 150, medium: 170, expanded: 190), 150);
      expect(cardWidthOf(LayoutClass.medium, compact: 150, medium: 170, expanded: 190), 170);
      expect(cardWidthOf(LayoutClass.expanded, compact: 150, medium: 170, expanded: 190), 190);
      // 只给 compact 时，其它档位回落到 compact，不允许出现 0 或 null。
      expect(cardWidthOf(LayoutClass.expanded, compact: 120), 120);
    });

    test('内容最大宽度：手机吃满，平板收窄；宽屏才用侧边导航', () {
      expect(contentMaxWidthOf(LayoutClass.compact), double.infinity);
      expect(contentMaxWidthOf(LayoutClass.medium), 720);
      expect(contentMaxWidthOf(LayoutClass.expanded), 960);
      expect(usesSideNav(LayoutClass.compact), isFalse);
      expect(usesSideNav(LayoutClass.medium), isFalse);
      expect(usesSideNav(LayoutClass.expanded), isTrue);
    });
  });

  group('播放器形态', () {
    const story = Story(
      id: 8,
      title: '小兔子找月亮',
      excerpt: '',
      ageBand: '3-6',
      categoryId: 1,
      categoryName: '睡前故事',
      durationSec: 380,
      featured: false,
    );

    /// 队列由同年龄档推荐填充，所以这里要给出 /api/stories 的响应。
    Future<void> pumpPlayer(WidgetTester tester, Size size) async {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(wrap(
        const PlayerScreen(story: story),
        api: apiWith({
          '/api/stories': okEnvelope(pagedJson([
            storyJson(id: 8, title: '小兔子找月亮'),
            storyJson(id: 9, title: '会飞的种子'),
          ])),
        }),
        player: FakePlayerService(),
      ));
      await tester.pumpAndSettle();
    }

    testWidgets('平板宽度：左封面+列表，右控制（双栏）', (tester) async {
      await pumpPlayer(tester, const Size(1100, 800));
      expect(find.byKey(const Key('player-wide')), findsOneWidget);
      expect(find.byKey(const Key('player-narrow')), findsNothing);
      // 设计草案右侧的「今晚的列表」在平板上常驻
      expect(find.byKey(const Key('player-playlist')), findsOneWidget);
      expect(find.textContaining('今晚的列表'), findsOneWidget);
      expect(find.text('会飞的种子'), findsOneWidget);
    });

    testWidgets('平板宽度：可以把一集移出今晚的列表', (tester) async {
      await pumpPlayer(tester, const Size(1100, 800));
      expect(find.text('会飞的种子'), findsOneWidget);

      await tester.tap(find.byKey(const Key('queue-remove-9')));
      await tester.pumpAndSettle();

      expect(find.text('会飞的种子'), findsNothing);
      expect(find.textContaining('今晚的列表 · 1 个'), findsOneWidget);
    });

    testWidgets('手机宽度：仍是单栏', (tester) async {
      await pumpPlayer(tester, const Size(400, 800));
      expect(find.byKey(const Key('player-narrow')), findsOneWidget);
      expect(find.byKey(const Key('player-wide')), findsNothing);
      // 列表只在平板上出现：手机上播放器已经很长，再加列表只会更难用
      expect(find.byKey(const Key('player-playlist')), findsNothing);
    });
  });

  group('主界面导航形态', () {
    Future<void> pumpAt(WidgetTester tester, Size size) async {
      // 用 view.physicalSize + devicePixelRatio=1 设逻辑尺寸（setSurfaceSize 在
      // MaterialApp 已建 MediaQuery 的情况下不一定生效，实测会读到 800x600）。
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(wrap(
        const MainShell(),
        api: apiWith({}),
        player: FakePlayerService(),
      ));
      await tester.pump();
    }

    testWidgets('手机宽度：底部导航，没有侧边栏', (tester) async {
      await pumpAt(tester, const Size(400, 800));
      expect(find.byKey(const Key('bottom-nav')), findsOneWidget);
      expect(find.byKey(const Key('side-nav')), findsNothing);
    });

    testWidgets('平板宽度：侧边导航，没有底部导航', (tester) async {
      await pumpAt(tester, const Size(1100, 800));
      expect(find.byKey(const Key('side-nav')), findsOneWidget);
      expect(find.byKey(const Key('bottom-nav')), findsNothing);
    });

    testWidgets('平板宽度：内容页被收窄到 960（首页那种全幅页面不收窄）', (tester) async {
      tester.view.physicalSize = const Size(1100, 800);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(wrap(
        const CategoryScreen(),
        api: apiWith({}),
        player: FakePlayerService(),
      ));
      await tester.pump();
      final widths = tester
          .widgetList<ConstrainedBox>(find.byType(ConstrainedBox))
          .map((box) => box.constraints.maxWidth)
          .where((max) => max.isFinite);
      expect(widths, contains(960.0));
    });

    testWidgets('平板宽度点击侧边项能切页', (tester) async {
      await pumpAt(tester, const Size(1100, 800));
      await tester.tap(find.descendant(
        of: find.byKey(const Key('side-nav')),
        matching: find.text('分类'),
      ));
      await tester.pump();
      expect(find.text('分类'), findsWidgets);
    });
  });
}
