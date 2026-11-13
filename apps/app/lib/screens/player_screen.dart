import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/models.dart';
import '../services/api_client.dart';
import '../services/player_service.dart';
import '../state/app_state.dart';
import '../theme/layout.dart';
import '../theme/tokens.dart';
import '../widgets/common.dart';

/// 播放器页。
///
/// 包含：进度、15 秒进退、定时停止、收藏、自动下一集。
/// 通过 `nightMode: true` 进入夜间配色（设计稿的 screen--night）。
///
/// 音频说明：M1 的 `story.audioUrl` 全为空（内容走 TTS 实时合成，见 00-research P4），
/// 因此 [PlayerService] 在无 URL 时进入模拟播放，UI 与状态机照常工作。
class PlayerScreen extends StatefulWidget {
  const PlayerScreen({required this.story, this.nightMode = false, super.key});

  final Story story;
  final bool nightMode;

  @override
  State<PlayerScreen> createState() => _PlayerScreenState();
}

class _PlayerScreenState extends State<PlayerScreen> {
  late final PlayerService _player;
  /// 在 initState 里缓存 —— dispose() 期间不能再用 context 查 Provider，
  /// 否则会抛 "Looking up a deactivated widget's ancestor is unsafe"。
  late final AppState _appState;
  late final ApiClient _api;
  StreamSubscription<Duration>? _posSub;
  StreamSubscription<void>? _doneSub;
  Timer? _sleepTicker;

  /// 播放队列（用于「自动下一集」）。M1 由同年龄档的推荐填充。
  List<Story> _queue = const [];

  /// 本次会话里被手动移出列表的故事。只作用于界面，不写盘：
  /// 队列本身每次进播放器都会按年龄档重新拉，记住「不想听哪个」没有持久价值。
  final Set<int> _removed = <int>{};

  /// 列表里实际展示的条目：先用户自己加进来的，再补同年龄档推荐，去重且去掉移出的。
  List<Story> get _visibleQueue {
    final seen = <int>{widget.story.id};
    final out = <Story>[];
    for (final item in [..._appState.tonight, ..._queue]) {
      if (_removed.contains(item.id) || !seen.add(item.id)) continue;
      out.add(item);
    }
    return out;
  }

  void _removeFromQueue(int storyId) {
    setState(() => _removed.add(storyId));
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('已移出今晚的列表')),
    );
  }

  @override
  void initState() {
    super.initState();
    _appState = context.read<AppState>();
    _api = _appState.api;
    _player = context.read<PlayerService>();
    _bind();
    _start();
    _loadQueue();
  }

  void _bind() {
    _posSub = _player.positionStream.listen((pos) {
      if (!mounted) return;
      _appState.setPosition(pos);
      // 进度上报：每 15 秒一次，避免逐秒打服务端。
      if (pos.inSeconds > 0 && pos.inSeconds % 15 == 0) {
        _reportProgress(pos.inSeconds);
      }
    });
    _doneSub = _player.completionStream.listen((_) {
      if (!mounted) return;
      _onCompleted();
    });
  }

  Future<void> _start() async {
    final state = _appState;
    final duration = widget.story.durationSec > 0
        ? Duration(seconds: widget.story.durationSec)
        : const Duration(minutes: 3);
    await _player.load(
      storyId: widget.story.id,
      url: widget.story.audioUrl,
      duration: duration,
    );
    await _player.play();
    if (!mounted) return;
    state.updatePlayback(
      state.playback.copyWith(
        storyId: widget.story.id,
        title: widget.story.title,
        duration: duration,
        isPlaying: true,
      ),
    );
    _reportPlay('start');
  }

  Future<void> _loadQueue() async {
    try {
      final page = await _api.stories(
            page: 1,
            pageSize: 6,
            ageBand: widget.story.ageBand,
          );
      if (!mounted) return;
      setState(() => _queue = page.items.where((s) => s.id != widget.story.id).toList());
    } on ApiException {
      // 队列拿不到不影响播放，静默降级。
    }
  }

  Future<void> _reportPlay(String event, [int positionSec = 0]) async {
    try {
      await _api.reportPlay(
            storyId: widget.story.id,
            event: event,
            positionSec: positionSec,
          );
    } on ApiException {
      // 埋点失败不打断播放（07 原则：失败即流失）。
    }
  }

  Future<void> _reportProgress(int positionSec) async {
    try {
      await _api.saveProgress(widget.story.id, positionSec);
    } on ApiException {
      // 同上，静默。
    }
  }

  /// 播放结束：自动下一集（可在播放器上开关）。
  Future<void> _onCompleted() async {
    final state = _appState;
    await _reportPlay('complete', _player.duration.inSeconds);
    if (!mounted) return;
    state.setPlaying(false);

    if (!state.playback.autoplayNext || _visibleQueue.isEmpty) return;

    final next = _visibleQueue.first;
    setState(() => _queue = _queue.where((s) => s.id != next.id).toList());
    await _playStory(next, announce: '自动播放下一集：${next.title}');
  }

  /// 切到某一集并开始播放（自动续播与点列表共用这一条路）。
  Future<void> _playStory(Story next, {String? announce}) async {
    final state = _appState;
    final duration = next.durationSec > 0
        ? Duration(seconds: next.durationSec)
        : const Duration(minutes: 3);
    state.startPlayback(storyId: next.id, title: next.title, duration: duration);
    await _player.load(storyId: next.id, url: next.audioUrl, duration: duration);
    await _player.play();
    if (!mounted || announce == null) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(announce)));
  }

  Future<void> _togglePlay() async {
    final state = _appState;
    if (_player.isPlaying) {
      await _player.pause();
      await _reportPlay('pause', _player.position.inSeconds);
      if (mounted) state.setPlaying(false);
    } else {
      await _player.play();
      if (mounted) state.setPlaying(true);
    }
  }

  Future<void> _seekBy(int seconds) async {
    final target = _player.position + Duration(seconds: seconds);
    await _player.seek(target < Duration.zero ? Duration.zero : target);
  }

  /// 定时停止：15 / 30 / 45 分钟 / 听完这集。
  Future<void> _pickSleepTimer() async {
    final state = _appState;
    final picked = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: StoryPalette.of(context).surf,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(StoryTokens.rXl)),
      ),
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Padding(
              padding: EdgeInsets.all(StoryTokens.s4),
              child: Text('定时停止', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
            ),
            for (final (label, value) in const [
              ('15 分钟', '15'),
              ('30 分钟', '30'),
              ('45 分钟', '45'),
              ('听完这集', 'end'),
              ('关闭定时', 'off'),
            ])
              ListTile(
                title: Text(label),
                onTap: () => Navigator.of(context).pop(value),
              ),
          ],
        ),
      ),
    );

    if (picked == null || !mounted) return;
    _sleepTicker?.cancel();

    if (picked == 'off') {
      state.setSleepTimer(null);
      return;
    }
    if (picked == 'end') {
      // 「听完这集」= 用当前曲目剩余时间作为定时。
      final remaining = _player.duration - _player.position;
      state.setSleepTimer(remaining);
      _startSleepCountdown(remaining);
      return;
    }

    final minutes = int.parse(picked);
    final remaining = Duration(minutes: minutes);
    state.setSleepTimer(remaining);
    _startSleepCountdown(remaining);
  }

  void _startSleepCountdown(Duration total) {
    var left = total;
    _sleepTicker = Timer.periodic(const Duration(seconds: 1), (t) {
      left -= const Duration(seconds: 1);
      if (!mounted) {
        t.cancel();
        return;
      }
      if (left <= Duration.zero) {
        t.cancel();
        _player.pause();
        _appState
          ..setPlaying(false)
          ..setSleepTimer(null);
        _reportPlay('stop', _player.position.inSeconds);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('定时结束，已停止播放')),
        );
        return;
      }
      _appState.setSleepTimer(left);
    });
  }

  Future<void> _toggleFavorite() async {
    final state = _appState;
    final isFav = state.isFavorite(widget.story.id);
    state.toggleFavorite(widget.story.id);
    try {
      if (isFav) {
        await state.api.removeFavorite(widget.story.id);
      } else {
        await state.api.addFavorite(widget.story.id);
      }
    } on ApiException catch (e) {
      state.toggleFavorite(widget.story.id);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  void dispose() {
    _posSub?.cancel();
    _doneSub?.cancel();
    _sleepTicker?.cancel();
    // 退出播放器时上报一次 stop。这里刻意不 await、也不碰 context：
    // dispose 期间 widget 已 deactivate，查 Provider 会抛异常。
    final pausedAt = _player.position.inSeconds;
    unawaited(_api
        .reportPlay(storyId: widget.story.id, event: 'stop', positionSec: pausedAt)
        .catchError((_) {}));
    _player.dispose();
    super.dispose();
  }

  String _fmt(Duration d) {
    final m = d.inMinutes.remainder(60).toString().padLeft(2, '0');
    final s = d.inSeconds.remainder(60).toString().padLeft(2, '0');
    return '$m:$s';
  }


  /// 播放列表（平板上常驻左栏）。
  ///
  /// 可拖动排序：一旦动手，整份顺序落盘成「用户自己的列表」（见 `setTonightOrder`），
  /// 否则下次进来又被推荐顺序覆盖，排序等于白做。
  Widget _queuePane(StoryPalette p) {
    final state = _appState;
    final currentId = state.playback.storyId ?? widget.story.id;
    final items = _visibleQueue;
    return PaperCard(
      key: const Key('player-playlist'),
      color: p.surface2,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              Icon(Icons.queue_music, size: 18, color: p.ink2),
              const SizedBox(width: StoryTokens.s2),
              Text(
                '今晚的列表 · ${items.length + 1} 个',
                style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: p.ink2),
              ),
              const Spacer(),
              Text('↑↓ 调整顺序', style: TextStyle(fontSize: 11, color: p.ink3)),
            ],
          ),
          const SizedBox(height: StoryTokens.s3),
          _queueRow(p, widget.story, currentId),
          if (items.isEmpty)
            Padding(
              padding: const EdgeInsets.only(top: StoryTokens.s2),
              child: Text(
                '同年龄档暂时没有更多故事',
                style: TextStyle(fontSize: 12, color: p.ink3),
              ),
            )
          else
            for (var i = 0; i < items.length; i++)
              _queueRow(p, items[i], currentId, index: i, total: items.length),
        ],
      ),
    );
  }

  /// 列表里上移/下移一位。
  ///
  /// 为什么是箭头不是拖动：这个 App 的主用户是孩子和妈妈，平板上拖动一行小字
  /// 既不准也别扭；上下箭头 44px 触控区，稳、好点，对读屏软件也友好。
  void _moveInQueue(int index, int delta) {
    final items = _visibleQueue;
    final target = index + delta;
    if (index < 0 || index >= items.length || target < 0 || target >= items.length) return;
    final moved = items.removeAt(index);
    items.insert(target, moved);
    // 正在播的那一集固定在顶部，不参与排序；落盘时要保住它。
    final currentId = _appState.playback.storyId ?? widget.story.id;
    final pinned = _appState.tonight.where((s) => s.id == currentId).toList();
    unawaited(_appState.setTonightOrder([...pinned, ...items]));
    setState(() {});
  }

  Widget _queueRow(StoryPalette p, Story item, int currentId, {int? index, int? total}) {
    final on = item.id == currentId;
    return Semantics(
      selected: on,
      button: true,
      label: '播放 ${item.title}',
      child: InkWell(
        borderRadius: BorderRadius.circular(StoryTokens.rSm),
        onTap: on
            ? null
            : () async {
                setState(() => _queue = _queue.where((s) => s.id != item.id).toList());
                await _playStory(item);
              },
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: StoryTokens.s1),
          child: Row(
            children: [
              SizedBox(
                width: 20,
                child: Icon(
                  on ? Icons.graphic_eq : Icons.play_arrow_outlined,
                  size: 16,
                  color: on ? p.accentInk : p.ink3,
                ),
              ),
              const SizedBox(width: StoryTokens.s2),
              Expanded(
                child: Text(
                  item.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 13,
                    color: on ? p.accentInk : p.ink,
                    fontWeight: on ? FontWeight.w600 : FontWeight.w400,
                  ),
                ),
              ),
              if (item.durationSec > 0)
                Text(
                  _fmt(Duration(seconds: item.durationSec)),
                  style: TextStyle(fontSize: 11, color: p.ink3),
                ),
              if (index != null && total != null) ...[
                IconButton(
                  key: Key('queue-up-${item.id}'),
                  icon: Icon(Icons.keyboard_arrow_up, size: 17, color: p.ink3),
                  tooltip: '上移',
                  visualDensity: VisualDensity.compact,
                  constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                  padding: EdgeInsets.zero,
                  onPressed: index == 0 ? null : () => _moveInQueue(index, -1),
                ),
                IconButton(
                  key: Key('queue-down-${item.id}'),
                  icon: Icon(Icons.keyboard_arrow_down, size: 17, color: p.ink3),
                  tooltip: '下移',
                  visualDensity: VisualDensity.compact,
                  constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                  padding: EdgeInsets.zero,
                  onPressed: index == total - 1 ? null : () => _moveInQueue(index, 1),
                ),
              ],
              if (!on)
                IconButton(
                  key: Key('queue-remove-${item.id}'),
                  icon: Icon(Icons.close, size: 15, color: p.ink3),
                  tooltip: '移出今晚的列表',
                  visualDensity: VisualDensity.compact,
                  constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                  padding: EdgeInsets.zero,
                  onPressed: () => _removeFromQueue(item.id),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _coverPane(StoryPalette p, String title) {
    return Column(
      children: [

        CoverArt(title: title, size: 200, radius: StoryTokens.rXl),
        const SizedBox(height: StoryTokens.s6),
        Text(
          title,
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: 22,
            height: 1.35,
            fontWeight: FontWeight.w700,
            color: p.ink,
          ),
        ),
        const SizedBox(height: StoryTokens.s2),
        Text(
          '${widget.story.ageBand} 岁 · ${widget.story.categoryName ?? '故事'}',
          style: TextStyle(fontSize: 13, color: p.ink2),
        ),
      ],
    );
  }

  Widget _controlPane(
    StoryPalette p,
    AppState state,
    PlaybackState playback,
    bool isFav,
  ) {
    return Column(
      children: [
const SizedBox(height: StoryTokens.s6),
        
        // 进度条
        SliderTheme(
          data: SliderTheme.of(context).copyWith(
            trackHeight: 5,
            activeTrackColor: p.accent,
            inactiveTrackColor: p.track,
            thumbColor: p.accent,
            overlayShape: const RoundSliderOverlayShape(overlayRadius: 14),
          ),
          child: Slider(
            value: playback.progress,
            onChanged: (v) => _player.seek(
              Duration(seconds: (playback.duration.inSeconds * v).round()),
            ),
          ),
        ),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(_fmt(playback.position),
                style: TextStyle(fontSize: 12, color: p.ink3)),
            Text(_fmt(playback.duration),
                style: TextStyle(fontSize: 12, color: p.ink3)),
          ],
        ),
        const SizedBox(height: StoryTokens.s4),
        
        // 控制区
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            _CircleButton(
              icon: Icons.rotate_left,
              overlay: '15',
              label: '后退 15 秒',
              size: 52,
              palette: p,
              onTap: () => _seekBy(-15),
            ),
            const SizedBox(width: StoryTokens.s5),
            _CircleButton(
              icon: playback.isPlaying
                  ? Icons.pause_rounded
                  : Icons.play_arrow_rounded,
              label: playback.isPlaying ? '暂停' : '播放',
              size: 76,
              primary: true,
              palette: p,
              onTap: _togglePlay,
            ),
            const SizedBox(width: StoryTokens.s5),
            _CircleButton(
              icon: Icons.rotate_right,
              overlay: '15',
              label: '前进 15 秒',
              size: 52,
              palette: p,
              onTap: () => _seekBy(15),
            ),
          ],
        ),
        const SizedBox(height: StoryTokens.s5),
        
        // 定时 + 收藏
        Row(
          children: [
            Expanded(
              child: _InfoTile(
                icon: Icons.timer_outlined,
                title: '定时停止',
                value: playback.sleepTimerRemaining == null
                    ? '未开启'
                    : _fmt(playback.sleepTimerRemaining!),
                palette: p,
                onTap: _pickSleepTimer,
              ),
            ),
            const SizedBox(width: StoryTokens.s3),
            Expanded(
              child: _InfoTile(
                icon: isFav ? Icons.favorite : Icons.favorite_border,
                title: '收藏',
                value: isFav ? '已收藏' : '未收藏',
                palette: p,
                onTap: _toggleFavorite,
              ),
            ),
          ],
        ),
        const SizedBox(height: StoryTokens.s3),
        
        // 自动下一集
        PaperCard(
          color: p.surface2,
          padding: const EdgeInsets.symmetric(
            horizontal: StoryTokens.s4,
            vertical: StoryTokens.s2,
          ),
          child: Row(
            children: [
              Icon(Icons.skip_next_outlined, size: 20, color: p.ink2),
              const SizedBox(width: StoryTokens.s3),
              Expanded(
                child: Text(
                  '自动下一集',
                  style: TextStyle(fontSize: 14, color: p.ink),
                ),
              ),
              Switch(
                value: playback.autoplayNext,
                activeThumbColor: p.accent,
                onChanged: (v) => state.updatePlayback(
                  playback.copyWith(autoplayNext: v),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: StoryTokens.s7),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final base = StoryPalette.of(context);
    // 夜间播放器：使用夜间配色，而不是修改全局夜间开关。
    final p = widget.nightMode ? StoryPalette.night : base;
    final state = context.watch<AppState>();
    final playback = state.playback;

    // 「自动下一集」时标题显示下一首，保持页面与状态一致。
    final title = playback.title ?? widget.story.title;
    final isFav = state.isFavorite(playback.storyId ?? widget.story.id);

    return StoryPaletteScope(
      palette: p,
      child: Material(
        color: p.bg,
        child: SafeArea(
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: StoryTokens.s3,
                  vertical: StoryTokens.s2,
                ),
                child: Row(
                  children: [
                    SizedBox(
                      width: StoryTokens.touch,
                      height: StoryTokens.touch,
                      child: IconButton(
                        icon: Icon(Icons.keyboard_arrow_down, color: p.ink, size: 30),
                        tooltip: '收起',
                        onPressed: () => Navigator.of(context).maybePop(),
                      ),
                    ),
                    Expanded(
                      child: Text(
                        '正在播放',
                        textAlign: TextAlign.center,
                        style: TextStyle(fontSize: 13, color: p.ink2),
                      ),
                    ),
                    SizedBox(
                      width: StoryTokens.touch,
                      height: StoryTokens.touch,
                      child: IconButton(
                        icon: Icon(
                          state.isNight ? Icons.light_mode_outlined : Icons.dark_mode_outlined,
                          color: p.ink2,
                        ),
                        tooltip: state.isNight ? '切换日间' : '切换夜间',
                        onPressed: () => state.setNight(!state.isNight),
                      ),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.symmetric(horizontal: StoryTokens.s6),
                  child: usesSideNav(layoutOf(context))
                      // 平板/桌面：左封面右控制。竖着排时封面占满一屏，控制要滚很久才看得到。
                      ? Row(
                          key: const Key('player-wide'),
                          crossAxisAlignment: CrossAxisAlignment.center,
                          children: [
                            Expanded(
                              flex: 4,
                              child: Column(
                                children: [
                                  _coverPane(p, title),
                                  const SizedBox(height: StoryTokens.s5),
                                  _queuePane(p),
                                ],
                              ),
                            ),
                            const SizedBox(width: StoryTokens.s7),
                            Expanded(
                              flex: 5,
                              child: _controlPane(p, state, playback, isFav),
                            ),
                          ],
                        )
                      : Column(
                          key: const Key('player-narrow'),
                          children: [
                            _coverPane(p, title),
                            const SizedBox(height: StoryTokens.s6),
                            _controlPane(p, state, playback, isFav),
                          ],
                        ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _CircleButton extends StatelessWidget {
  const _CircleButton({
    required this.icon,
    required this.label,
    required this.size,
    required this.palette,
    required this.onTap,
    this.overlay,
    this.primary = false,
  });

  final IconData icon;
  final String label;
  final double size;
  final StoryPalette palette;
  final VoidCallback onTap;

  /// 叠在图标的数字（例如 15）。Material 只有 *_10 图标，
  /// 直接用会让图标写着 10 而行为是 15 秒 —— 必须自己叠字。
  final String? overlay;
  final bool primary;

  @override
  Widget build(BuildContext context) {
    final p = palette;
    return Semantics(
      button: true,
      label: label,
      child: SizedBox(
        width: size,
        height: size,
        child: Material(
          color: primary ? p.accent : p.surface2,
          shape: const CircleBorder(),
          child: InkWell(
            customBorder: const CircleBorder(),
            onTap: onTap,
            child: Stack(
              alignment: Alignment.center,
              children: [
                Icon(
                  icon,
                  size: primary ? 40 : 30,
                  color: primary ? Colors.white : p.ink,
                ),
                if (overlay != null)
                  // 叠字只用于视觉，避免污染语义标签
                  // （否则读屏会念成「前进 15 秒 15」）。
                  ExcludeSemantics(
                    child: Padding(
                      padding: const EdgeInsets.only(top: 1),
                      child: Text(
                        overlay!,
                        style: TextStyle(
                          fontSize: primary ? 12 : 9.5,
                          fontWeight: FontWeight.w700,
                          height: 1,
                          color: primary ? Colors.white : p.ink,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _InfoTile extends StatelessWidget {
  const _InfoTile({
    required this.icon,
    required this.title,
    required this.value,
    required this.palette,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String value;
  final StoryPalette palette;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = palette;
    return PaperCard(
      padding: const EdgeInsets.symmetric(horizontal: StoryTokens.s3, vertical: StoryTokens.s3),
      onTap: onTap,
      color: p.surface2,
      child: Row(
        children: [
          Icon(icon, size: 20, color: p.accentInk),
          const SizedBox(width: StoryTokens.s2),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: TextStyle(fontSize: 11, color: p.ink3)),
                Text(
                  value,
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: p.ink,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
