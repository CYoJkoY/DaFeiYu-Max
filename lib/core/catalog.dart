/// Parses assets/catalog.json into the [Catalog] model the animation director
/// and the panel action list both read. Pure Dart so it can be unit tested
/// without a Flutter binding.
library;

import 'dart:convert';

import 'types.dart';

Catalog parseCatalog(Object? value) {
  if (value is String) return parseCatalog(jsonDecode(value));
  final source = value is Map ? value : const {};
  final names = _stringList(source['names']);
  final known = names.toSet();

  List<String> keep(Object? entry) =>
      _stringList(entry).where(known.isEmpty ? (_) => true : known.contains).toList();

  final categories = <CatalogCategory>[];
  for (final raw in source['categories'] is List ? source['categories'] as List : const []) {
    if (raw is! Map) continue;
    final id = raw['id'];
    if (id is! String || id.isEmpty) continue;
    final weight = raw['weight'];
    categories.add(CatalogCategory(
      id: id,
      weight: weight is num && weight.isFinite ? weight.toDouble() : 0,
      noMirror: raw['noMirror'] == true,
      actions: keep(raw['actions']),
    ));
  }

  final states = <String, List<String>>{};
  final rawStates = source['states'];
  if (rawStates is Map) {
    for (final entry in rawStates.entries) {
      final actions = keep(entry.value);
      if (actions.isNotEmpty) states[entry.key.toString()] = actions;
    }
  }

  final idle = keep(source['idle']);
  final clicks = keep(source['clicks']);
  return Catalog(
    names: names,
    idle: idle.isEmpty && names.isNotEmpty ? [names.first] : idle,
    clicks: clicks,
    categories: categories.where((category) => category.actions.isNotEmpty).toList(),
    states: states,
  );
}

List<String> _stringList(Object? value) {
  if (value is! List) return const [];
  final seen = <String>{};
  final result = <String>[];
  for (final entry in value) {
    if (entry is! String) continue;
    final text = entry.trim();
    if (text.isEmpty || !seen.add(text)) continue;
    result.add(text);
  }
  return result;
}

/// Actions matching [query] in either the clip name or its category, so typing
/// "魔术" or "玩耍" both find the same trick.
List<String> searchActions(Catalog catalog, String query) {
  final needle = query.trim().toLowerCase();
  if (needle.isEmpty) {
    return [for (final category in catalog.categories) ...category.actions];
  }
  final matches = <String>[];
  for (final category in catalog.categories) {
    if (category.id.toLowerCase().contains(needle)) {
      matches.addAll(category.actions);
      continue;
    }
    for (final action in category.actions) {
      if (action.toLowerCase().contains(needle)) matches.add(action);
    }
  }
  for (final name in catalog.clicks) {
    if (name.toLowerCase().contains(needle)) matches.add(name);
  }
  final seen = <String>{};
  return matches.where(seen.add).toList();
}

/// Clips that may be mirrored horizontally. Text clips are excluded because a
/// flipped glyph is unreadable.
bool allowMirror(Catalog catalog, String name) {
  for (final category in catalog.categories) {
    if (category.actions.contains(name)) return !category.noMirror;
  }
  return true;
}
