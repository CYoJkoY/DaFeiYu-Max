import 'dart:convert';

import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_test/flutter_test.dart';

import 'package:magpie_dafeiyu/core/catalog.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('parses a catalog and keeps only known clips', () {
    final catalog = parseCatalog({
      'names': ['待机', '放烟花'],
      'idle': ['待机', '未知动作'],
      'clicks': ['未知动作'],
      'categories': [
        {
          'id': '表演',
          'weight': 3,
          'actions': ['放烟花'],
        },
        {
          'id': '垃圾',
          'weight': 1,
          'actions': ['未知动作'],
        },
      ],
      'states': {'thinking': ['放烟花', '未知动作']},
    });
    expect(catalog.names, ['待机', '放烟花']);
    expect(catalog.idle, ['待机']);
    expect(catalog.clicks, isEmpty);
    expect(catalog.categories.single.actions, ['放烟花']);
    expect(catalog.states, {'thinking': ['放烟花']});
  });

  test('falls back to the first known clip when idle is empty', () {
    final catalog = parseCatalog({
      'names': ['待机'],
      'idle': ['未知动作'],
      'clicks': [],
      'categories': [],
      'states': {},
    });
    expect(catalog.idle, ['待机']);
  });

  test('searches by category and action name', () {
    final catalog = parseCatalog({
      'names': ['放烟花', '写字'],
      'idle': ['写字'],
      'clicks': ['写字'],
      'categories': [
        {'id': '表演', 'weight': 1, 'actions': ['放烟花']},
        {'id': '学习', 'weight': 1, 'actions': ['写字']},
      ],
      'states': {},
    });
    expect(searchActions(catalog, '表演'), ['放烟花']);
    expect(searchActions(catalog, '写字'), ['写字']);
    expect(searchActions(catalog, '').length, 2);
  });

  test('loads the bundled catalog', () async {
    final raw = await rootBundle.loadString('assets/catalog.json');
    final catalog = parseCatalog(jsonDecode(raw));
    expect(catalog.names, isNotEmpty);
    expect(catalog.idle, isNotEmpty);
    expect(catalog.categories, isNotEmpty);
  });
}
