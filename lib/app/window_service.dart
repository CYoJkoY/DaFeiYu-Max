// ignore_for_file: deprecated_member_use

import 'dart:async';
import 'dart:math' as math;

import 'dart:ui' as ui;

import 'package:flutter/services.dart';
import 'package:nativeapi/nativeapi.dart' as nativeapi;
import 'package:window_manager/legacy.dart' as wm;

import '../core/position.dart';
import '../core/settings.dart';
import '../core/types.dart';

enum AppMode { pet, panel }

abstract class WindowDelegate {
  PetSettings get settings;
  String get hitTestClip;
  void onMomentumStopped();
}

class _HitTester {
  String? _clip;
  int? _width;
  int? _height;
  Uint8List? _pixels;

  Future<bool> hitTest(String clip, double normalizedX, double normalizedY) async {
    if (normalizedX < 0 || normalizedX >= 1 || normalizedY < 0 || normalizedY >= 1) return false;
    if (_clip != clip || _pixels == null) await _load(clip);
    final pixels = _pixels;
    if (pixels == null || _width == null || _height == null) return true;
    final x = (normalizedX * _width!).floor().clamp(0, _width! - 1);
    final y = (normalizedY * _height!).floor().clamp(0, _height! - 1);
    final alpha = pixels[(y * _width! + x) * 4 + 3];
    return alpha > 20;
  }

  Future<void> _load(String clip) async {
    try {
      final bytes = await rootBundle.load('assets/pet/$clip.webp');
      final codec = await ui.instantiateImageCodec(bytes.buffer.asUint8List());
      final frame = await codec.getNextFrame();
      final byteData = await frame.image.toByteData(format: ui.ImageByteFormat.rawRgba);
      _clip = clip;
      _width = frame.image.width;
      _height = frame.image.height;
      _pixels = byteData?.buffer.asUint8List();
      codec.dispose();
      frame.image.dispose();
    } catch (_) {
      _clip = clip;
      _pixels = null;
    }
  }
}

class WindowService {
  WindowService({required this.delegate});

  final WindowDelegate delegate;
  AppMode mode = AppMode.pet;
  bool maximized = false;
  bool _interactive = false;
  Timer? _moveTimer;
  Timer? _hitTimer;
  _DragState? _drag;
  _Momentum? _momentum;
  final _HitTester _hitTester = _HitTester();

  Size petSize(PetSettings settings) {
    final height = (settings.size * 9 / 16).round() + 112;
    return Size(settings.size.toDouble(), height.toDouble());
  }

  Future<nativeapi.Rectangle?> workAreaAround(Offset point) async {
    final displays = nativeapi.DisplayManager.instance.getAll();
    nativeapi.Rectangle? best;
    var bestDistance = double.infinity;
    for (final display in displays) {
      final area = display.workArea;
      final center = Offset(area.x + area.width / 2, area.y + area.height / 2);
      final distance = (center - point).distance;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = area;
      }
    }
    return best ?? nativeapi.DisplayManager.instance.getPrimary()?.workArea;
  }

  Future<Offset> clampPet(Offset position) async {
    final settings = delegate.settings;
    final size = petSize(settings);
    final area = await workAreaAround(Offset(position.dx + size.width / 2, position.dy + size.height / 2));
    if (area == null) return position;
    final clamped = clampPetPosition(
      PetPoint(x: position.dx, y: position.dy),
      PetRect(x: area.x, y: area.y, width: area.width, height: area.height),
      PetDimensions(width: size.width, height: size.height),
    );
    return Offset(clamped.x, clamped.y);
  }

  Future<Offset> defaultPetPosition() async {
    final size = petSize(delegate.settings);
    final area = nativeapi.DisplayManager.instance.getPrimary()?.workArea;
    if (area == null) return const Offset(24, 24);
    return clampPet(Offset(
      area.x + area.width - size.width - 20,
      area.y + area.height - size.height - 12,
    ));
  }

  /// Grows or shrinks the pet window so the dock always fits, the same way the
  /// Electron build resized itself from `dock.offsetTop + dock.offsetHeight + 8`.
  Future<void> resizePetHeight(double height) async {
    if (mode != AppMode.pet) return;
    final bounds = await wm.windowManager.getBounds();
    final target = height.clamp(petSize(delegate.settings).height - 40, petSize(delegate.settings).height + 200);
    if ((bounds.height - target).abs() < 1) return;
    final position = await clampPetForSize(bounds.topLeft, target);
    await wm.windowManager.setBounds(
      Rect.fromLTWH(position.dx, position.dy, bounds.width, target),
    );
  }

  Future<Offset> clampPetForSize(Offset position, double height) async {
    final size = petSize(delegate.settings);
    final area = await workAreaAround(Offset(position.dx + size.width / 2, position.dy + height / 2));
    if (area == null) return position;
    final clamped = clampPetPosition(
      PetPoint(x: position.dx, y: position.dy),
      PetRect(x: area.x, y: area.y, width: area.width, height: area.height),
      PetDimensions(width: size.width, height: height),
    );
    return Offset(clamped.x, clamped.y);
  }

  void resetMotion() {
    _drag = null;
    _momentum = null;
    _stopMoveLoop();
  }

  Future<void> applyMode(AppMode next, {Offset? petPosition}) async {
    resetMotion();
    mode = next;
    final settings = delegate.settings;
    if (next == AppMode.pet) {
      final size = petSize(settings);
      final position = await clampPet(petPosition ?? Offset(settings.x ?? 0, settings.y ?? 0));
      await wm.windowManager.setMinimumSize(Size.zero);
      await wm.windowManager.setAlwaysOnTop(true);
      await wm.windowManager.setSkipTaskbar(true);
      await wm.windowManager.setResizable(false);
      await wm.windowManager.setHasShadow(false);
      await wm.windowManager.setIgnoreMouseEvents(true, forward: true);
      await wm.windowManager.setBounds(
        Rect.fromLTWH(position.dx, position.dy, size.width, size.height),
      );
      await wm.windowManager.show();
      _startHitTest();
      _stopMoveLoop();
    } else {
      _stopHitTest();
      _stopMoveLoop();
      await wm.windowManager.setMinimumSize(const Size(400, 540));
      await wm.windowManager.setAlwaysOnTop(false);
      await wm.windowManager.setSkipTaskbar(false);
      await wm.windowManager.setResizable(true);
      await wm.windowManager.setHasShadow(true);
      await wm.windowManager.setIgnoreMouseEvents(false);
      await _resizePanelClient(const Size(460, 680));
      await wm.windowManager.center();
      await wm.windowManager.show();
      await wm.windowManager.focus();
    }
  }

  /// Sizes the panel by its client area, the canvas the Flutter layout paints
  /// into. `windowManager.setSize` and `setBounds` both address the outer
  /// frame, and a frameless but resizable window still reserves invisible
  /// resize borders (7 px per side, 7 px along the bottom on Windows), so an
  /// outer 460 x 680 leaves the panel laying itself out at 446 x 673.
  Future<void> _resizePanelClient(Size target) async {
    final windows = nativeapi.WindowManager.instance.getAll();
    final host =
        windows.length == 1 ? windows.first : nativeapi.WindowManager.instance.getCurrent();
    if (host == null) {
      await wm.windowManager.setSize(target);
      return;
    }
    host.contentSize = nativeapi.Size(width: target.width, height: target.height);
  }

  Future<void> refreshPetGeometry() async {
    if (mode != AppMode.pet) return;
    final size = petSize(delegate.settings);
    final bounds = await wm.windowManager.getBounds();
    final position = await clampPet(Offset(bounds.left, bounds.top));
    await wm.windowManager.setBounds(Rect.fromLTWH(position.dx, position.dy, size.width, size.height));
  }

  void _startHitTest() {
    _hitTimer ??= Timer.periodic(const Duration(milliseconds: 100), (_) => _updateHitTest());
  }

  void _stopHitTest() {
    _hitTimer?.cancel();
    _hitTimer = null;
  }

  Future<void> _updateHitTest() async {
    if (mode != AppMode.pet || _drag != null || _momentum != null) return;
    final cursor = nativeapi.DisplayManager.instance.getCursorPosition();
    final bounds = await wm.windowManager.getBounds();
    final local = Offset(cursor.x - bounds.left, cursor.y - bounds.top);
    final stage = Rect.fromLTWH(0, 38, bounds.width, bounds.width * 9 / 16);
    var interactive = _interactiveDock(local, bounds.width, bounds.height);
    if (!interactive && local.dy >= stage.top && local.dy < stage.bottom && local.dx >= 0 && local.dx < bounds.width) {
      interactive = await _hitTester.hitTest(
        delegate.hitTestClip,
        (local.dx - stage.left) / stage.width,
        (local.dy - stage.top) / stage.height,
      );
    }
    if (interactive != _interactive) {
      _interactive = interactive;
      await wm.windowManager.setIgnoreMouseEvents(!interactive, forward: true);
    }
  }

  bool _interactiveDock(Offset local, double width, double height) {
    final dockTop = width * 9 / 16 + 25;
    return local.dy >= dockTop && local.dy <= height && local.dx >= 0 && local.dx <= width;
  }

  Future<void> startDrag() async {
    if (delegate.settings.locked) return;
    final cursor = nativeapi.DisplayManager.instance.getCursorPosition();
    final bounds = await wm.windowManager.getBounds();
    _momentum = null;
    _drag = _DragState(
      offsetX: cursor.x - bounds.left,
      offsetY: cursor.y - bounds.top,
      lastX: cursor.x,
      lastY: cursor.y,
      lastTime: DateTime.now().millisecondsSinceEpoch,
      lastMoved: DateTime.now().millisecondsSinceEpoch,
      velocityX: 0,
      velocityY: 0,
    );
    _interactive = true;
    await wm.windowManager.setIgnoreMouseEvents(false);
    _startMoveLoop();
  }

  Future<void> endDrag() async {
    final drag = _drag;
    _drag = null;
    if (drag == null) return;
    final now = DateTime.now().millisecondsSinceEpoch;
    final bounds = await wm.windowManager.getBounds();
    if (now - drag.lastMoved < 120 && math.sqrt(drag.velocityX * drag.velocityX + drag.velocityY * drag.velocityY) > 200) {
      final cursor = nativeapi.DisplayManager.instance.getCursorPosition();
      final area = await workAreaAround(Offset(cursor.x, cursor.y));
      if (area != null) {
        _momentum = _Momentum(
          x: bounds.left,
          y: bounds.top,
          velocityX: drag.velocityX.clamp(-2000, 2000).toDouble(),
          velocityY: drag.velocityY.clamp(-2000, 2000).toDouble(),
          started: now,
          area: area,
        );
        _startMoveLoop();
      }
    } else {
      delegate.onMomentumStopped();
    }
    _interactive = false;
    await wm.windowManager.setIgnoreMouseEvents(true, forward: true);
  }

  void _startMoveLoop() {
    _moveTimer ??= Timer.periodic(const Duration(milliseconds: 16), (_) => _moveTick());
  }

  void _stopMoveLoop() {
    _moveTimer?.cancel();
    _moveTimer = null;
  }

  Future<void> _moveTick() async {
    final drag = _drag;
    final momentum = _momentum;
    final now = DateTime.now().millisecondsSinceEpoch;
    if (drag != null) {
      final cursor = nativeapi.DisplayManager.instance.getCursorPosition();
      final elapsed = math.max(1, now - drag.lastTime);
      drag.velocityX = (cursor.x - drag.lastX) * 1000 / elapsed;
      drag.velocityY = (cursor.y - drag.lastY) * 1000 / elapsed;
      if (cursor.x != drag.lastX || cursor.y != drag.lastY) drag.lastMoved = now;
      drag.lastX = cursor.x;
      drag.lastY = cursor.y;
      drag.lastTime = now;
      final position = await clampPet(Offset(cursor.x - drag.offsetX, cursor.y - drag.offsetY));
      await wm.windowManager.setPosition(position);
    } else if (momentum != null) {
      momentum.velocityY += 1400 * 0.016;
      momentum.x += momentum.velocityX * 0.016;
      momentum.y += momentum.velocityY * 0.016;
      final position = await _clampWithArea(Offset(momentum.x, momentum.y), momentum.area);
      if (position.dx != momentum.x.roundToDouble()) momentum.velocityX *= -0.65;
      if (position.dy != momentum.y.roundToDouble()) {
        momentum.velocityY *= -0.55;
        momentum.velocityX *= 0.82;
      }
      momentum.x = position.dx;
      momentum.y = position.dy;
      await wm.windowManager.setPosition(position);
      if (DateTime.now().millisecondsSinceEpoch - momentum.started > 4500
          || (momentum.velocityY.abs() < 24 && momentum.velocityX.abs() < 15)) {
        _momentum = null;
        delegate.onMomentumStopped();
        _stopMoveLoop();
      }
    } else {
      _stopMoveLoop();
    }
  }

  Future<Offset> _clampWithArea(Offset position, nativeapi.Rectangle area) async {
    final size = petSize(delegate.settings);
    final clamped = clampPetPosition(
      PetPoint(x: position.dx, y: position.dy),
      PetRect(x: area.x, y: area.y, width: area.width, height: area.height),
      PetDimensions(width: size.width, height: size.height),
    );
    return Offset(clamped.x, clamped.y);
  }

  Future<void> dispose() async {
    _stopMoveLoop();
    _stopHitTest();
  }
}

class _DragState {
  _DragState({
    required this.offsetX,
    required this.offsetY,
    required this.lastX,
    required this.lastY,
    required this.lastTime,
    required this.lastMoved,
    required this.velocityX,
    required this.velocityY,
  });
  final double offsetX;
  final double offsetY;
  double lastX;
  double lastY;
  int lastTime;
  int lastMoved;
  double velocityX;
  double velocityY;
}

class _Momentum {
  _Momentum({
    required this.x,
    required this.y,
    required this.velocityX,
    required this.velocityY,
    required this.started,
    required this.area,
  });
  double x;
  double y;
  double velocityX;
  double velocityY;
  final int started;
  final nativeapi.Rectangle area;
}
