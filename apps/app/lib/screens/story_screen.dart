import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/models.dart';
import '../services/api_client.dart';
import '../state/app_state.dart';
import '../theme/tokens.dart';
import '../widgets/common.dart';
import 'player_screen.dart';

/// 故事详情页。
///
/// 数据来自 `/api/stories/:id`（含正文，正文在服务端由 `story_content` 表提供）。
class StoryScreen extends StatefulWidget {
  const StoryScreen({required this.storyId, super.key});

  final int storyId;

  @override
  State<StoryScreen> createState() => _StoryScreenState();
}

class _StoryScreenState extends State<StoryScreen> {
  late Future<StoryDetail> _future;

  @override
  void initState() {
    super.initState();
    _future = context.read<AppState>().api.story(widget.storyId);
  }

  void _reload() =>
      setState(() => _future = context.read<AppState>().api.story(widget.storyId));

  /// 加入/移出「今晚的列表」。纯本地操作，立即生效，不依赖网络。
  Future<void> _toggleTonight(Story story) async {
    final state = context.read<AppState>();
    final added = await state.toggleTonight(story);
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(added ? '已加入今晚的列表' : '已移出今晚的列表')),
    );
  }

  Future<void> _toggleFavorite(Story story) async {
    final state = context.read<AppState>();
    final api = state.api;
    final wasFavorite = state.isFavorite(story.id);
    // 乐观更新：立即反馈，失败再回滚（06 关键体验：不白屏、可兜底）。
    state.toggleFavorite(story.id);
    try {
      if (wasFavorite) {
        await api.removeFavorite(story.id);
      } else {
        await api.addFavorite(story.id);
      }
    } on ApiException catch (e) {
      state.toggleFavorite(story.id);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  void _start(Story story) {
    context.read<AppState>().startPlayback(
          storyId: story.id,
          title: story.title,
          duration: story.durationSec > 0
              ? Duration(seconds: story.durationSec)
              : const Duration(minutes: 3),
        );
    Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => PlayerScreen(story: story)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final p = StoryPalette.of(context);
    return StoryScaffold(
      title: '故事详情',
      showBack: true,
      padded: false,
      child: FutureBuilder<StoryDetail>(
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
          final detail = snap.data;
          if (detail == null) return const EmptyState(message: '故事不存在');
          final s = detail.story;
          final state = context.watch<AppState>();
          final isFav = state.isFavorite(s.id);
          final inTonight = state.inTonight(s.id);

          return Column(
            children: [
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(
                    StoryTokens.s4,
                    StoryTokens.s2,
                    StoryTokens.s4,
                    StoryTokens.s4,
                  ),
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        CoverArt(title: s.title, size: 104, radius: StoryTokens.rLg),
                        const SizedBox(width: StoryTokens.s4),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                s.title,
                                style: TextStyle(
                                  fontSize: 22,
                                  height: 1.3,
                                  fontWeight: FontWeight.w700,
                                  color: p.ink,
                                ),
                              ),
                              const SizedBox(height: StoryTokens.s2),
                              Text(
                                [
                                  if (s.categoryName != null) s.categoryName!,
                                  '${s.ageBand} 岁',
                                  s.durationLabel,
                                ].join(' · '),
                                style: TextStyle(fontSize: 13, color: p.ink2),
                              ),
                              const SizedBox(height: StoryTokens.s3),
                              Row(
                                children: [
                                  StoryChip(label: '${s.ageBand} 岁'),
                                  const SizedBox(width: StoryTokens.s2),
                                  if (s.length != null)
                                    StoryChip(label: '${s.length} 字'),
                                ],
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: StoryTokens.s5),
                    if (s.excerpt != null && s.excerpt!.isNotEmpty)
                      PaperCard(
                        color: p.surface2,
                        child: Text(
                          s.excerpt!,
                          style: TextStyle(fontSize: 14, height: 1.7, color: p.ink2),
                        ),
                      ),
                    const SizedBox(height: StoryTokens.s5),
                    Text(
                      '正文',
                      style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: p.ink),
                    ),
                    const SizedBox(height: StoryTokens.s3),
                    if (detail.paragraphs.isEmpty)
                      Text('暂无正文', style: TextStyle(color: p.ink3))
                    else
                      ...detail.paragraphs.map(
                        (para) => Padding(
                          padding: const EdgeInsets.only(bottom: StoryTokens.s3),
                          child: Text(
                            para,
                            style: TextStyle(fontSize: 16, height: 1.85, color: p.ink),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              // 底部固定操作条
              Container(
                padding: const EdgeInsets.all(StoryTokens.s4),
                decoration: BoxDecoration(
                  color: p.surf,
                  border: Border(top: BorderSide(color: p.line)),
                ),
                child: Row(
                  children: [
                    SizedBox(
                      width: StoryTokens.touchKid,
                      height: StoryTokens.touchKid,
                      child: OutlinedButton(
                        onPressed: () => _toggleFavorite(s),
                        style: OutlinedButton.styleFrom(
                          padding: EdgeInsets.zero,
                          side: BorderSide(color: p.line),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(StoryTokens.rMd),
                          ),
                        ),
                        child: Icon(
                          isFav ? Icons.favorite : Icons.favorite_border,
                          color: isFav ? p.accentInk : p.ink2,
                          semanticLabel: isFav ? '取消收藏' : '收藏',
                        ),
                      ),
                    ),
                    const SizedBox(width: StoryTokens.s3),
                    SizedBox(
                      width: StoryTokens.touchKid,
                      height: StoryTokens.touchKid,
                      child: OutlinedButton(
                        key: const Key('story-tonight'),
                        onPressed: () => _toggleTonight(s),
                        style: OutlinedButton.styleFrom(
                          padding: EdgeInsets.zero,
                          side: BorderSide(color: p.line),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(StoryTokens.rMd),
                          ),
                        ),
                        child: Icon(
                          inTonight ? Icons.playlist_add_check : Icons.playlist_add,
                          color: inTonight ? p.accentInk : p.ink2,
                          semanticLabel: inTonight ? '移出今晚的列表' : '加入今晚的列表',
                        ),
                      ),
                    ),
                    const SizedBox(width: StoryTokens.s3),
                    Expanded(
                      child: PrimaryButton(
                        label: '开始听',
                        icon: Icons.play_arrow_rounded,
                        onPressed: () => _start(s),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}
