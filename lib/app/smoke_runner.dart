// ignore_for_file: deprecated_member_use

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/rendering.dart';
import 'package:material_ui/material_ui.dart';
import 'package:nativeapi/nativeapi.dart' as nativeapi;
import 'package:path/path.dart' as p;
import 'package:window_manager/legacy.dart' as wm;

import '../core/version.dart';
import 'app_controller.dart';
import 'app_paths.dart';

/// Drives the app through the same steps a person would take and writes the
/// evidence to [AppPaths.qa]. It never asserts silently: every step is recorded
/// with the wall clock and whatever the window reported at that moment, so the
/// numbers in the report can be checked against the screenshots.
class SmokeRunner {
  SmokeRunner(this.controller);

  final AppController controller;
  final DateTime _startedAt = DateTime.now();
  final List<Map<String, Object?>> _steps = [];

  Directory get _dir => AppPaths.qa;

  Future<void> run() async {
    try {
      await _dir.create(recursive: true);
      await _wait(const Duration(milliseconds: 1200));
      await _record('boot');
      await _writeDpi();

      await _wait(const Duration(milliseconds: 3500));
      controller.playAction('放烟花');
      await _record('action:放烟花');

      await _wait(const Duration(milliseconds: 11500));
      controller.playAction('凭空生花');
      await _record('action:凭空生花');
      await _wait(const Duration(milliseconds: 2500));
      await _shot(controller.petCaptureKey, 'pet.png');

      // `吃早餐` is the one upstream clip whose source video has no alpha
      // channel, so it is the best canary for a stage that would paint an
      // opaque rectangle behind the pet.
      controller.playAction('吃早餐');
      await _wait(const Duration(milliseconds: 2400));
      await _record('action:吃早餐');
      await _shot(controller.petCaptureKey, 'pet-meal.png');

      await _wait(const Duration(milliseconds: 5500));
      await controller.openPanel();
      await _record('panel:open');
      await _wait(const Duration(seconds: 4));
      await _shot(controller.panelCaptureKey, 'panel.png');

      await _writeChrome('window-chrome.json', maximized: false);
      await controller.toggleMaximize();
      await _wait(const Duration(milliseconds: 1400));
      await _record('panel:maximize');
      await _shot(controller.panelCaptureKey, 'panel-maximized.png');
      await controller.toggleMaximize();
      await _wait(const Duration(milliseconds: 1200));
      await _record('panel:restore');
      await _shot(controller.panelCaptureKey, 'panel-restored.png');
      await _writeChrome('window-chrome.json', maximized: false);
      await _writeSmoke();
    } catch (error, stack) {
      await _writeSmoke(error: '$error\n$stack');
    } finally {
      await controller.quit();
    }
  }

  Future<void> _wait(Duration duration) => Future<void>.delayed(duration);

  Future<void> _record(String step) async {
    final bounds = await _bounds();
    _steps.add({
      'step': step,
      'atMs': DateTime.now().difference(_startedAt).inMilliseconds,
      'mode': controller.mode.name,
      'visible': controller.petVisible,
      'activity': controller.activitySignature,
      'quotaLoading': controller.quotaLoading,
      'bounds': bounds,
    });
  }

  Future<Map<String, Object?>?> _bounds() async {
    try {
      final rect = await wm.windowManager.getBounds();
      return {
        'left': rect.left,
        'top': rect.top,
        'width': rect.width,
        'height': rect.height,
      };
    } catch (_) {
      return null;
    }
  }

  Future<void> _shot(GlobalKey key, String name) async {
    final boundary = key.currentContext?.findRenderObject();
    if (boundary is! RenderRepaintBoundary) {
      _steps.add({'step': 'capture:missing', 'target': name});
      return;
    }
    final image = await boundary.toImage(pixelRatio: 2);
    final logical = {'width': boundary.size.width, 'height': boundary.size.height};
    final pixels = {'width': image.width, 'height': image.height};
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    image.dispose();
    if (bytes == null) {
      _steps.add({'step': 'capture:empty', 'target': name});
      return;
    }
    final file = File(p.join(_dir.path, name));
    await file.writeAsBytes(bytes.buffer.asUint8List(), flush: true);
    _steps.add({
      'step': 'capture:$name',
      'bytes': await file.length(),
      'logical': logical,
      'pixels': pixels,
    });
  }

  Future<void> _writeDpi() async {
    final view = WidgetsBinding.instance.platformDispatcher.views.firstOrNull;
    final display = nativeapi.DisplayManager.instance.getPrimary();
    final cursor = nativeapi.DisplayManager.instance.getCursorPosition();
    final bounds = await _bounds();
    final payload = <String, Object?>{
      'devicePixelRatio': view?.devicePixelRatio,
      'logicalSize': view == null
          ? null
          : {
              'width': view.physicalSize.width / view.devicePixelRatio,
              'height': view.physicalSize.height / view.devicePixelRatio,
            },
      'displayScaleFactor': display?.scaleFactor,
      'workArea': display == null
          ? null
          : {
              'x': display.workArea.x,
              'y': display.workArea.y,
              'width': display.workArea.width,
              'height': display.workArea.height,
            },
      'cursor': {'x': cursor.x, 'y': cursor.y},
      'windowBounds': bounds,
      'windowSize': {
        'width': controller.petSize.width,
        'height': controller.petSize.height,
      },
    };
    await _writeJson('dpi.json', payload);
  }

  Future<void> _writeChrome(String name, {required bool maximized}) async {
    final payload = <String, Object?>{
      'frameless': true,
      'titleBarStyle': 'hidden',
      'windowButtonVisibility': false,
      'maximized': maximized,
      'isMaximized': await _safe(() => wm.windowManager.isMaximized()),
      'isResizable': await _safe(() => wm.windowManager.isResizable()),
      'isMinimizable': await _safe(() => wm.windowManager.isMinimizable()),
      'isMaximizable': await _safe(() => wm.windowManager.isMaximizable()),
      'isClosable': await _safe(() => wm.windowManager.isClosable()),
      'hasShadow': await _safe(() => wm.windowManager.hasShadow()),
      'titleBarHeight': await _safe(() => wm.windowManager.getTitleBarHeight()),
      'bounds': await _bounds(),
      'captionButtons': ['minimize', 'maximize', 'close'],
      'captionButtonsPaintedBy': 'flutter',
    };
    await _writeJson(name, payload);
  }

  Future<T?> _safe<T>(Future<T> Function() action) async {
    try {
      return await action();
    } catch (_) {
      return null;
    }
  }

  Future<void> _writeSmoke({String? error}) async {
    await _writeJson('smoke.json', {
      'app': appName,
      'version': appVersion,
      'platform': Platform.operatingSystem,
      'startedAt': _startedAt.toIso8601String(),
      'durationMs': DateTime.now().difference(_startedAt).inMilliseconds,
      'qaDir': _dir.path,
      'error': error,
      'steps': _steps,
    });
  }

  Future<void> _writeJson(String name, Map<String, Object?> payload) async {
    final file = File(p.join(_dir.path, name));
    await file.writeAsString(
      const JsonEncoder.withIndent('  ').convert(payload),
      flush: true,
    );
  }
}
