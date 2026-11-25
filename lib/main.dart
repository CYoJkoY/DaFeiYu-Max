// ignore_for_file: deprecated_member_use

import 'dart:async';
import 'dart:io';

import 'package:flutter_acrylic/flutter_acrylic.dart' as acrylic;
import 'package:material_ui/material_ui.dart';
import 'package:window_manager/legacy.dart' as wm;

import 'app/app_controller.dart';
import 'app/app_paths.dart';
import 'app/single_instance.dart';
import 'app/smoke_runner.dart';
import 'app/window_service.dart';
import 'core/version.dart';
import 'ui/panel_view.dart';
import 'ui/pet_view.dart';
import 'ui/theme.dart';

Future<void> main(List<String> args) async {
  WidgetsFlutterBinding.ensureInitialized();
  final smoke = args.contains('--smoke-test');
  if (smoke) {
    AppPaths.overrideUserData = await Directory.systemTemp.createTemp('dafeiyu-smoke-');
  }

  final single = SingleInstance();
  if (!await single.acquire()) {
    // Another copy owns the tray and the pet; it already received "show".
    exit(0);
  }

  await wm.windowManager.ensureInitialized();
  await wm.windowManager.setAsFrameless();
  // Both platforms draw their own caption buttons, so the OS ones stay hidden
  // even after the window is resized into panel mode.
  await wm.windowManager.setTitleBarStyle(
    wm.TitleBarStyle.hidden,
    windowButtonVisibility: false,
  );
  try {
    await acrylic.Window.initialize();
    await acrylic.Window.setEffect(
      effect: acrylic.WindowEffect.transparent,
      color: const Color(0x00000000),
    );
  } catch (_) {
    // Acrylic is a courtesy: a plain transparent window still renders.
  }

  final controller = AppController();
  await controller.initialize();

  runApp(DaFeiYuApp(controller: controller));

  await wm.windowManager.waitUntilReadyToShow(
    wm.WindowOptions(
      size: controller.petSize,
      center: false,
      backgroundColor: Colors.transparent,
      titleBarStyle: wm.TitleBarStyle.hidden,
      windowButtonVisibility: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      title: appName,
    ),
    () async {
      await controller.startWindow();
      single.listen(() => unawaited(controller.showPet()));
      await wm.windowManager.setPreventClose(true);
      wm.windowManager.addListener(controller);
      await wm.windowManager.show(inactive: true);
      if (smoke) {
        unawaited(SmokeRunner(controller).run());
      }
    },
  );
}

class DaFeiYuApp extends StatelessWidget {
  const DaFeiYuApp({required this.controller, super.key});

  final AppController controller;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: controller,
      builder: (context, _) {
        final panel = controller.mode == AppMode.panel;
        return MaterialApp(
          title: appName,
          debugShowCheckedModeBanner: false,
          theme: buildTheme(controller.accent),
          home: Scaffold(
            backgroundColor: panel ? Palette.panelBg : Colors.transparent,
            body: panel ? PanelView(controller: controller) : PetView(controller: controller),
          ),
        );
      },
    );
  }
}
