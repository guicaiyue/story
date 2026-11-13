import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/models.dart';
import '../services/api_client.dart';
import '../state/app_state.dart';
import '../theme/tokens.dart';
import '../widgets/common.dart';
import 'category_screen.dart';
import 'parent_gate_screen.dart';
import 'parent_screen.dart';
import 'story_screen.dart';

/// 「我的」页。
///
/// 结构对齐设计稿：继续听 / 收藏 / 最近听过 / 家长入口。
/// 数据来自 `/api/progress`、`/api/favorites`（需要 token）。
class MineScreen extends StatefulWidget {
  const MineScreen({super.key});

  @override
  State<MineScreen> createState() => _MineScreenState();
}

class _MineScreenState extends State<MineScreen> {
  late Future<_MineData> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  /// 两个接口并发拉取；收藏失败不阻塞继续听。
  Future<_MineData> _load() async {
    final api = context.read<AppState>().api;
    final results = await Future.wait([
      api.progress().catchError((_) => <ProgressEntry>[]),
      api.favorites().catchError((_) => <ProgressEntry>[]),
    ]);
    final progress = results[0];
    final favorites = results[1];
    return _MineData(progress: progress, favorites: favorites);
  }

  void _reload() => setState(() => _future = _load());

  @override
  Widget build(BuildContext context) {
    final p = StoryPalette.of(context);
    final state = context.watch<AppState>();

    return StoryScaffold(
      title: '我的',
      padded: false,
      child: RefreshIndicator(
        color: p.accent,
        onRefresh: () async => _reload(),
        child: FutureBuilder<_MineData>(
          future: _future,
          builder: (context, snap) {
            if (snap.connectionState == ConnectionState.waiting) {
              return const LoadingState();
            }
            if (snap.hasError) {
              final err = snap.error;
              return ErrorState(
                message: err is ApiException ? err.message : '加载失败',
                onRetry: _reload,
              );
            }
            final data = snap.data ?? const _MineData(progress: [], favorites: []);

            return ListView(
              padding: const EdgeInsets.fromLTRB(
                StoryTokens.s4,
                0,
                StoryTokens.s4,
                StoryTokens.s7,
              ),
              children: [
                _BlockTitle('继续听'),
                const SizedBox(height: StoryTokens.s3),
                if (data.progress.isEmpty)
                  const _InlineEmpty('还没有听过的故事')
                else
                  ...data.progress.take(5).map((e) => _ProgressTile(entry: e)),

                const SizedBox(height: StoryTokens.s6),
                _BlockTitle('收藏'),
                const SizedBox(height: StoryTokens.s3),
                if (data.favorites.isEmpty)
                  const _InlineEmpty('还没有收藏的故事')
                else
                  ...data.favorites.take(5).map((e) => _ProgressTile(entry: e)),

                const SizedBox(height: StoryTokens.s6),
                _BlockTitle('最近听过'),
                const SizedBox(height: StoryTokens.s3),
                if (state.recentIds.isEmpty)
                  const _InlineEmpty('本次还没有播放记录')
                else
                  Text(
                    '本次会话播放过 ${state.recentIds.length} 个故事',
                    style: TextStyle(fontSize: 14, color: p.ink2),
                  ),

                const SizedBox(height: StoryTokens.s6),
                _BlockTitle('家长'),
                const SizedBox(height: StoryTokens.s3),
                PaperCard(
                  onTap: () => _openParent(context),
                  child: Row(
                    children: [
                      Icon(Icons.lock_outline, size: 22, color: p.accentInk),
                      const SizedBox(width: StoryTokens.s3),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              '家长中心',
                              style: TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.w600,
                                color: p.ink,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              '时长限制 · 年龄档 · 播放报告',
                              style: TextStyle(fontSize: 12, color: p.ink3),
                            ),
                          ],
                        ),
                      ),
                      Icon(Icons.chevron_right, color: p.ink3),
                    ],
                  ),
                ),

                const SizedBox(height: StoryTokens.s5),
                // 夜间模式开关（全局）
                PaperCard(
                  color: p.surface2,
                  padding: const EdgeInsets.symmetric(
                    horizontal: StoryTokens.s4,
                    vertical: StoryTokens.s2,
                  ),
                  child: Row(
                    children: [
                      Icon(Icons.dark_mode_outlined, size: 20, color: p.ink2),
                      const SizedBox(width: StoryTokens.s3),
                      Expanded(
                        child: Text('夜间模式', style: TextStyle(fontSize: 15, color: p.ink)),
                      ),
                      Switch(
                        value: state.isNight,
                        activeThumbColor: p.accent,
                        onChanged: state.setNight,
                      ),
                    ],
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }

  /// 进家长中心必须先过家长门（00-research 原则 4）。
  Future<void> _openParent(BuildContext context) async {
    final state = context.read<AppState>();
    if (state.parentUnlocked) {
      await Navigator.of(context).push(
        MaterialPageRoute<void>(builder: (_) => const ParentScreen()),
      );
      return;
    }
    final passed = await Navigator.of(context).push<bool>(
      MaterialPageRoute<bool>(builder: (_) => const ParentGateScreen()),
    );
    if (passed == true && context.mounted) {
      await Navigator.of(context).push(
        MaterialPageRoute<void>(builder: (_) => const ParentScreen()),
      );
    }
  }
}

class _MineData {
  const _MineData({required this.progress, required this.favorites});

  final List<ProgressEntry> progress;
  final List<ProgressEntry> favorites;
}

class _BlockTitle extends StatelessWidget {
  const _BlockTitle(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    final p = StoryPalette.of(context);
    return Text(
      text,
      style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: p.ink),
    );
  }
}

class _InlineEmpty extends StatelessWidget {
  const _InlineEmpty(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    final p = StoryPalette.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: StoryTokens.s3),
      child: Text(text, style: TextStyle(fontSize: 14, color: p.ink3)),
    );
  }
}

class _ProgressTile extends StatelessWidget {
  const _ProgressTile({required this.entry});

  final ProgressEntry entry;

  @override
  Widget build(BuildContext context) {
    final p = StoryPalette.of(context);
    final story = entry.story;
    final title = story?.title ?? '故事 #${entry.storyId}';
    return Padding(
      padding: const EdgeInsets.only(bottom: StoryTokens.s3),
      child: PaperCard(
        onTap: story == null
            ? null
            : () => Navigator.of(context).push(
                  MaterialPageRoute<void>(builder: (_) => StoryScreen(storyId: story.id)),
                ),
        child: Row(
          children: [
            CoverArt(title: title, size: 52, radius: StoryTokens.rSm),
            const SizedBox(width: StoryTokens.s3),
            Expanded(
              child: Text(
                title,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: p.ink),
              ),
            ),
            Icon(Icons.play_circle_outline, color: p.accentInk),
          ],
        ),
      ),
    );
  }
}

/// 供「家长中心」跳到分类浏览用（年龄档设置后查看内容）。
void openCategoryFromParent(BuildContext context, String ageBand) {
  Navigator.of(context).push(
    MaterialPageRoute<void>(builder: (_) => CategoryScreen(initialAgeBand: ageBand)),
  );
}
