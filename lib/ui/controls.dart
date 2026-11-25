import 'dart:math' as math;

import 'package:material_ui/material_ui.dart';

import 'theme.dart';

/// Every icon in both windows is drawn here instead of shipping an icon font:
/// the strokes stay crisp at any DPI and the set is small enough to keep exact.
enum GlyphKind { minimize, maximize, restore, close, shuffle, pause, play, menu }

class Glyph extends StatelessWidget {
  const Glyph(
    this.kind, {
    super.key,
    this.size = 18,
    this.color = Palette.ink,
    this.strokeWidth = 1.9,
  });

  final GlyphKind kind;
  final double size;
  final Color color;
  final double strokeWidth;

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      size: Size.square(size),
      painter: _GlyphPainter(kind: kind, color: color, strokeWidth: strokeWidth),
    );
  }
}

class _GlyphPainter extends CustomPainter {
  _GlyphPainter({required this.kind, required this.color, required this.strokeWidth});

  final GlyphKind kind;
  final Color color;
  final double strokeWidth;

  Paint get _stroke => Paint()
    ..color = color
    ..style = PaintingStyle.stroke
    ..strokeWidth = strokeWidth
    ..strokeCap = StrokeCap.round
    ..strokeJoin = StrokeJoin.round;

  Paint get _fill => Paint()
    ..color = color
    ..style = PaintingStyle.fill;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.save();
    canvas.scale(size.width / 24, size.height / 24);
    final paint = _stroke;
    switch (kind) {
      case GlyphKind.minimize:
        canvas.drawLine(const Offset(5, 12), const Offset(19, 12), paint);
      case GlyphKind.maximize:
        canvas.drawRRect(
          RRect.fromRectAndRadius(const Rect.fromLTWH(5, 5, 14, 14), const Radius.circular(2)),
          paint,
        );
      case GlyphKind.restore:
        canvas.drawRRect(
          RRect.fromRectAndRadius(const Rect.fromLTWH(5, 8, 11, 11), const Radius.circular(2)),
          paint,
        );
        final path = Path()
          ..moveTo(8, 8)
          ..lineTo(8, 6)
          ..arcToPoint(const Offset(10, 4), radius: const Radius.circular(2))
          ..lineTo(18, 4)
          ..arcToPoint(const Offset(20, 6), radius: const Radius.circular(2))
          ..lineTo(20, 15)
          ..arcToPoint(const Offset(18, 17), radius: const Radius.circular(2))
          ..lineTo(16, 17);
        canvas.drawPath(path, paint);
      case GlyphKind.close:
        canvas.drawLine(const Offset(6, 6), const Offset(18, 18), paint);
        canvas.drawLine(const Offset(18, 6), const Offset(6, 18), paint);
      case GlyphKind.shuffle:
        canvas.drawLine(const Offset(16, 3), const Offset(20, 7), paint);
        canvas.drawLine(const Offset(20, 7), const Offset(16, 11), paint);
        canvas.drawLine(const Offset(4, 7), const Offset(20, 7), paint);
        canvas.drawLine(const Offset(8, 21), const Offset(4, 17), paint);
        canvas.drawLine(const Offset(4, 17), const Offset(8, 13), paint);
        canvas.drawLine(const Offset(20, 17), const Offset(4, 17), paint);
      case GlyphKind.pause:
        canvas.drawLine(const Offset(8, 5), const Offset(8, 19), paint);
        canvas.drawLine(const Offset(16, 5), const Offset(16, 19), paint);
      case GlyphKind.play:
        canvas.drawPath(
          Path()
            ..moveTo(8, 5)
            ..lineTo(19, 12)
            ..lineTo(8, 19)
            ..close(),
          paint,
        );
      case GlyphKind.menu:
        final dots = _fill;
        for (final x in [5.0, 12.0, 19.0]) {
          canvas.drawCircle(Offset(x, 12), 1.35, dots);
        }
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(_GlyphPainter oldDelegate) =>
      oldDelegate.kind != kind || oldDelegate.color != color || oldDelegate.strokeWidth != strokeWidth;
}

/// The little desk bulb. Lit bulbs glow; the unlit one only outlines.
class BulbIcon extends StatelessWidget {
  const BulbIcon({required this.lit, super.key, this.size = 18});

  final bool lit;
  final double size;

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      size: Size(size, size * 4 / 3),
      painter: _BulbPainter(lit: lit),
    );
  }
}

class _BulbPainter extends CustomPainter {
  _BulbPainter({required this.lit});

  final bool lit;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.save();
    canvas.scale(size.width / 18, size.height / 24);
    final body = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.5
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round
      ..color = lit ? Palette.bulbLit : Palette.bulbIdle;

    final glass = Path()
      ..moveTo(4.5, 7.5)
      ..arcToPoint(const Offset(13.5, 7.5), radius: const Radius.circular(4.5))
      ..cubicTo(13.5, 10, 11.4, 11, 11.4, 13)
      ..lineTo(6.6, 13)
      ..cubicTo(6.6, 11, 4.5, 10, 4.5, 7.5)
      ..close();
    final glassPaint = Paint()
      ..style = PaintingStyle.fill
      ..color = lit ? Palette.bulbGlass : const Color(0xFFE6EDF5);
    canvas.drawPath(glass, glassPaint);
    canvas.drawPath(glass, body);

    canvas.drawLine(const Offset(7, 15.4), const Offset(11, 15.4), body);
    canvas.drawLine(const Offset(7.6, 17.6), const Offset(10.4, 17.6), body);
    canvas.drawLine(const Offset(9, 13), const Offset(9, 9.4), body);
    canvas.drawLine(const Offset(7.4, 7.6), const Offset(9, 9.2), body);
    canvas.drawLine(const Offset(10.6, 7.6), const Offset(9, 9.2), body);

    if (lit) {
      body.strokeWidth = 1.3;
      canvas.drawLine(const Offset(9, 1.4), const Offset(9, 0.4), body);
      canvas.drawLine(const Offset(2.6, 3.4), const Offset(1.4, 2.2), body);
      canvas.drawLine(const Offset(15.4, 3.4), const Offset(16.6, 2.2), body);
      canvas.drawLine(const Offset(1.6, 8.6), const Offset(0.4, 8.6), body);
      canvas.drawLine(const Offset(16.4, 8.6), const Offset(17.6, 8.6), body);
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(_BulbPainter oldDelegate) => oldDelegate.lit != lit;
}

/// Reacts to hover without an InkWell ripple; desktop chrome should not ripple.
class Hoverable extends StatefulWidget {
  const Hoverable({required this.builder, super.key, this.cursor = SystemMouseCursors.click});

  final Widget Function(BuildContext context, bool hovered, bool pressed) builder;
  final MouseCursor cursor;

  @override
  State<Hoverable> createState() => _HoverableState();
}

class _HoverableState extends State<Hoverable> {
  bool _hovered = false;
  bool _pressed = false;

  @override
  Widget build(BuildContext context) {
    return MouseRegion(
      cursor: widget.cursor,
      onEnter: (_) => setState(() => _hovered = true),
      onExit: (_) => setState(() {
        _hovered = false;
        _pressed = false;
      }),
      child: Listener(
        onPointerDown: (_) => setState(() => _pressed = true),
        onPointerUp: (_) => setState(() => _pressed = false),
        onPointerCancel: (_) => setState(() => _pressed = false),
        child: widget.builder(context, _hovered, _pressed),
      ),
    );
  }
}

/// The 32x30 nav button above the dock.
class PetButton extends StatelessWidget {
  const PetButton({
    required this.icon,
    required this.tooltip,
    required this.onTap,
    super.key,
    this.active = false,
  });

  final GlyphKind icon;
  final String tooltip;
  final VoidCallback onTap;
  final bool active;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      waitDuration: const Duration(milliseconds: 500),
      child: Hoverable(
        builder: (context, hovered, pressed) => GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: onTap,
          child: AnimatedScale(
            scale: pressed ? 0.94 : 1,
            duration: const Duration(milliseconds: 90),
            child: Container(
              width: 32,
              height: 30,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: active
                    ? Palette.petAccentSoft
                    : (hovered ? Palette.petAccentSoft : Colors.transparent),
                borderRadius: BorderRadius.circular(14),
              ),
              child: Glyph(icon, size: 18, color: active ? Palette.accent : const Color(0xFF345881)),
            ),
          ),
        ),
      ),
    );
  }
}

/// 36x28 caption button for the companion panel.
class CaptionButton extends StatelessWidget {
  const CaptionButton({
    required this.icon,
    required this.tooltip,
    required this.onTap,
    super.key,
    this.close = false,
  });

  final GlyphKind icon;
  final String tooltip;
  final VoidCallback onTap;
  final bool close;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      waitDuration: const Duration(milliseconds: 500),
      child: Hoverable(
        builder: (context, hovered, pressed) {
          final background = close && hovered
              ? const Color(0xFFD94B4B)
              : (hovered ? const Color(0xFFE3ECFA) : Colors.transparent);
          final color = close && hovered ? Colors.white : const Color(0xFF5B7595);
          return GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: onTap,
            child: AnimatedScale(
              scale: pressed ? 0.94 : 1,
              duration: const Duration(milliseconds: 90),
              child: Container(
                width: 36,
                height: 28,
                alignment: Alignment.center,
                decoration: BoxDecoration(color: background, borderRadius: BorderRadius.circular(8)),
                child: Glyph(icon, size: 15, color: color, strokeWidth: 1.7),
              ),
            ),
          );
        },
      ),
    );
  }
}

/// The pill switch used for quota visibility and the settings toggles.
class PanelSwitch extends StatelessWidget {
  const PanelSwitch({required this.value, required this.onChanged, super.key, this.enabled = true});

  final bool value;
  final ValueChanged<bool>? onChanged;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final interactive = enabled && onChanged != null;
    return GestureDetector(
      onTap: interactive ? () => onChanged!(!value) : null,
      child: MouseRegion(
        cursor: interactive ? SystemMouseCursors.click : SystemMouseCursors.basic,
        child: Opacity(
          opacity: enabled ? 1 : 0.5,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 160),
            width: 34,
            height: 20,
            padding: const EdgeInsets.all(3),
            alignment: value ? Alignment.centerRight : Alignment.centerLeft,
            decoration: BoxDecoration(
              color: value ? const Color(0xFF6C9EE8) : const Color(0xFFD5DFEB),
              borderRadius: BorderRadius.circular(999),
            ),
            child: Container(
              width: 14,
              height: 14,
              decoration: BoxDecoration(
                color: Colors.white,
                shape: BoxShape.circle,
                boxShadow: [
                  BoxShadow(color: const Color(0x38294666), blurRadius: 3, offset: const Offset(0, 1)),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class PanelToggleRow extends StatelessWidget {
  const PanelToggleRow({
    required this.label,
    required this.value,
    required this.onChanged,
    super.key,
    this.enabled = true,
  });

  final String label;
  final bool value;
  final ValueChanged<bool>? onChanged;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        children: [
          Expanded(child: Text(label, style: uiText(size: 12, color: Palette.ink))),
          PanelSwitch(value: value, onChanged: onChanged, enabled: enabled),
        ],
      ),
    );
  }
}

class Badge extends StatelessWidget {
  const Badge(this.text, {super.key, this.background, this.color});

  final String text;
  final Color? background;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: background ?? Palette.badgeBg,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(text, style: uiText(size: 10, color: color ?? Palette.badgeInk)),
    );
  }
}

/// Dropdown that keeps the panel's flat pill looks. There is no platform popup
/// chrome involved, so it renders identically on Windows and macOS.
class PanelSelect<T> extends StatelessWidget {
  const PanelSelect({
    required this.value,
    required this.options,
    required this.onChanged,
    super.key,
    this.enabled = true,
    this.minWidth = 62,
  });

  final T? value;
  final List<(T, String)> options;
  final ValueChanged<T>? onChanged;
  final bool enabled;
  final double minWidth;

  @override
  Widget build(BuildContext context) {
    final interactive = enabled && onChanged != null;
    final label = options.where((option) => option.$1 == value).map((o) => o.$2).firstOrNull ?? '';
    return PopupMenuButton<T>(
      enabled: interactive,
      tooltip: '',
      padding: EdgeInsets.zero,
      position: PopupMenuPosition.under,
      onSelected: (next) => onChanged?.call(next),
      itemBuilder: (context) => [
        for (final option in options)
          PopupMenuItem<T>(
            value: option.$1,
            height: 36,
            child: Text(option.$2, style: uiText(size: 12)),
          ),
      ],
      child: Opacity(
        opacity: enabled ? 1 : 0.55,
        child: Container(
          constraints: BoxConstraints(minWidth: minWidth),
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          decoration: BoxDecoration(
            color: const Color(0xFFF3F6FB),
            borderRadius: BorderRadius.circular(6),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(label, style: uiText(size: 12, color: const Color(0xFF4F7198))),
              const SizedBox(width: 4),
              const Icon(Icons.expand_more, size: 14, color: Color(0xFF7C93B1)),
            ],
          ),
        ),
      ),
    );
  }
}

class PanelCard extends StatelessWidget {
  const PanelCard({required this.child, super.key});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 13),
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: Palette.border),
        borderRadius: BorderRadius.circular(18),
        boxShadow: const [
          BoxShadow(color: Color(0x052A4B76), blurRadius: 18, offset: Offset(0, 4)),
        ],
      ),
      child: child,
    );
  }
}

class PanelSectionHeader extends StatelessWidget {
  const PanelSectionHeader({required this.title, super.key, this.trailing});

  final String title;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        children: [
          Expanded(child: Text(title, style: uiText(size: 14, weight: FontWeight.w600))),
          ?trailing,
        ],
      ),
    );
  }
}

class PanelButton extends StatelessWidget {
  const PanelButton({
    required this.label,
    required this.onTap,
    super.key,
    this.primary = false,
    this.flat = false,
    this.enabled = true,
    this.top = 0,
  });

  final String label;
  final VoidCallback? onTap;
  final bool primary;
  final bool flat;
  final bool enabled;
  final double top;

  @override
  Widget build(BuildContext context) {
    final interactive = enabled && onTap != null;
    return Padding(
      padding: EdgeInsets.only(top: top),
      child: Hoverable(
        cursor: interactive ? SystemMouseCursors.click : SystemMouseCursors.basic,
        builder: (context, hovered, pressed) {
          final background = flat
              ? Colors.transparent
              : (primary ? const Color(0xFFEAF1FF) : const Color(0xFFEDF3FF));
          final hoveredBackground = flat ? const Color(0xFFEFF4FF) : const Color(0xFFDCE9FF);
          return GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: interactive ? onTap : null,
            child: AnimatedScale(
              scale: pressed && interactive ? 0.97 : 1,
              duration: const Duration(milliseconds: 90),
              child: Opacity(
                opacity: enabled ? 1 : 0.5,
                child: Container(
                  padding: flat
                      ? const EdgeInsets.symmetric(horizontal: 2, vertical: 2)
                      : const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                  decoration: BoxDecoration(
                    color: hovered && interactive ? hoveredBackground : background,
                    borderRadius: BorderRadius.circular(9),
                  ),
                  child: Text(
                    label,
                    style: uiText(size: 11, color: const Color(0xFF426799), weight: FontWeight.w500),
                  ),
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

class PanelNote extends StatelessWidget {
  const PanelNote(this.text, {super.key, this.error = false});

  final String text;
  final bool error;

  @override
  Widget build(BuildContext context) {
    if (text.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Text(
        text,
        style: uiText(
          size: error ? 12 : 11,
          color: error ? Palette.errorInk : Palette.muted,
          height: 1.7,
        ),
      ),
    );
  }
}

/// Small horizontal bar showing how much of a subscription window is left.
class QuotaMeter extends StatelessWidget {
  const QuotaMeter({required this.percent, super.key, this.low = false});

  final double percent;
  final bool low;

  @override
  Widget build(BuildContext context) {
    final clamped = percent.clamp(0, 100).toDouble();
    return Padding(
      padding: const EdgeInsets.only(top: 8, bottom: 4),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(6),
        child: Container(
          height: 6,
          color: const Color(0xFFEEF3FA),
          child: FractionallySizedBox(
            alignment: Alignment.centerLeft,
            widthFactor: clamped / 100,
            child: Container(color: low ? const Color(0xFFDB9F78) : const Color(0xFF7BA9EC)),
          ),
        ),
      ),
    );
  }
}

/// The request bulbs. A single unlit bulb means "Magpie is reachable but idle";
/// eight plus `+N` is the capped form of a busy gateway.
class RequestLights extends StatelessWidget {
  const RequestLights({required this.requests, required this.available, super.key});

  final int requests;
  final bool available;

  @override
  Widget build(BuildContext context) {
    final count = math.min(8, math.max(1, requests));
    final lit = requests > 0;
    return Opacity(
      opacity: available ? 1 : 0.4,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (var index = 0; index < count; index++)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 2),
              child: BulbIcon(lit: lit),
            ),
          if (requests > 8)
            Padding(
              padding: const EdgeInsets.only(left: 4),
              child: Text(
                '+${requests - 8}',
                style: uiText(size: 12, weight: FontWeight.w700, color: const Color(0xFFC98A1D)),
              ),
            ),
        ],
      ),
    );
  }
}

extension _FirstOrNull<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
}
