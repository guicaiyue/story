// 默认模板测试已替换为真实用例（见 test/ 下的各分组测试）。
// 这里只做一次最小冒烟，保证 `flutter test` 在没有任何注入时也能启动 App。
import 'package:flutter_test/flutter_test.dart';
import 'package:story_app/main.dart';

void main() {
  testWidgets('App 能启动并显示启动页品牌名', (tester) async {
    await tester.pumpWidget(const StoryNookApp());
    await tester.pump();
    expect(find.text('小故事铺'), findsOneWidget);
    expect(find.text('给中国家庭的睡前 20 分钟'), findsOneWidget);
    // 收尾定时器，避免 pending timer 报错。
    await tester.pump(const Duration(seconds: 2));
  });
}
