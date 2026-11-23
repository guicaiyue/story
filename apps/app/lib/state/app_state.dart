import 'dart:async';

import 'package:flutter/foundation.dart';

import '../models/models.dart';
import '../services/api_client.dart';
import '../services/tonight_store.dart';

/// 家长门：算术题校验。
///
/// 按 00-research 原则 4「家长门必须存在」：退出儿童模式、改设置、进家长中心
/// 都要过门。题目是两位数以内的加法，避免学龄前儿童直接答对。
@immutable
class MathChallenge {
  const MathChallenge({required this.left, required this.right});

  final int left;
  final int right;

  int get answer => left + right;

  /// 展示文案。
  String get question => '$left + $right = ?';

  /// 用 [seed] 生成可复现的题目（测试用固定种子）。
  factory MathChallenge.generate({int? seed}) {
    final rnd = seed ?? DateTime.now().millisecondsSinceEpoch;
    // 11..29 + 11..29：两位数相加，超出幼儿心算范围。
    final left = 11 + (rnd % 19);
    final right = 11 + ((rnd ~/ 19) % 19);
    return MathChallenge(left: left, right: right);
  }

  /// 校验输入。非数字、空、错误都返回 false。
  bool verify(String input) {
    final trimmed = input.trim();
    if (trimmed.isEmpty) return false;
    final parsed = int.tryParse(trimmed);
    if (parsed == null) return false;
    return parsed == answer;
  }
}

/// 家长中心设置（对应 app.setting 表，02-architecture §3.3）。
@immutable
class ParentSettings {
  const ParentSettings({
    this.dailyLimitMin = 0,
    this.sleepTimerMin = 30,
    this.ageFilter = '3-6',
    this.parentGateEnabled = true,
  });

  final int dailyLimitMin;
  final int sleepTimerMin;
  final String ageFilter;
  final bool parentGateEnabled;

  ParentSettings copyWith({
    int? dailyLimitMin,
    int? sleepTimerMin,
    String? ageFilter,
    bool? parentGateEnabled,
  }) =>
      ParentSettings(
        dailyLimitMin: dailyLimitMin ?? this.dailyLimitMin,
        sleepTimerMin: sleepTimerMin ?? this.sleepTimerMin,
        ageFilter: ageFilter ?? this.ageFilter,
        parentGateEnabled: parentGateEnabled ?? this.parentGateEnabled,
      );

  /// 每日时长限制的展示文案；0 表示不限。
  String get dailyLimitLabel => dailyLimitMin == 0 ? '不限' : '$dailyLimitMin 分钟';

  String get sleepTimerLabel => sleepTimerMin == 0 ? '不自动停止' : '$sleepTimerMin 分钟';
}

/// 播放状态（供播放器页与「继续听」共享）。
@immutable
class PlaybackState {
  const PlaybackState({
    this.storyId,
    this.title,
    this.isPlaying = false,
    this.position = Duration.zero,
    this.duration = Duration.zero,
    this.sleepTimerRemaining,
    this.autoplayNext = true,
  });

  final int? storyId;
  final String? title;
  final bool isPlaying;
  final Duration position;
  final Duration duration;

  /// 定时停止的剩余时间；null 表示未开启。
  final Duration? sleepTimerRemaining;
  final bool autoplayNext;

  double get progress {
    if (duration.inSeconds <= 0) return 0;
    return (position.inSeconds / duration.inSeconds).clamp(0.0, 1.0);
  }

  PlaybackState copyWith({
    int? storyId,
    String? title,
    bool? isPlaying,
    Duration? position,
    Duration? duration,
    Duration? sleepTimerRemaining,
    bool clearSleepTimer = false,
    bool? autoplayNext,
  }) =>
      PlaybackState(
        storyId: storyId ?? this.storyId,
        title: title ?? this.title,
        isPlaying: isPlaying ?? this.isPlaying,
        position: position ?? this.position,
        duration: duration ?? this.duration,
        sleepTimerRemaining:
            clearSleepTimer ? null : (sleepTimerRemaining ?? this.sleepTimerRemaining),
        autoplayNext: autoplayNext ?? this.autoplayNext,
      );
}

/// 全局应用状态。
///
/// 刻意保持小而直接（任务要求「最小方案」）：只放跨页面共享的东西 ——
/// 夜间模式、家长设置、当前播放、收藏 id 集合、游客 token。
/// 页面各自的加载/错误状态由页面自己用 FutureBuilder 管理。
class AppState extends ChangeNotifier {
  AppState({required this.api});

  final ApiClient api;

  bool _isNight = false;
  bool get isNight => _isNight;

  ParentSettings _settings = const ParentSettings();
  ParentSettings get settings => _settings;

  PlaybackState _playback = const PlaybackState();
  PlaybackState get playback => _playback;

  final Set<int> _favoriteIds = {};
  Set<int> get favoriteIds => Set.unmodifiable(_favoriteIds);

  /// 家长中心里「本次会话已通过验证」，避免每次进页面都重答。
  bool _parentUnlocked = false;
  bool get parentUnlocked => _parentUnlocked;

  /// 「今晚的列表」：用户自己加进来的故事（本地持久化）。
  final List<Story> _tonight = [];
  List<Story> get tonight => List.unmodifiable(_tonight);

  final TonightStore _tonightStore = TonightStore();

  bool inTonight(int storyId) => _tonight.any((s) => s.id == storyId);

  /// 启动时读一次（失败就当空列表，不阻塞启动）。
  Future<void> loadTonight() async {
    final saved = await _tonightStore.load();
    if (saved.isEmpty) return;
    _tonight
      ..clear()
      ..addAll(saved);
    notifyListeners();
  }

  /// 重排后的整份列表直接落盘。
  ///
  /// 语义：用户一旦动手排序，这份顺序就是「他的」——原本来自推荐的条目也一并
  /// 收进他自己的列表里，否则下次进播放器又会被推荐顺序覆盖，排序等于白做。
  Future<void> setTonightOrder(List<Story> ordered) async {
    _tonight
      ..clear()
      ..addAll(ordered);
    notifyListeners();
    await _tonightStore.save(_tonight);
  }

  /// 加入 / 移出今晚的列表。返回操作后是否在列表里。
  Future<bool> toggleTonight(Story story) async {
    final wasIn = inTonight(story.id);
    if (wasIn) {
      _tonight.removeWhere((s) => s.id == story.id);
    } else {
      _tonight.add(story);
    }
    notifyListeners();
    await _tonightStore.save(_tonight);
    return !wasIn;
  }

  /// 本次会话听到的故事 id（「最近听过」）。
  final List<int> _recentIds = [];
  List<int> get recentIds => List.unmodifiable(_recentIds);

  void setNight(bool value) {
    if (_isNight == value) return;
    _isNight = value;
    notifyListeners();
  }

  /// 更新本地设置并**异步持久化**到服务端。
  ///
  /// 刻意不 await：UI 必须立即响应（改设置是家长操作，不能卡）。
  /// 失败时保留本地值、把错误记在 [settingsSyncError]，不弹窗打断 ——
  /// 下次改动会再试一次。这样离线改设置不会崩，也不会丢当前选择。
  void updateSettings(ParentSettings next) {
    final changed = next.dailyLimitMin != _settings.dailyLimitMin ||
        next.sleepTimerMin != _settings.sleepTimerMin ||
        next.ageFilter != _settings.ageFilter ||
        next.parentGateEnabled != _settings.parentGateEnabled;

    _settings = next;
    notifyListeners();

    if (changed) unawaited(_persistSettings());
  }

  /// 最近一次设置同步失败的原因；null 表示正常。
  String? settingsSyncError;

  /// 从服务端加载家长设置。启动时调用；失败保留默认值，不阻塞使用。
  Future<void> loadSettings() async {
    try {
      final remote = await api.getSettings();
      _settings = ParentSettings(
        dailyLimitMin: remote.dailyLimitMin,
        sleepTimerMin: remote.sleepTimerMin,
        ageFilter: remote.ageFilter,
        parentGateEnabled: remote.parentGate,
      );
      settingsSyncError = null;
      notifyListeners();
    } on ApiException catch (e) {
      // 拉不到就用默认值；家长仍可正常使用，只是设置未同步。
      settingsSyncError = e.message;
    }
  }

  // —— 账号信息（外部端「补充账号信息」）——

  /// 当前账号。null = 还没读到（启动第一帧，或注册还没完成）。
  AccountInfo? _account;
  AccountInfo? get account => _account;

  bool get isGuest => _account?.isGuest ?? true;

  /// 读当前账号。失败保留旧值 —— 账号信息是附加项，不能拦住启动。
  Future<void> loadAccount() async {
    try {
      _account = await api.me();
      notifyListeners();
    } on ApiException {
      // 静默：下次进账号页或重启会再读。
    }
  }

  /// 改昵称。返回错误文案；成功返回 null。
  Future<String?> updateNickname(String nickname) async {
    final trimmed = nickname.trim();
    if (trimmed.isEmpty) return '昵称不能为空';
    try {
      _account = await api.updateNickname(trimmed);
      notifyListeners();
      return null;
    } on ApiException catch (e) {
      return e.message;
    }
  }

  /// 给当前游客账号绑手机号。返回错误文案；成功返回 null。
  ///
  /// 绑定成功后 token 不变（同一个账号），所以进度与收藏都还在。
  Future<String?> bindPhone({required String phone, required String code}) async {
    try {
      _account = await api.bindPhone(phone: phone, code: code);
      notifyListeners();
      return null;
    } on ApiException catch (e) {
      return e.message;
    }
  }

  /// 手机号登录（换设备回到同一账号）。成功后重读设置与收藏。
  Future<String?> loginWithPhone({required String phone, required String code}) async {
    try {
      _account = await api.loginWithPhone(phone: phone, code: code);
      notifyListeners();
    } on ApiException catch (e) {
      return e.message;
    }
    // 换了账号，家长设置与收藏都要跟着换，否则界面上还是上一个账号的数据。
    await loadSettings();
    await syncFavorites();
    return null;
  }

  /// 用服务端收藏列表初始化本地集合。
  ///
  /// 缺了这一步，「收藏」心形在冷启动后永远是空心：本地集合从空开始，
  /// 用户点一下等于把服务端已有的收藏再加一遍（幂等，看起来像成功），
  /// 要点第二下才真的取消。
  Future<void> syncFavorites() async {
    try {
      final entries = await api.favorites();
      seedFavorites(entries.map((e) => e.storyId));
    } on ApiException {
      // 忽略：读不到就按未收藏显示，比抛错好。
    }
  }

  Future<void> _persistSettings() async {
    final patch = RemoteSettings(
      dailyLimitMin: _settings.dailyLimitMin,
      sleepTimerMin: _settings.sleepTimerMin,
      ageFilter: _settings.ageFilter,
      parentGate: _settings.parentGateEnabled,
    ).toJson();

    try {
      await api.putSettings(patch);
      settingsSyncError = null;
    } on ApiException catch (e) {
      settingsSyncError = e.message;
      // 不回滚本地值：用户看到的选择保持有效，避免「改了又跳回去」。
    }
  }

  void unlockParent() {
    _parentUnlocked = true;
    notifyListeners();
  }

  void lockParent() {
    _parentUnlocked = false;
    notifyListeners();
  }

  void startPlayback({required int storyId, required String title, Duration? duration}) {
    _playback = _playback.copyWith(
      storyId: storyId,
      title: title,
      duration: duration ?? const Duration(minutes: 3),
      position: Duration.zero,
      isPlaying: true,
    );
    // 最近听过 = 最近优先。重听同一故事要把它移到队首，否则列表会停在旧顺序。
    _recentIds
      ..remove(storyId)
      ..insert(0, storyId);
    if (_recentIds.length > 20) _recentIds.removeLast();
    notifyListeners();
  }

  void updatePlayback(PlaybackState next) {
    _playback = next;
    notifyListeners();
  }

  void setPosition(Duration position) {
    _playback = _playback.copyWith(position: position);
    notifyListeners();
  }

  void setPlaying(bool playing) {
    _playback = _playback.copyWith(isPlaying: playing);
    notifyListeners();
  }

  void setSleepTimer(Duration? remaining) {
    _playback = remaining == null
        ? _playback.copyWith(clearSleepTimer: true)
        : _playback.copyWith(sleepTimerRemaining: remaining);
    notifyListeners();
  }

  void toggleFavorite(int storyId) {
    if (_favoriteIds.contains(storyId)) {
      _favoriteIds.remove(storyId);
    } else {
      _favoriteIds.add(storyId);
    }
    notifyListeners();
  }

  bool isFavorite(int storyId) => _favoriteIds.contains(storyId);

  /// 用服务端返回的收藏列表初始化本地集合。
  void seedFavorites(Iterable<int> ids) {
    _favoriteIds
      ..clear()
      ..addAll(ids);
    notifyListeners();
  }
}
