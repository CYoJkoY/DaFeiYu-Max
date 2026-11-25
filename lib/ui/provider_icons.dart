import 'package:flutter_svg/flutter_svg.dart';
import 'package:material_ui/material_ui.dart';

/// Provider logos that ship inside the bundle. The list mirrors the Electron
/// build so a Magpie card with `icon: "deepseek-color"` still shows the same
/// mark here; anything unknown falls back to the first letter.
const Set<String> bundledProviderIcons = <String>{
  'cursor',
  'deepseek-color',
  'codex-color',
  'volcengine-color',
  'claude-color',
  'gemini-color',
  'qwen-color',
  'openai',
  'grok',
  'zhipu-color',
};

String? providerIconAsset(String? icon) =>
    icon != null && bundledProviderIcons.contains(icon) ? 'assets/provider-icons/$icon.svg' : null;

String providerInitial({String? name, String? provider}) {
  final raw = (name ?? provider ?? '?').trim();
  if (raw.isEmpty) return '?';
  return raw.substring(0, 1).toUpperCase();
}

/// A 14px account mark: the bundled SVG when we have one, otherwise the tinted
/// initial square the Electron build used as its fallback.
class ProviderIcon extends StatelessWidget {
  const ProviderIcon({
    required this.icon,
    required this.name,
    super.key,
    this.size = 14,
  });

  final String icon;
  final String name;
  final double size;

  @override
  Widget build(BuildContext context) {
    final asset = providerIconAsset(icon);
    if (asset == null) return _initial();
    return SvgPicture.asset(
      asset,
      width: size,
      height: size,
      fit: BoxFit.contain,
      errorBuilder: (context, error, stackTrace) => _initial(),
    );
  }

  Widget _initial() {
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: const Color(0xFFDBE7F5),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(
        providerInitial(name: name),
        style: TextStyle(
          fontSize: size * 9 / 14,
          fontWeight: FontWeight.w700,
          height: 1,
          color: const Color(0xFF5275A1),
        ),
      ),
    );
  }
}
