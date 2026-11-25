import 'dart:math' as math;

import 'package:flutter/gestures.dart' show kPrimaryMouseButton, kSecondaryMouseButton;
import 'package:material_ui/material_ui.dart';

import '../app/app_controller.dart';
import '../app/plugin_registry.dart';
import '../core/quota_display.dart';
import 'animated_webp.dart';
import 'controls.dart';
import 'provider_icons.dart';
import 'theme.dart';

/// Saturation/brightness boost the Electron build applied to every clip. Kept as
/// a matrix so the decoded WebP goes through the same colour pipeline.
const ColorFilter _clipFilter = ColorFilter.matrix(<double>[
  1.51841, -0.37830, -0.03809, 0, -4.4625, //
  -0.11270, 1.25293, -0.03809, 0, -4.4625, //
  -0.11270, -0.37830, 1.59289, 0, -4.4625, //
  0, 0, 0, 1, 0, //
]);

const double _stageTop = 38;
const double _dockGap = 25;

/// The transparent, always-on-top pet window.
class PetView extends StatefulWidget {
  const PetView({required this.controller, super.key});

  final AppController controller;

  @override
  State<PetView> createState() => _PetViewState();
}

class _PetViewState extends State<PetView> {
  final GlobalKey _dockKey = GlobalKey(debugLabel: 'pet-dock');
  Offset? _pointerDown;
  bool _dragging = false;

  AppController get controller => widget.controller;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth;
        final stageHeight = width * 9 / 16;
        final dockTop = _stageTop + stageHeight + _dockGap;
        WidgetsBinding.instance.addPostFrameCallback((_) => _reportDock(dockTop));
        return RepaintBoundary(
          key: controller.petCaptureKey,
          child: Stack(
            children: [
              Positioned(
                top: _stageTop,
                left: 0,
                right: 0,
                height: stageHeight,
                child: _stage(),
              ),
              Positioned(
                top: dockTop,
                left: 0,
                right: 0,
                child: KeyedSubtree(key: _dockKey, child: _dock(width)),
              ),
            ],
          ),
        );
      },
    );
  }

  void _reportDock(double dockTop) {
    if (!mounted) return;
    final box = _dockKey.currentContext?.findRenderObject();
    if (box is! RenderBox || !box.hasSize) return;
    controller.fitPetWindow(dockTop + box.size.height + 8);
  }

  Widget _stage() {
    return MouseRegion(
      cursor: _dragging ? SystemMouseCursors.grabbing : SystemMouseCursors.grab,
      child: Listener(
        onPointerDown: _onPointerDown,
        onPointerMove: _onPointerMove,
        onPointerUp: _onPointerUp,
        onPointerCancel: _onPointerCancel,
        child: ColorFiltered(
          colorFilter: _clipFilter,
          child: AnimatedWebp(
            clip: controller.director.current,
            playing: !controller.settings.paused && controller.petVisible,
            onFinished: controller.clipFinished,
          ),
        ),
      ),
    );
  }

  void _onPointerDown(PointerDownEvent event) {
    if (event.buttons & kSecondaryMouseButton != 0) {
      controller.openTrayMenu();
      return;
    }
    if (event.buttons & kPrimaryMouseButton == 0) return;
    _pointerDown = event.position;
    _dragging = false;
  }

  void _onPointerMove(PointerMoveEvent event) {
    final start = _pointerDown;
    if (start == null || _dragging || controller.settings.locked) return;
    if ((event.position - start).distance > 5) {
      setState(() => _dragging = true);
      controller.startDrag();
      controller.playDragClip();
    }
  }

  void _onPointerUp(PointerUpEvent event) {
    if (_pointerDown == null) return;
    _pointerDown = null;
    if (_dragging) {
      setState(() => _dragging = false);
      controller.endDrag();
      controller.nextClip(program: false);
    } else {
      controller.tapPet();
    }
  }

  void _onPointerCancel(PointerCancelEvent event) {
    if (_pointerDown == null) return;
    _pointerDown = null;
    if (_dragging) {
      setState(() => _dragging = false);
      controller.endDrag();
    }
  }

  Widget _dock(double width) {
    final festival = controller.pluginView.festival;
    final badges = controller.settings.showQuotas
        ? controller.quotaBadges
            .where((badge) => controller.settings.hiddenQuotas[badge.key] != true)
            .toList()
        : const <QuotaBadge>[];
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (festival != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: _FestivalBanner(festival: festival, accent: controller.accent),
          ),
        if (badges.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: _QuotaChips(badges: badges, width: width),
          ),
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            _nav(),
            if (controller.settings.showBulbs) ...[
              const SizedBox(width: 10),
              RequestLights(
                requests: controller.activity.available ? math.max(0, controller.activity.activeCount) : 0,
                available: controller.activity.available,
              ),
            ],
          ],
        ),
      ],
    );
  }

  Widget _nav() {
    final borderColor = Color.alphaBlend(controller.accent.withValues(alpha: 0.24), Palette.navBorder);
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: Palette.dockBg,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: borderColor),
        boxShadow: const [BoxShadow(color: Color(0x10243F65), blurRadius: 10)],
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          PetButton(
            icon: GlyphKind.shuffle,
            tooltip: '换一个动作',
            onTap: () => controller.nextClip(),
          ),
          const SizedBox(width: 3),
          PetButton(
            icon: controller.settings.paused ? GlyphKind.play : GlyphKind.pause,
            tooltip: controller.settings.paused ? '继续动画' : '暂停动画',
            active: controller.settings.paused,
            onTap: controller.togglePause,
          ),
          const SizedBox(width: 3),
          PetButton(
            icon: GlyphKind.menu,
            tooltip: '更多：额度、动作与设置',
            onTap: controller.openTrayMenu,
          ),
        ],
      ),
    );
  }
}

class _FestivalBanner extends StatelessWidget {
  const _FestivalBanner({required this.festival, required this.accent});

  final FestivalWindow festival;
  final Color accent;

  @override
  Widget build(BuildContext context) {
    final accessories = festival.accessories.join(' ');
    final greeting = festival.greeting;
    final ink = Color.alphaBlend(accent.withValues(alpha: 0.76), const Color(0xFF5A3C1E));
    return Container(
      constraints: const BoxConstraints(maxWidth: 340),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: const Color(0xF5FFFCF6),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(
          color: Color.alphaBlend(accent.withValues(alpha: 0.34), Colors.white),
        ),
        boxShadow: const [BoxShadow(color: Color(0x12243F65), blurRadius: 10)],
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (accessories.isNotEmpty)
            Text(
              accessories,
              style: uiText(size: 11, weight: FontWeight.w600, color: ink).copyWith(letterSpacing: 1),
            ),
          if (accessories.isNotEmpty) const SizedBox(width: 5),
          Flexible(
            child: Text(
              greeting,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: uiText(size: 11, weight: FontWeight.w600, color: ink, height: 1.35),
            ),
          ),
        ],
      ),
    );
  }
}

class _QuotaChips extends StatelessWidget {
  const _QuotaChips({required this.badges, required this.width});

  final List<QuotaBadge> badges;
  final double width;

  @override
  Widget build(BuildContext context) {
    return ConstrainedBox(
      constraints: BoxConstraints(maxWidth: math.min(math.max(0, width - 72), 280), maxHeight: 165),
      child: SingleChildScrollView(
        child: Wrap(
          alignment: WrapAlignment.center,
          spacing: 6,
          runSpacing: 6,
          children: [for (final badge in badges) _QuotaChip(badge: badge)],
        ),
      ),
    );
  }
}

class _QuotaChip extends StatelessWidget {
  const _QuotaChip({required this.badge});

  final QuotaBadge badge;

  @override
  Widget build(BuildContext context) {
    final balance = badge.account.kind == 'balance';
    final value = balance && !badge.available ? '?' : badge.text;
    final color = badge.active
        ? Palette.quotaActive
        : (badge.available ? Palette.quotaInk : Palette.quotaIdle);
    final detail = badge.available
        ? '剩余 ${badge.text}${balance ? '（Magpie 缓存余额）' : ''}'
        : (balance ? '余额待刷新' : '额度待刷新');
    return Tooltip(
      message: '${badge.label} · ${badge.active ? '正在使用' : '当前未确认有请求使用'} · $detail',
      waitDuration: const Duration(milliseconds: 400),
      child: Container(
        constraints: const BoxConstraints(minWidth: 45),
        height: 27,
        padding: const EdgeInsets.symmetric(horizontal: 7),
        decoration: BoxDecoration(
          color: badge.active ? Palette.quotaActiveBg : Palette.quotaBg,
          borderRadius: BorderRadius.circular(11),
          border: Border.all(color: badge.active ? Palette.quotaActiveBorder : Palette.quotaBorder),
          boxShadow: const [BoxShadow(color: Color(0x10243F65), blurRadius: 5, offset: Offset(0, 1))],
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            ProviderIcon(icon: badge.icon, name: badge.label, size: 14),
            const SizedBox(width: 4),
            Text(
              value,
              style: uiText(size: 12, weight: FontWeight.w600, color: color, height: 1)
                  .copyWith(fontFeatures: const <FontFeature>[FontFeature.tabularFigures()]),
            ),
          ],
        ),
      ),
    );
  }
}
