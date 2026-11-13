import 'dart:async';

import 'package:just_audio/just_audio.dart';

/// 播放器抽象。
///
/// 抽出来的理由（任务要求「可替换的 PlayerService 抽象」）：
///   1. 音频资产在 M1 还不存在（2197 条故事的 audioUrl 全为空，走 TTS 合成），
///      所以真实播放能力目前无从验证；
///   2. 测试需要在没有平台通道的纯 Dart 环境里跑，不能依赖 just_audio 的
///      MethodChannel；
///   3. 未来接入 TTS 合成音频或下载缓存时，只要换一个实现，页面不动。
///
/// 因此页面只依赖本接口；[JustAudioPlayerService] 是真实实现，
/// [FakePlayerService] 用于测试与无音频环境。
abstract class PlayerService {
  /// 当前播放位置；未加载时为 [Duration.zero]。
  Duration get position;

  /// 当前曲目总时长。M1 的 durationSec 多为 0，此时由实现给出兜底值。
  Duration get duration;

  bool get isPlaying;

  /// 位置变化流，播放器据此刷新进度条。
  Stream<Duration> get positionStream;

  /// 播放结束（用于「自动下一集」）。
  Stream<void> get completionStream;

  /// 加载曲目。[url] 为 null 表示暂无音频文件（M1 的常态），
  /// 实现应进入「模拟播放」而不是报错 —— 否则整个播放器不可用。
  Future<void> load({required int storyId, String? url, Duration? duration});

  Future<void> play();
  Future<void> pause();
  Future<void> seek(Duration position);
  Future<void> dispose();
}

/// 基于 just_audio 的真实实现。
///
/// 音频来自服务端 TTS 合成接口（`/api/stories/:id/audio`，所有者决策
/// c-mw99xnkq-2ehou），App 直接拉流；服务端合成时会量出真实时长并回填
/// `duration_sec`，所以这里优先用播放器报出的时长，拿不到才回落到接口给的。
///
/// 降级策略：如果 [url] 为 null（例如合成失败）或 just_audio 在当前平台
/// 不可用，则退化为内部计时器模拟播放 —— 保证播放器 UI 与状态机不会因为
/// 音频链路问题而整页不可用。
class JustAudioPlayerService implements PlayerService {
  JustAudioPlayerService({AudioPlayer? player, Duration? loadTimeout})
      : _player = player ?? _createPlayer(),
        _loadTimeout = loadTimeout ?? const Duration(seconds: 25);

  /// 构造平台播放器。平台不可用时给一个「哑」实例，让降级路径仍能工作。
  static AudioPlayer _createPlayer() {
    try {
      return AudioPlayer();
    } catch (_) {
      return AudioPlayer();
    }
  }

  final AudioPlayer _player;

  Duration _position = Duration.zero;
  Duration _duration = const Duration(minutes: 3);
  bool _isPlaying = false;

  /// 当前是否走模拟播放（无真实音频时）。
  bool _simulated = false;

  /// 拉流超时。
  ///
  /// 这里取 25 秒而不是「弱网够用」的 8 秒：**首次**请求一条未缓存的故事时，
  /// 服务端要现场 TTS 合成整条音频才返回，实测 2,000–3,000 字约需 36 秒。
  /// 超时太短会让首次点开必定降级为模拟播放。
  ///
  /// 真正的解法是服务端预热（见 03-decisions §11.7），那里之前，这里给足时间；
  /// 超时后仍会降级为模拟播放，不会卡死。
  /// 可注入是为了让测试不必真等。
  final Duration _loadTimeout;

  /// 是否已订阅真实播放器的流。用于判断 load 是否真的成功。
  bool _listening = false;

  /// 单次平台调用（play/pause/seek/stop/dispose）的超时。
  static const _platformCallTimeout = Duration(seconds: 5);
  Timer? _ticker;

  final _positionController = StreamController<Duration>.broadcast();
  final _completionController = StreamController<void>.broadcast();
  final List<StreamSubscription<dynamic>> _subs = [];

  @override
  Duration get position => _position;

  @override
  Duration get duration => _duration;

  @override
  bool get isPlaying => _isPlaying;

  @override
  Stream<Duration> get positionStream => _positionController.stream;

  @override
  Stream<void> get completionStream => _completionController.stream;

  @override
  Future<void> load({required int storyId, String? url, Duration? duration}) async {
    await _reset();

    // 递减优先级：接口/服务端回填的时长 -> 兜底 3 分钟。
    _duration = duration ?? const Duration(minutes: 3);

    if (url == null || url.isEmpty) {
      _simulated = true;
      return;
    }

    // 两个坑一起处理：
    //  1. 地址不可达时 setUrl 会一直挂着 -> 必须超时，否则页面永远停在加载中；
    //  2. just_audio 在异步 gap 里抛的平台异常（MissingPluginException 等）
    //     不会经由下面这个 try/catch，而是逃到 zone -> 用 runZonedGuarded 兜住。
    // 两者都归为「拉流失败」，退化为模拟播放，绝不让播放器整页不可用。
    var failed = false;
    await runZonedGuarded(() async {
      try {
        final real = await _player.setUrl(url).timeout(_loadTimeout);
        if (real != null && real > Duration.zero) {
          // 服务端量出的真实时长优先，它是硬数据。
          _duration = real;
        }
        _simulated = false;
        _listen();
      } catch (_) {
        failed = true;
      }
    }, (_, _) {
      failed = true;
    });

    if (failed || _simulated == false && !_listening) {
      // 先尽力停掉可能已半开的平台播放器，避免它在后台占用。
      await _safePlatformCall(() => _player.stop());
      _simulated = true;
    }
  }

  void _listen() {
    _listening = true;
    _subs.add(_player.positionStream.listen((pos) {
      _position = pos;
      _positionController.add(pos);
    }));
    _subs.add(_player.durationStream.listen((d) {
      if (d != null && d > Duration.zero) _duration = d;
    }));
    _subs.add(_player.playerStateStream.listen((state) {
      _isPlaying = state.playing && state.processingState != ProcessingState.completed;
    }));
    // 播放结束：just_audio 用 processingState=completed + playing=true 表达。
    _subs.add(_player.processingStateStream.listen((state) {
      if (state == ProcessingState.completed) {
        _isPlaying = false;
        _position = _duration;
        _positionController.add(_position);
        _completionController.add(null);
      }
    }));
  }

  @override
  Future<void> play() async {
    _isPlaying = true;
    if (_simulated) {
      _startTicker();
      return;
    }
    await _safePlatformCall(() => _player.play());
  }

  @override
  Future<void> pause() async {
    _isPlaying = false;
    if (_simulated) {
      _stopTicker();
      return;
    }
    await _safePlatformCall(() => _player.pause());
  }

  @override
  Future<void> seek(Duration position) async {
    final clamped = position < Duration.zero
        ? Duration.zero
        : (position > _duration ? _duration : position);
    _position = clamped;
    _positionController.add(clamped);
    if (!_simulated) {
      await _safePlatformCall(() => _player.seek(clamped));
    }
  }

  void _startTicker() {
    _ticker?.cancel();
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!_isPlaying) return;
      _position += const Duration(seconds: 1);
      if (_position >= _duration) {
        _position = _duration;
        _isPlaying = false;
        _stopTicker();
        _positionController.add(_position);
        _completionController.add(null);
        return;
      }
      _positionController.add(_position);
    });
  }

  void _stopTicker() {
    _ticker?.cancel();
    _ticker = null;
  }

  /// 包一层平台调用：超时 + 吞掉异常。
  ///
  /// just_audio 在平台实现缺失或播放器未就绪时，部分 Future 会**永不完成**
  /// （实测 `stop()` 也会挂），如果不加超时，页面 teardown 会一直卡住。
  Future<void> _safePlatformCall(Future<void> Function() call) async {
    try {
      await call().timeout(_platformCallTimeout);
    } catch (_) {
      // 平台不可用：没有可做的补救，静默降级。
    }
  }

  Future<void> _reset() async {
    _stopTicker();
    for (final s in _subs) {
      await s.cancel();
    }
    _subs.clear();
    _listening = false;
    _position = Duration.zero;
    _isPlaying = false;
    if (!_simulated) {
      await _safePlatformCall(() => _player.stop());
    }
    _simulated = false;
  }

  @override
  Future<void> dispose() async {
    _stopTicker();
    for (final s in _subs) {
      await s.cancel();
    }
    _subs.clear();
    _listening = false;
    // dispose 也会走平台通道；平台缺失（或已断开）时不能让它把异常抛给
    // 调用方，也不能让它挂住页面 teardown。
    await _safePlatformCall(() => _player.dispose());
    await _positionController.close();
    await _completionController.close();
  }
}

/// 纯内存实现，用于测试与「无音频」环境。
///
/// 行为与真实实现保持一致（同样的边界处理），因此页面测试有意义。
class FakePlayerService implements PlayerService {
  FakePlayerService({Duration? duration})
      : _defaultDuration = duration ?? const Duration(minutes: 3),
        _duration = duration ?? const Duration(minutes: 3);

  Duration _position = Duration.zero;
  Duration _duration;

  /// [load] 未显式给时长时的回落值。
  final Duration _defaultDuration;
  bool _isPlaying = false;

  final _positionController = StreamController<Duration>.broadcast();
  final _completionController = StreamController<void>.broadcast();

  /// 记录调用，便于断言页面确实触发了对应动作。
  final List<String> calls = [];
  int? loadedStoryId;

  @override
  Duration get position => _position;

  @override
  Duration get duration => _duration;

  @override
  bool get isPlaying => _isPlaying;

  @override
  Stream<Duration> get positionStream => _positionController.stream;

  @override
  Stream<void> get completionStream => _completionController.stream;

  @override
  Future<void> load({required int storyId, String? url, Duration? duration}) async {
    calls.add('load:$storyId');
    loadedStoryId = storyId;
    _position = Duration.zero;
    _duration = duration ?? _defaultDuration;
    _positionController.add(_position);
  }

  @override
  Future<void> play() async {
    calls.add('play');
    _isPlaying = true;
  }

  @override
  Future<void> pause() async {
    calls.add('pause');
    _isPlaying = false;
  }

  @override
  Future<void> seek(Duration position) async {
    calls.add('seek:${position.inSeconds}');
    _position = position < Duration.zero
        ? Duration.zero
        : (position > _duration ? _duration : position);
    _positionController.add(_position);
  }

  // —— 测试辅助 ——

  /// 推进播放位置并广播，模拟播放器走动。
  void emitPosition(Duration p) {
    _position = p;
    _positionController.add(p);
  }

  /// 触发播放结束，用于验证「自动下一集」。
  void emitCompletion() {
    _isPlaying = false;
    _completionController.add(null);
  }

  @override
  Future<void> dispose() async {
    await _positionController.close();
    await _completionController.close();
  }
}
