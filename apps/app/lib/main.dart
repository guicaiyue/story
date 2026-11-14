import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'screens/launch_screen.dart';
import 'screens/main_shell.dart';
import 'services/api_client.dart';
import 'services/player_service.dart';
import 'state/app_state.dart';
import 'theme/tokens.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const StoryNookApp());
}

/// 应用根。
///
/// 依赖注入点：ApiClient 与 PlayerService 都在这里创建并挂到 Provider 上，
/// 测试可以注入替身（fake）而不触碰真实网络与音频。
class StoryNookApp extends StatelessWidget {
  const StoryNookApp({this.api, this.playerService, super.key});

  /// 测试可注入。
  final ApiClient? api;
  final PlayerService? playerService;

  @override
  Widget build(BuildContext context) {
    final client = api ?? ApiClient();
    return MultiProvider(
      providers: [
        ChangeNotifierProvider<AppState>(
          create: (_) => AppState(api: client)..loadTonight(),
        ),
        Provider<PlayerService>(
          create: (_) => playerService ?? JustAudioPlayerService(),
          dispose: (_, service) => service.dispose(),
        ),
      ],
      child: Consumer<AppState>(
        builder: (context, state, _) {
          final palette = state.isNight ? StoryPalette.night : StoryPalette.day;
          return StoryPaletteScope(
            palette: palette,
            child: MaterialApp(
              title: '小故事铺',
              debugShowCheckedModeBanner: false,
              theme: _buildTheme(palette),
              home: const _Root(),
            ),
          );
        },
      ),
    );
  }

  /// 把设计令牌映射到 Material 3 主题。
  static ThemeData _buildTheme(StoryPalette p) {
    final scheme = ColorScheme.fromSeed(
      seedColor: p.accent,
      brightness: p.isNight ? Brightness.dark : Brightness.light,
    ).copyWith(
      surface: p.bg,
      primary: p.accent,
      onPrimary: Colors.white,
      onSurface: p.ink,
    );

    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: p.bg,
      textTheme: Typography.material2021().black.apply(
            bodyColor: p.ink,
            displayColor: p.ink,
          ),
      appBarTheme: AppBarTheme(
        backgroundColor: p.bg,
        foregroundColor: p.ink,
        elevation: 0,
        centerTitle: false,
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: p.surf,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(StoryTokens.rLg),
        ),
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: p.deep,
        contentTextStyle: TextStyle(color: p.onDeep),
        behavior: SnackBarBehavior.floating,
      ),
      bottomSheetTheme: const BottomSheetThemeData(
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(StoryTokens.rXl)),
        ),
      ),
    );
  }
}

/// 首屏：启动页 → 主壳。
class _Root extends StatefulWidget {
  const _Root();

  @override
  State<_Root> createState() => _RootState();
}

class _RootState extends State<_Root> {
  bool _launched = false;

  @override
  void initState() {
    super.initState();
    // 03-decisions D6：启动即注册。**不 await**，所以注册失败/很慢都不会
    // 卡住启动页；下一步的 401 兜底还会再补一次。
    //
    // 注册完成后紧接着读家长设置：孩子的年龄档（ageFilter）存在服务端，
    // 首页要拿它去过滤内容。之前这里只注册、不读设置，于是 settings 永远
    // 停在默认的 3-6，家长改成 6-9/9+ 也不会生效。串行执行是因为
    // GET /api/settings 需要先有 token（否则 401）。
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      if (!mounted) return;
      final state = context.read<AppState>();
      await state.api.ensureRegistered();
      if (!mounted) return;
      await state.loadSettings();
    });
  }

  @override
  Widget build(BuildContext context) {
    if (!_launched) {
      return LaunchScreen(onFinished: () => setState(() => _launched = true));
    }
    return const MainShell();
  }
}
