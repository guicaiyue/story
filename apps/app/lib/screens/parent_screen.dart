import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/models.dart';
import '../services/api_client.dart';
import '../state/app_state.dart';
import '../theme/tokens.dart';
import '../widgets/common.dart';

/// 家长中心。
///
/// 入口必须先过 [ParentGateScreen]。包含：每日时长限制、内容年龄档、
/// 播放报告、退出家长中心。
class ParentScreen extends StatefulWidget {
  const ParentScreen({super.key});

  @override
  State<ParentScreen> createState() => _ParentScreenState();
}

class _ParentScreenState extends State<ParentScreen> {
  late Future<_Report> _reportFuture;

  @override
  void initState() {
    super.initState();
    _reportFuture = _loadReport();
  }

  /// 播放报告：用真实接口的数据聚合（继续听条数 + 收藏条数 + 本周播放事件）。
  /// 服务端目前没有「按天聚合」的端点，因此这里只展示可核验的数字，
  /// 不虚构图表（与后台 M2 的处理一致）。
  Future<_Report> _loadReport() async {
    final api = context.read<AppState>().api;
    final progress = await api.progress().catchError((_) => <ProgressEntry>[]);
    final favorites = await api.favorites().catchError((_) => <ProgressEntry>[]);
    return _Report(progressCount: progress.length, favoriteCount: favorites.length);
  }

  void _reload() => setState(() => _reportFuture = _loadReport());

  @override
  Widget build(BuildContext context) {
    final p = StoryPalette.of(context);
    final state = context.watch<AppState>();
    final settings = state.settings;

    return StoryScaffold(
      title: '家长中心',
      showBack: true,
      padded: false,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(
          StoryTokens.s4,
          0,
          StoryTokens.s4,
          StoryTokens.s7,
        ),
        children: [
          // —— 每日时长限制 ——
          _Block(
            key: const Key('block-daily-limit'),
            title: '每日时长限制',
            subtitle: settings.dailyLimitLabel,
            child: Wrap(
              spacing: StoryTokens.s2,
              runSpacing: StoryTokens.s2,
              children: [
                for (final min in const [0, 15, 30, 45, 60])
                  StoryChip(
                    label: min == 0 ? '不限' : '$min 分钟',
                    selected: settings.dailyLimitMin == min,
                    onTap: () => state.updateSettings(settings.copyWith(dailyLimitMin: min)),
                  ),
              ],
            ),
          ),

          // —— 内容年龄档 ——
          _Block(
            title: '内容年龄档',
            subtitle: '只展示适合 ${settings.ageFilter} 岁的内容',
            child: Wrap(
              spacing: StoryTokens.s2,
              runSpacing: StoryTokens.s2,
              children: [
                for (final band in const ['3-6', '6-9', '9+'])
                  StoryChip(
                    label: '$band 岁',
                    selected: settings.ageFilter == band,
                    onTap: () => state.updateSettings(settings.copyWith(ageFilter: band)),
                  ),
              ],
            ),
          ),

          // —— 定时停止默认值 ——
          _Block(
            title: '默认定时停止',
            subtitle: settings.sleepTimerLabel,
            child: Wrap(
              spacing: StoryTokens.s2,
              runSpacing: StoryTokens.s2,
              children: [
                for (final min in const [0, 15, 30, 45])
                  StoryChip(
                    label: min == 0 ? '不自动停止' : '$min 分钟',
                    selected: settings.sleepTimerMin == min,
                    onTap: () => state.updateSettings(settings.copyWith(sleepTimerMin: min)),
                  ),
              ],
            ),
          ),

          // —— 家长门开关 ——
          PaperCard(
            color: p.surface2,
            padding: const EdgeInsets.symmetric(
              horizontal: StoryTokens.s4,
              vertical: StoryTokens.s2,
            ),
            child: Row(
              children: [
                Icon(Icons.shield_outlined, size: 20, color: p.ink2),
                const SizedBox(width: StoryTokens.s3),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('家长门', style: TextStyle(fontSize: 15, color: p.ink)),
                      Text(
                        settings.parentGateEnabled ? '已开启（推荐）' : '已关闭',
                        style: TextStyle(fontSize: 12, color: p.ink3),
                      ),
                    ],
                  ),
                ),
                Switch(
                  value: settings.parentGateEnabled,
                  activeThumbColor: p.accent,
                  onChanged: (v) =>
                      state.updateSettings(settings.copyWith(parentGateEnabled: v)),
                ),
              ],
            ),
          ),

          const SizedBox(height: StoryTokens.s5),

          // —— 播放报告 ——
          Text(
            '播放报告',
            style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: p.ink),
          ),
          const SizedBox(height: StoryTokens.s3),
          FutureBuilder<_Report>(
            future: _reportFuture,
            builder: (context, snap) {
              if (snap.connectionState == ConnectionState.waiting) {
                return const Padding(
                  padding: EdgeInsets.all(StoryTokens.s5),
                  child: Center(child: CircularProgressIndicator()),
                );
              }
              if (snap.hasError) {
                final err = snap.error;
                return ErrorState(
                  message: err is ApiException ? err.message : '报告加载失败',
                  onRetry: _reload,
                );
              }
              final r = snap.data;
              if (r == null) return const EmptyState(message: '暂无播放数据');
              return Column(
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: _StatCard(
                          value: '${r.progressCount}',
                          label: '在听的故事',
                        ),
                      ),
                      const SizedBox(width: StoryTokens.s3),
                      Expanded(
                        child: _StatCard(
                          value: '${r.favoriteCount}',
                          label: '收藏的故事',
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: StoryTokens.s3),
                  PaperCard(
                    child: Row(
                      children: [
                        Icon(Icons.info_outline, size: 18, color: p.ink3),
                        const SizedBox(width: StoryTokens.s2),
                        Expanded(
                          child: Text(
                            '按天/按周的收听时长报表需要服务端新增聚合接口，'
                            '当前只展示可核验的计数。',
                            style: TextStyle(fontSize: 12, color: p.ink3, height: 1.5),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              );
            },
          ),

          const SizedBox(height: StoryTokens.s5),

          // —— 退出 ——
          GhostButton(
            label: '退出家长中心',
            height: StoryTokens.touchKid,
            onPressed: () {
              state.lockParent();
              Navigator.of(context).pop();
            },
          ),
        ],
      ),
    );
  }
}

class _Report {
  const _Report({required this.progressCount, required this.favoriteCount});

  final int progressCount;
  final int favoriteCount;
}

class _Block extends StatelessWidget {
  const _Block({
    required this.title,
    required this.subtitle,
    required this.child,
    super.key,
  });

  final String title;
  final String subtitle;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final p = StoryPalette.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: StoryTokens.s5),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  title,
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: p.ink),
                ),
              ),
              Text(subtitle, style: TextStyle(fontSize: 12, color: p.ink3)),
            ],
          ),
          const SizedBox(height: StoryTokens.s3),
          child,
        ],
      ),
    );
  }
}

class _StatCard extends StatelessWidget {
  const _StatCard({required this.value, required this.label});

  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    final p = StoryPalette.of(context);
    return PaperCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            value,
            style: TextStyle(fontSize: 26, fontWeight: FontWeight.w700, color: p.ink),
          ),
          const SizedBox(height: 2),
          Text(label, style: TextStyle(fontSize: 12, color: p.ink3)),
        ],
      ),
    );
  }
}
