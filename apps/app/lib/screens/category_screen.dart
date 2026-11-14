import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/models.dart';
import '../services/api_client.dart';
import '../state/app_state.dart';
import '../theme/tokens.dart';
import '../widgets/common.dart';
import 'story_screen.dart';

/// 分类 / 浏览页。
///
/// 支持按分类 + 年龄档 + 时长筛选，服务端分页（`/api/stories`）。
/// 时长筛选在后端没有区间参数，因此按「音频长度」在前端做二次过滤，
/// 并在界面上说明（避免让用户以为筛选没生效）。
class CategoryScreen extends StatefulWidget {
  const CategoryScreen({this.categoryId, this.initialAgeBand, super.key});

  final int? categoryId;
  final String? initialAgeBand;

  @override
  State<CategoryScreen> createState() => _CategoryScreenState();
}

/// 时长筛选档位。
enum DurationFilter {
  any('不限'),
  short('5 分钟内'),
  medium('5–15 分钟'),
  long('15 分钟以上');

  const DurationFilter(this.label);
  final String label;
}

class _CategoryScreenState extends State<CategoryScreen> {
  String? _ageBand;
  DurationFilter _duration = DurationFilter.any;
  int? _categoryId;
  int _page = 1;
  static const _pageSize = 20;

  late Future<Paged<Story>> _future;
  late Future<List<Category>> _categoriesFuture;

  @override
  void initState() {
    super.initState();
    // 默认落回**孩子的年龄档**，不是「全年龄」。
    //
    // 之前没传 initialAgeBand 时 _ageBand 是 null，等于把 9+ 的聊斋/怪谈
    // 混进孩子的浏览列表（从首页分类卡片、底部「分类」Tab 进来都会这样）。
    // 用户仍可点年龄 chip 显式切换或取消筛选，但**默认值必须安全**。
    _ageBand = widget.initialAgeBand ?? context.read<AppState>().settings.ageFilter;
    _categoryId = widget.categoryId;
    _future = _load();
    _categoriesFuture = context.read<AppState>().api.categories();
  }

  Future<Paged<Story>> _load() => context.read<AppState>().api.stories(
        page: _page,
        pageSize: _pageSize,
        categoryId: _categoryId,
        ageBand: _ageBand,
      );

  void _reload() => setState(() => _future = _load());

  /// 时长档位过滤（M1 的 durationSec 多为 0，此时归入「不限」而非被筛掉）。
  List<Story> _applyDuration(List<Story> items) {
    if (_duration == DurationFilter.any) return items;
    return items.where((s) {
      if (s.durationSec <= 0) return false;
      return switch (_duration) {
        DurationFilter.short => s.durationSec < 300,
        DurationFilter.medium => s.durationSec >= 300 && s.durationSec <= 900,
        DurationFilter.long => s.durationSec > 900,
        DurationFilter.any => true,
      };
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    return StoryScaffold(
      title: '分类',
      showBack: true,
      padded: false,
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: StoryTokens.s4),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // 年龄档筛选
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: [
                      for (final band in const ['3-6', '6-9', '9+'])
                        Padding(
                          padding: const EdgeInsets.only(right: StoryTokens.s2),
                          child: StoryChip(
                            label: '$band 岁',
                            selected: _ageBand == band,
                            onTap: () {
                              setState(() {
                                _ageBand = _ageBand == band ? null : band;
                                _page = 1;
                                _future = _load();
                              });
                            },
                          ),
                        ),
                    ],
                  ),
                ),
                const SizedBox(height: StoryTokens.s3),
                // 分类筛选
                FutureBuilder<List<Category>>(
                  future: _categoriesFuture,
                  builder: (context, snap) {
                    final cats = snap.data ?? const <Category>[];
                    if (cats.isEmpty) return const SizedBox.shrink();
                    return SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Row(
                        children: [
                          for (final c in cats)
                            Padding(
                              padding: const EdgeInsets.only(right: StoryTokens.s2),
                              child: StoryChip(
                                label: c.name,
                                selected: _categoryId == c.id,
                                onTap: () {
                                  setState(() {
                                    _categoryId = _categoryId == c.id ? null : c.id;
                                    _page = 1;
                                    _future = _load();
                                  });
                                },
                              ),
                            ),
                        ],
                      ),
                    );
                  },
                ),
                const SizedBox(height: StoryTokens.s3),
                // 时长筛选
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: [
                      for (final d in DurationFilter.values)
                        Padding(
                          padding: const EdgeInsets.only(right: StoryTokens.s2),
                          child: StoryChip(
                            label: d.label,
                            selected: _duration == d,
                            onTap: () => setState(() => _duration = d),
                          ),
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: StoryTokens.s3),
          Expanded(
            child: FutureBuilder<Paged<Story>>(
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
                final page = snap.data;
                if (page == null) return const EmptyState(message: '暂无内容');
                final items = _applyDuration(page.items);
                if (items.isEmpty) {
                  return const EmptyState(message: '没有符合条件的故事\n试试换个筛选条件');
                }
                return Column(
                  children: [
                    Expanded(
                      child: ListView.separated(
                        padding: const EdgeInsets.symmetric(horizontal: StoryTokens.s4),
                        itemCount: items.length,
                        separatorBuilder: (_, _) => const SizedBox(height: StoryTokens.s3),
                        itemBuilder: (context, i) => _StoryRow(
                          story: items[i],
                          onTap: () => Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (_) => StoryScreen(storyId: items[i].id),
                            ),
                          ),
                        ),
                      ),
                    ),
                    _Pager(
                      page: page.page,
                      totalPages: page.totalPages,
                      total: page.total,
                      onPrev: page.page > 1
                          ? () => setState(() {
                                _page = page.page - 1;
                                _future = _load();
                              })
                          : null,
                      onNext: page.page < page.totalPages
                          ? () => setState(() {
                                _page = page.page + 1;
                                _future = _load();
                              })
                          : null,
                    ),
                  ],
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _StoryRow extends StatelessWidget {
  const _StoryRow({required this.story, required this.onTap});

  final Story story;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = StoryPalette.of(context);
    return PaperCard(
      onTap: onTap,
      child: Row(
        children: [
          CoverArt(title: story.title, size: 64),
          const SizedBox(width: StoryTokens.s3),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  story.title,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                    color: p.ink,
                  ),
                ),
                const SizedBox(height: StoryTokens.s2),
                Text(
                  [
                    if (story.categoryName != null) story.categoryName!,
                    '${story.ageBand} 岁',
                    story.durationLabel,
                  ].join(' · '),
                  style: TextStyle(fontSize: 12, color: p.ink3),
                ),
              ],
            ),
          ),
          Icon(Icons.chevron_right, color: p.ink3),
        ],
      ),
    );
  }
}

class _Pager extends StatelessWidget {
  const _Pager({
    required this.page,
    required this.totalPages,
    required this.total,
    this.onPrev,
    this.onNext,
  });

  final int page;
  final int totalPages;
  final int total;
  final VoidCallback? onPrev;
  final VoidCallback? onNext;

  @override
  Widget build(BuildContext context) {
    final p = StoryPalette.of(context);
    return Padding(
      padding: const EdgeInsets.all(StoryTokens.s4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          SizedBox(
            width: 96,
            child: GhostButton(label: '上一页', onPressed: onPrev),
          ),
          Text(
            '$page / $totalPages · 共 $total 篇',
            style: TextStyle(fontSize: 12, color: p.ink2),
          ),
          SizedBox(
            width: 96,
            child: GhostButton(label: '下一页', onPressed: onNext),
          ),
        ],
      ),
    );
  }
}
