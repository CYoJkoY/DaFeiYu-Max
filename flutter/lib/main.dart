import 'package:flutter/material.dart';
import 'package:window_manager/legacy.dart' as wm;
import 'package:flutter_acrylic/flutter_acrylic.dart' as acrylic;

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await acrylic.Window.initialize();
  await wm.windowManager.ensureInitialized();

  final windowOptions = const wm.WindowOptions(
    size: Size(460, 680),
    minimumSize: Size(400, 540),
    center: true,
    backgroundColor: Colors.transparent,
    skipTaskbar: false,
    titleBarStyle: wm.TitleBarStyle.hidden,
  );

  wm.windowManager.waitUntilReadyToShow(windowOptions, () async {
    await wm.windowManager.setAsFrameless();
    await acrylic.Window.setEffect(effect: acrylic.WindowEffect.transparent);
    await wm.windowManager.show();
    await wm.windowManager.focus();
  });

  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: '蓝色大肥鱼',
      theme: ThemeData(primarySwatch: Colors.blue),
      home: const Scaffold(
        backgroundColor: Colors.transparent,
        body: Center(
          child: Text(
            '🐋 蓝色大肥鱼正在启动...',
            style: TextStyle(color: Colors.white, fontSize: 20),
          ),
        ),
      ),
    );
  }
}