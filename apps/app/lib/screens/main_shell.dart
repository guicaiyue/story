import 'package:flutter/material.dart';

import '../models/models.dart';
import '../theme/layout.dart';
import '../theme/tokens.dart';
import '../widgets/common.dart';
import 'category_screen.dart';
import 'home_screen.dart';
import 'mine_screen.dart';
import 'player_screen.dart';

/// 底部导航的三个主页面：首页 / 分类 / 我的。
/// 启动页、故事详情、播放器、家长门、家长中心、夜间播放器为 push 出来的页面。
class MainShell extends StatefulWidget {
  const MainShell({super.key});

  @override
  State<MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<MainShell> {
  int _index = 0;

  static const _tabs = [
    (Icons.home_outlined, Icons.home, '首页'),
    (Icons.grid_view_outlined, Icons.grid_view, '分类'),
    (Icons.person_outline, Icons.person, '我的'),
  ];

  @override
  Widget build(BuildContext context) {
    final p = StoryPalette.of(context);
    final layout = layoutOf(context);
    final body = IndexedStack(
      index: _index,
      children: const [
        HomeScreen(),
        CategoryScreen(),
        MineScreen(),
      ],
    );
    // 平板/桌面：导航挪到左侧（拇指不用跨过整块屏幕），内容仍由 StoryScaffold 收窄居中。
    if (usesSideNav(layout)) {
      return StoryScaffold(
        padded: false,
        fullBleed: true,
        child: Row(
          children: [
            _sideNav(p),
            VerticalDivider(width: 1, color: p.line),
            Expanded(child: body),
          ],
        ),
      );
    }
    return StoryScaffold(
      padded: false,
      fullBleed: true,
      child: Column(
        children: [
          Expanded(child: body),
          _bottomNav(p),
        ],
      ),
    );
  }

  Widget _tabItem(StoryPalette p, int i, {required bool vertical}) {
    final selected = _index == i;
    final icon = Icon(
      selected ? _tabs[i].$2 : _tabs[i].$1,
      color: selected ? p.accentInk : p.ink3,
      size: 24,
    );
    final label = Text(
      _tabs[i].$3,
      style: TextStyle(
        fontSize: 11,
        color: selected ? p.accentInk : p.ink3,
        fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
      ),
    );
    return Semantics(
      selected: selected,
      button: true,
      label: _tabs[i].$3,
      child: InkWell(
        onTap: () => setState(() => _index = i),
        child: SizedBox(
          width: vertical ? 96 : null,
          height: StoryTokens.touchKid,
          child: vertical
              ? Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [icon, const SizedBox(height: 4), label],
                )
              : Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [icon, const SizedBox(height: 2), label],
                ),
        ),
      ),
    );
  }

  Widget _bottomNav(StoryPalette p) {
    return Container(
      key: const Key('bottom-nav'),
      decoration: BoxDecoration(
        color: p.surf,
        border: Border(top: BorderSide(color: p.line)),
      ),
      padding: const EdgeInsets.symmetric(vertical: StoryTokens.s1),
      child: Row(
        children: [
          for (var i = 0; i < _tabs.length; i++)
            Expanded(child: _tabItem(p, i, vertical: false)),
        ],
      ),
    );
  }

  Widget _sideNav(StoryPalette p) {
    return Container(
      key: const Key('side-nav'),
      color: p.surf,
      padding: const EdgeInsets.symmetric(vertical: StoryTokens.s3),
      child: Column(
        children: [
          for (var i = 0; i < _tabs.length; i++)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: _tabItem(p, i, vertical: true),
            ),
        ],
      ),
    );
  }
}

/// 调试用：直接打开夜间播放器（评测验收第 9 屏）。
/// 正常入口是播放器页右上角的夜间开关。
Future<void> openNightPlayer(BuildContext context, Story story) {
  return Navigator.of(context).push(
    MaterialPageRoute<void>(builder: (_) => PlayerScreen(story: story, nightMode: true)),
  );
}
