import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:story_app/services/player_service.dart';

/// JustAudioPlayerService 的降级路径测试。
///
/// 注意：测试进程里没有 just_audio 的平台实现，因此库内部会抛
/// MissingPluginException。这是**测试环境**特性（真机上插件存在，不会发生），
/// 但 Flutter 测试框架会把它当作未捕获异步错误上报，所以这里用
/// runZonedGuarded 把这层平台噪音收敛掉 —— 我们只验证自己的逻辑：
/// 拉流失败/超时时要退化为模拟播放，而不是把异常抛给页面。
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('拉流超时后降级为模拟播放（而不是永久挂起）', () async {
    await runZonedGuarded(() async {
      // 注入很短的超时，避免测试真的等 8 秒。
      final p = JustAudioPlayerService(loadTimeout: const Duration(milliseconds: 300));
      final sw = Stopwatch()..start();
      await p.load(
        storyId: 1,
        url: 'http://127.0.0.1:1/nope.mp3',
        duration: const Duration(seconds: 4),
      );
      sw.stop();

      // 关键：必须返回（超时后降级），不能无限等待。
      expect(sw.elapsed, lessThan(const Duration(seconds: 15)));
      // 接口给的时长仍然可用。
      expect(p.duration, const Duration(seconds: 4));
      // 降级后播放/暂停仍可用。
      await p.play();
      expect(p.isPlaying, isTrue);
      await p.pause();
      expect(p.isPlaying, isFalse);
      await p.dispose();
    }, (_, _) {});
  }, timeout: const Timeout(Duration(seconds: 60)));

  test('无 url 时直接进入模拟播放', () async {
    await runZonedGuarded(() async {
      final p = JustAudioPlayerService();
      await p.load(storyId: 1, url: null, duration: const Duration(seconds: 5));
      expect(p.duration, const Duration(seconds: 5));
      await p.play();
      expect(p.isPlaying, isTrue);
      await p.seek(const Duration(seconds: 3));
      expect(p.position, const Duration(seconds: 3));
      await p.dispose();
    }, (_, _) {});
  });

  test('模拟播放走到末尾会触发 completion', () async {
    await runZonedGuarded(() async {
      final p = JustAudioPlayerService();
      await p.load(storyId: 1, url: null, duration: const Duration(seconds: 2));
      final done = <void>[];
      final sub = p.completionStream.listen(done.add);
      await p.play();
      await Future<void>.delayed(const Duration(milliseconds: 2600));
      expect(done, isNotEmpty);
      expect(p.isPlaying, isFalse);
      await sub.cancel();
      await p.dispose();
    }, (_, _) {});
  }, timeout: const Timeout(Duration(seconds: 30)));
}
