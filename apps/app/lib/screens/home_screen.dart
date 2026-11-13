import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/models.dart';
import '../services/api_client.dart';
import '../state/app_state.dart';
import '../theme/layout.dart';
import '../theme/tokens.dart';
import '../widgets/common.dart';
import 'category_screen.dart';
import 'player_screen.dart';
import 'story_screen.dart';

/// 首页。
///
/// 结构对齐设计稿：问候语 → 「今晚听什么」大卡片 → 继续听 → 场景 → 推荐分类。
/// 数据全部来自 `/api/home`（真实接口，无假数据）。
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  late Future<HomeData> _future;

  /// 上一次请求用的年龄档，用于判断家长改了设置后要不要重新拉。
  String? _loadedBand;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  /// 首页数据按孩子的年龄档拉取（内容安全闸，服务端也会兜底过滤）。
  /// 家长在设置里改了年龄档后，首页必须跟着换成对应档位的内容。
  Future<HomeData> _load() {
    final state = context.read<AppState>();
    final band = state.settings.ageFilter;
    _loadedBand = band;
    return state.api.home(ageBand: band);
  }

  void _reload() => setState(() => _future = _load());

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // 设置是异步从服务端加载的（AppState.loadSettings），首帧可能还是默认
    // 的 3-6。等真实设置到达、且和已请求的档位不一致时，重新拉一次，
    // 否则 6-9 / 9+ 的孩子会一直停在 3-6 的内容上。
    final band = context.watch<AppState>().settings.ageFilter;
    if (_loadedBand != null && band != _loadedBand) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _reload();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = StoryPalette.of(context);
    return StoryScaffold(
      padded: false,
      child: RefreshIndicator(
        color: p.accent,
        onRefresh: () async => _reload(),
        child: FutureBuilder<HomeData>(
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
            final data = snap.data;
            if (data == null) {
              return ErrorState(message: '暂无内容', onRetry: _reload);
            }
            return ListView(
              padding: const EdgeInsets.fromLTRB(
                StoryTokens.s4,
                0,
                StoryTokens.s4,
                StoryTokens.s7,
              ),
              children: [
                // 问候语不显示孩子的年龄档 —— 之前这里传的是 settings.ageFilter，
                // 会把「3-6」当成昵称。昵称目前没有数据源（服务端无该字段），
                // 所以不传，只显示时段问候。
                const _Greeting(),
                const SizedBox(height: StoryTokens.s4),
                _TonightCard(
                  story: data.tonight,
                  onPlay: (story) => _openPlayer(story),
                  onOpen: (story) => _openStory(story),
                ),
                if (data.continueListening.isNotEmpty) ...[
                  const SizedBox(height: StoryTokens.s6),
                  _SectionTitle('继续听'),
                  const SizedBox(height: StoryTokens.s3),
                  _ContinueRow(entries: data.continueListening),
                ],
                const SizedBox(height: StoryTokens.s6),
                _SectionTitle('场景'),
                const SizedBox(height: StoryTokens.s3),
                _Scenes(
                  onPick: (band) => _openCategory(context, ageBand: band),
                ),
                const SizedBox(height: StoryTokens.s6),
                _SectionTitle('推荐分类'),
                const SizedBox(height: StoryTokens.s3),
                _CategoryGrid(categories: data.categories),
              ],
            );
          },
        ),
      ),
    );
  }

  void _openPlayer(Story story) {
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

  void _openStory(Story story) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => StoryScreen(storyId: story.id)),
    );
  }

  void _openCategory(BuildContext context, {String? ageBand}) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => CategoryScreen(initialAgeBand: ageBand)),
    );
  }
}

class _Greeting extends StatelessWidget {
  const _Greeting();

  @override
  Widget build(BuildContext context) {
    final p = StoryPalette.of(context);
    final hour = DateTime.now().hour;
    final period = hour < 12
        ? '早上好'
        : hour < 18
            ? '下午好'
            : '晚上好';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          period,
          style: TextStyle(fontSize: 26, fontWeight: FontWeight.w700, color: p.ink),
        ),
        const SizedBox(height: 2),
        Text(
          '今晚想听点什么？',
          style: TextStyle(fontSize: 14, color: p.ink2),
        ),
      ],
    );
  }
}

/// 「今晚听什么」大卡片 —— 首页第一屏唯一的主 CTA（01-product-brief §4.1）。
class _TonightCard extends StatelessWidget {
  const _TonightCard({required this.story, required this.onPlay, required this.onOpen});

  final Story? story;
  final void Function(Story) onPlay;
  final void Function(Story) onOpen;

  @override
  Widget build(BuildContext context) {
    final p = StoryPalette.of(context);
    final s = story;

    if (s == null) {
      return PaperCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('今晚听什么', style: TextStyle(fontSize: 13, color: p.ink2)),
            const SizedBox(height: StoryTokens.s3),
            Text('暂时没有可推荐的故事', style: TextStyle(fontSize: 18, color: p.ink)),
            const SizedBox(height: StoryTokens.s2),
            Text(
              '内容正在准备中，稍后再来看看',
              style: TextStyle(fontSize: 13, color: p.ink3),
            ),
          ],
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.all(StoryTokens.s5),
      decoration: BoxDecoration(
        color: p.deep,
        borderRadius: BorderRadius.circular(StoryTokens.rXl),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.nightlight_round, size: 16, color: p.onDeep.withValues(alpha: 0.7)),
              const SizedBox(width: StoryTokens.s2),
              Text(
                '今晚听什么',
                style: TextStyle(fontSize: 13, color: p.onDeep.withValues(alpha: 0.7)),
              ),
            ],
          ),
          const SizedBox(height: StoryTokens.s4),
          Text(
            s.title,
            style: TextStyle(
              fontSize: 24,
              height: 1.3,
              fontWeight: FontWeight.w700,
              color: p.onDeep,
            ),
          ),
          const SizedBox(height: StoryTokens.s2),
          Text(
            [
              if (s.categoryName != null) s.categoryName!,
              '${s.ageBand} 岁',
              s.durationLabel,
            ].join(' · '),
            style: TextStyle(fontSize: 13, color: p.onDeep.withValues(alpha: 0.65)),
          ),
          const SizedBox(height: StoryTokens.s5),
          Row(
            children: [
              Expanded(
                child: SizedBox(
                  height: StoryTokens.touchKid,
                  child: FilledButton.icon(
                    onPressed: () => onPlay(s),
                    icon: const Icon(Icons.play_arrow_rounded, size: 26),
                    label: const Text('开始听', style: TextStyle(fontSize: 17)),
                    style: FilledButton.styleFrom(
                      backgroundColor: p.accent,
                      foregroundColor: Colors.white,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(StoryTokens.rMd),
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: StoryTokens.s3),
              SizedBox(
                height: StoryTokens.touchKid,
                child: OutlinedButton(
                  onPressed: () => onOpen(s),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: p.onDeep,
                    side: BorderSide(color: p.onDeep.withValues(alpha: 0.3)),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(StoryTokens.rMd),
                    ),
                  ),
                  child: const Text('详情'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.text);

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

class _ContinueRow extends StatelessWidget {
  const _ContinueRow({required this.entries});

  final List<ProgressEntry> entries;

  @override
  Widget build(BuildContext context) {
    final p = StoryPalette.of(context);
    return SizedBox(
      height: 116,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: entries.length,
        separatorBuilder: (_, _) => const SizedBox(width: StoryTokens.s3),
        itemBuilder: (context, i) {
          final e = entries[i];
          final title = e.story?.title ?? '故事 #${e.storyId}';
          return SizedBox(
            width: cardWidthOf(
              layoutOf(context),
              compact: 200,
              medium: 220,
              expanded: 240,
            ),
            child: PaperCard(
              padding: const EdgeInsets.all(StoryTokens.s3),
              onTap: () {
                final s = e.story;
                if (s != null) {
                  Navigator.of(context).push(
                    MaterialPageRoute<void>(builder: (_) => StoryScreen(storyId: s.id)),
                  );
                }
              },
              child: Row(
                children: [
                  CoverArt(title: title, size: 56, radius: StoryTokens.rSm),
                  const SizedBox(width: StoryTokens.s3),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(
                          title,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                            color: p.ink,
                          ),
                        ),
                        const SizedBox(height: StoryTokens.s1),
                        Text(
                          '听到 ${_fmt(e.positionSec)}',
                          style: TextStyle(fontSize: 12, color: p.ink2),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  static String _fmt(int sec) {
    final m = sec ~/ 60;
    final s = sec % 60;
    return s == 0 ? '$m 分' : '$m 分 $s 秒';
  }
}

/// 场景入口：哄睡 / 叫早 / 出行。
///
/// 服务端没有「场景」字段，这里用年龄档与浏览入口表达；
/// 场景 → 歌单的映射需要运营配置，属 M3 之后范围（已在 README 标注）。
class _Scenes extends StatelessWidget {
  const _Scenes({required this.onPick});

  final void Function(String? ageBand) onPick;

  @override
  Widget build(BuildContext context) {
    final p = StoryPalette.of(context);
    const scenes = [
      (Icons.bedtime_outlined, '哄睡', '安静下来慢慢听', '3-6'),
      (Icons.wb_sunny_outlined, '叫早', '起床时的轻声故事', '6-9'),
      (Icons.directions_bus_outlined, '出行', '路上听，不无聊', null),
    ];
    return Row(
      children: [
        for (final (icon, title, sub, band) in scenes)
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(right: band == null ? 0 : StoryTokens.s3),
              child: PaperCard(
                padding: const EdgeInsets.all(StoryTokens.s3),
                onTap: () => onPick(band),
                child: Column(
                  children: [
                    Icon(icon, size: 26, color: p.accentInk),
                    const SizedBox(height: StoryTokens.s2),
                    Text(
                      title,
                      style: TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                        color: p.ink,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      sub,
                      textAlign: TextAlign.center,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 11, color: p.ink3),
                    ),
                  ],
                ),
              ),
            ),
          ),
      ],
    );
  }
}

class _CategoryGrid extends StatelessWidget {
  const _CategoryGrid({required this.categories});

  final List<Category> categories;

  @override
  Widget build(BuildContext context) {
    final p = StoryPalette.of(context);
    if (categories.isEmpty) {
      return Text('暂无分类', style: TextStyle(color: p.ink3));
    }
    return Wrap(
      spacing: StoryTokens.s3,
      runSpacing: StoryTokens.s3,
      children: [
        for (final c in categories.take(8))
          SizedBox(
            width: cardWidthOf(
              layoutOf(context),
              compact: 150,
              medium: 170,
              expanded: 190,
            ),
            child: PaperCard(
              padding: const EdgeInsets.all(StoryTokens.s3),
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => CategoryScreen(categoryId: c.id),
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    c.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                      color: p.ink,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    '${c.storyCount} 篇',
                    style: TextStyle(fontSize: 12, color: p.ink3),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}
