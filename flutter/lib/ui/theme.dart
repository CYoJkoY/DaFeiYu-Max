import 'package:material_ui/material_ui.dart';

/// The one palette both windows share. Values mirror the Electron stylesheet so
/// the rewrite keeps the same look instead of inventing a new one.
class Palette {
  const Palette._();

  static const accent = Color(0xFF2F6FE0);
  static const accentSoft = Color(0xFFE4EFFF);
  static const petAccentSoft = Color(0xFFE0ECFF);
  static const panelBg = Color(0xFFF3F7FD);
  static const ink = Color(0xFF243955);
  static const muted = Color(0xFF7E8EA6);
  static const border = Color(0xFFDFE8F4);
  static const hairline = Color(0xFFE6EDF7);
  static const titleInk = Color(0xFF4C6A90);
  static const titleSub = Color(0xFF8B9CB4);
  static const navBorder = Color(0xFFD5E1F3);
  static const dockBg = Color(0xF2F6FAFF);
  static const titlebarBg = Color(0xE0F3F7FD);
  static const titlebarBorder = Color(0xFFE2EBF8);
  static const badgeBg = Color(0xFFEFF5FF);
  static const badgeInk = Color(0xFF7187AA);
  static const quotaInk = Color(0xFF4B6B8C);
  static const quotaBorder = Color(0xFFCEDDEB);
  static const quotaBg = Color(0xF5F2F7FD);
  static const quotaActive = Color(0xFFC63F54);
  static const quotaActiveBg = Color(0xFFFFF0F2);
  static const quotaActiveBorder = Color(0xFFEDB4BE);
  static const quotaIdle = Color(0xFF8898AA);
  static const bulbLit = Color(0xFFDE9B25);
  static const bulbGlass = Color(0xFFFFE69A);
  static const bulbIdle = Color(0xFFA5B2C5);
  static const errorInk = Color(0xFFA27660);
}

Color parseHexColor(String? value, {Color fallback = Palette.accent}) {
  if (value == null) return fallback;
  final text = value.trim().replaceFirst('#', '');
  if (text.length != 6 && text.length != 8) return fallback;
  final parsed = int.tryParse(text, radix: 16);
  if (parsed == null) return fallback;
  return Color(text.length == 6 ? 0xFF000000 | parsed : parsed);
}

Color mixWithWhite(Color color, double amount) => Color.lerp(color, Colors.white, amount) ?? color;

ThemeData buildTheme(Color accent) {
  final base = ThemeData(
    useMaterial3: true,
    brightness: Brightness.light,
    scaffoldBackgroundColor: Colors.transparent,
  );
  return base.copyWith(
    colorScheme: base.colorScheme.copyWith(
      primary: accent,
      surface: Palette.panelBg,
      onSurface: Palette.ink,
    ),
    textTheme: base.textTheme.apply(
      bodyColor: Palette.ink,
      displayColor: Palette.ink,
    ),
    splashFactory: NoSplash.splashFactory,
    highlightColor: Colors.transparent,
  );
}

const List<String> _fontFallback = <String>[
  'Microsoft YaHei UI',
  'Microsoft YaHei',
  'PingFang SC',
  'Noto Sans CJK SC',
  'Segoe UI',
];

TextStyle uiText({
  double size = 12,
  FontWeight weight = FontWeight.w400,
  Color color = Palette.ink,
  double? letterSpacing,
  double height = 1.4,
}) =>
    TextStyle(
      fontSize: size,
      fontWeight: weight,
      color: color,
      letterSpacing: letterSpacing,
      height: height,
      fontFamilyFallback: _fontFallback,
    );

/// Numerals in quota chips and meters must not jitter as values change.
const List<FontFeature> tabularFigures = <FontFeature>[FontFeature.tabularFigures()];
