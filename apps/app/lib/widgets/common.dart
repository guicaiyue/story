import 'package:flutter/material.dart';

import '../theme/layout.dart';
import '../theme/tokens.dart';

/// 页面外壳：纸感底 + 可选顶栏 + 内容区。
class StoryScaffold extends StatelessWidget {
  const StoryScaffold({
    required this.child,
    this.title,
    this.showBack = false,
    this.actions,
    this.padded = true,
    this.fullBleed = false,
    super.key,
  });

  final Widget child;
  final String? title;
  final bool showBack;
  final List<Widget>? actions;
  final bool padded;

  /// 全幅页面（主壳、播放器、启动页）：平板上也铺满，不做内容收窄。
  final bool fullBleed;

  @override
  Widget build(BuildContext context) {
    final p = StoryPalette.of(context);
    // 用 Material 而不是 Container 作为根：内部大量 InkWell / IconButton
    // 需要 Material 祖先，否则运行时会抛 "No Material widget found"。
    return Material(
      color: p.bg,
      child: SafeArea(
        child: Column(
          children: [
            if (title != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  StoryTokens.s4,
                  StoryTokens.s3,
                  StoryTokens.s4,
                  StoryTokens.s2,
                ),
                child: Row(
                  children: [
                    if (showBack)
                      SizedBox(
                        width: StoryTokens.touch,
                        height: StoryTokens.touch,
                        child: IconButton(
                          icon: const Icon(Icons.arrow_back),
                          color: p.ink,
                          tooltip: '返回',
                          onPressed: () => Navigator.of(context).maybePop(),
                        ),
                      ),
                    Expanded(
                      child: Text(
                        title!,
                        style: TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.w700,
                          color: p.ink,
                        ),
                      ),
                    ),
                    ...?actions,
                  ],
                ),
              ),
            Expanded(
              // 只有内容页收窄：全幅页面（播放器、主壳）在平板上应当铺满。
              // 一行字横跨 1280px 读起来很累，所以内容页居中到舒适阅读宽度。
              child: fullBleed
                  ? child
                  : Center(
                      child: ConstrainedBox(
                        constraints: BoxConstraints(
                          maxWidth: contentMaxWidthOf(layoutOf(context)),
                        ),
                        // padded 决定要不要外层留白；收窄与留白是两件事。
                        child: padded
                            ? Padding(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: StoryTokens.s4,
                                ),
                                child: child,
                              )
                            : child,
                      ),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

/// 纸卡：圆角 22、1px 描边、极浅阴影。
class PaperCard extends StatelessWidget {
  const PaperCard({
    required this.child,
    this.padding = const EdgeInsets.all(StoryTokens.s4),
    this.color,
    this.radius = StoryTokens.rLg,
    this.onTap,
    super.key,
  });

  final Widget child;
  final EdgeInsets padding;
  final Color? color;
  final double radius;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final p = StoryPalette.of(context);
    final card = Container(
      padding: padding,
      decoration: BoxDecoration(
        color: color ?? p.surf,
        borderRadius: BorderRadius.circular(radius),
        border: Border.all(color: p.line),
      ),
      child: child,
    );
    if (onTap == null) return card;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(radius),
        onTap: onTap,
        child: card,
      ),
    );
  }
}

/// 主按钮：儿童端高度 ≥64（设计稿 touch-kid）。
class PrimaryButton extends StatelessWidget {
  const PrimaryButton({
    required this.label,
    required this.onPressed,
    this.icon,
    this.height = StoryTokens.touchKid,
    this.expand = true,
    super.key,
  });

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final double height;
  final bool expand;

  @override
  Widget build(BuildContext context) {
    final p = StoryPalette.of(context);
    final button = SizedBox(
      height: height,
      child: FilledButton(
        onPressed: onPressed,
        style: FilledButton.styleFrom(
          backgroundColor: p.accent,
          foregroundColor: Colors.white,
          disabledBackgroundColor: p.track,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(StoryTokens.rMd)),
          textStyle: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            if (icon != null) ...[Icon(icon, size: 22), const SizedBox(width: StoryTokens.s2)],
            Text(label),
          ],
        ),
      ),
    );
    return expand ? SizedBox(width: double.infinity, child: button) : button;
  }
}

/// 次要按钮（描边）。
class GhostButton extends StatelessWidget {
  const GhostButton({
    required this.label,
    required this.onPressed,
    this.height = StoryTokens.touch,
    super.key,
  });

  final String label;
  final VoidCallback? onPressed;
  final double height;

  @override
  Widget build(BuildContext context) {
    final p = StoryPalette.of(context);
    return SizedBox(
      height: height,
      child: OutlinedButton(
        onPressed: onPressed,
        style: OutlinedButton.styleFrom(
          foregroundColor: p.ink,
          side: BorderSide(color: p.line),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(StoryTokens.rMd)),
        ),
        child: Text(label),
      ),
    );
  }
}

/// 轻量标签（年龄档等）。
class StoryChip extends StatelessWidget {
  const StoryChip({required this.label, this.selected = false, this.onTap, super.key});

  final String label;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final p = StoryPalette.of(context);
    return Material(
      color: selected ? p.accentSoft : p.surface2,
      borderRadius: BorderRadius.circular(StoryTokens.rSm),
      child: InkWell(
        borderRadius: BorderRadius.circular(StoryTokens.rSm),
        onTap: onTap,
        child: Container(
          constraints: const BoxConstraints(minHeight: StoryTokens.touch),
          padding: const EdgeInsets.symmetric(horizontal: StoryTokens.s4),
          alignment: Alignment.center,
          child: Text(
            label,
            style: TextStyle(
              color: selected ? p.accentInk : p.ink2,
              fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
            ),
          ),
        ),
      ),
    );
  }
}

/// 封面占位：M1 无封面资产（coverUrl 全空），用暖橙渐变 + 书名首字兜底。
class CoverArt extends StatelessWidget {
  const CoverArt({
    required this.title,
    this.size = 72,
    this.radius = StoryTokens.rMd,
    super.key,
  });

  final String title;
  final double size;
  final double radius;

  @override
  Widget build(BuildContext context) {
    final p = StoryPalette.of(context);
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [p.accentSoft, p.accent.withValues(alpha: 0.55)],
        ),
        borderRadius: BorderRadius.circular(radius),
        border: Border.all(color: p.line),
      ),
      alignment: Alignment.center,
      child: Text(
        title.isEmpty ? '书' : title.characters.first,
        style: TextStyle(
          fontSize: size * 0.34,
          fontWeight: FontWeight.w700,
          color: p.accentInk,
        ),
      ),
    );
  }
}

/// 空态。
class EmptyState extends StatelessWidget {
  const EmptyState({required this.message, this.icon = Icons.menu_book_outlined, super.key});

  final String message;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final p = StoryPalette.of(context);
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 44, color: p.ink3),
          const SizedBox(height: StoryTokens.s3),
          Text(
            message,
            textAlign: TextAlign.center,
            style: TextStyle(color: p.ink2, fontSize: 15),
          ),
        ],
      ),
    );
  }
}

/// 错误态：可读文案 + 重试（失败即流失，宁可重试也不白屏）。
class ErrorState extends StatelessWidget {
  const ErrorState({required this.message, this.onRetry, super.key});

  final String message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final p = StoryPalette.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(StoryTokens.s6),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.cloud_off_outlined, size: 44, color: p.ink3),
            const SizedBox(height: StoryTokens.s3),
            Text(
              message,
              textAlign: TextAlign.center,
              style: TextStyle(color: p.ink2, fontSize: 15),
            ),
            if (onRetry != null) ...[
              const SizedBox(height: StoryTokens.s5),
              SizedBox(
                width: 160,
                child: GhostButton(label: '重试', onPressed: onRetry),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// 加载态骨架。
class LoadingState extends StatelessWidget {
  const LoadingState({super.key});

  @override
  Widget build(BuildContext context) {
    final p = StoryPalette.of(context);
    return Center(child: CircularProgressIndicator(color: p.accent));
  }
}
