import 'package:flutter_test/flutter_test.dart';
import 'package:magpie_dafeiyu/core/settings.dart';

void main() {
  group('normalizeSettings', () {
    test('returns defaults for garbage input', () {
      final settings = normalizeSettings('nonsense');
      expect(settings.size, 460);
      expect(settings.active, isTrue);
      expect(settings.interests, defaultInterests);
      expect(settings.plugins.market.repo, defaultMarketRepo);
    });

    test('rejects an invalid pet size and keeps a valid one', () {
      expect(normalizeSettings({'size': 999}).size, 460);
      expect(normalizeSettings({'size': 560}).size, 560);
    });

    test('clamps and de-duplicates interests', () {
      final settings = normalizeSettings({
        'interests': ['  DeepSeek ', 'deepseek', 'Magpie', 42, '', 'a' * 80],
      });
      expect(settings.interests, ['DeepSeek', 'Magpie', 'a' * 40]);
    });

    test('caps interest count at 20', () {
      final settings = normalizeSettings({
        'interests': List.generate(50, (index) => 'topic-$index'),
      });
      expect(settings.interests.length, 20);
    });

    test('keeps only kebab-case script selections', () {
      final settings = normalizeSettings({
        'plugins': {
          'scripts': {
            'douyin-helper': {
              'enabled': true,
              'options': {'mode': 'fast', 'bad key!': 1, 'count': 3},
            },
            'Not A Slug': {'enabled': true},
          },
        },
      });
      expect(settings.plugins.scripts.keys, ['douyin-helper']);
      final selection = settings.plugins.scripts['douyin-helper']!;
      expect(selection.enabled, isTrue);
      expect(selection.options.keys.toSet(), {'mode', 'count'});
    });
  });

  group('sanitizeBridgeUrl', () {
    test('normalizes a valid http url', () {
      expect(sanitizeBridgeUrl('https://example.com/') , 'https://example.com');
      expect(sanitizeBridgeUrl(' http://host:8080/path/ '), 'http://host:8080/path');
    });

    test('rejects credentials and non-http schemes', () {
      expect(sanitizeBridgeUrl('ftp://host'), isNull);
      expect(sanitizeBridgeUrl('https://user:pass@host'), isNull);
      expect(sanitizeBridgeUrl('not a url'), isNull);
    });
  });

  group('sanitizeMarket', () {
    test('rejects path-traversal refs and bad repos', () {
      expect(MarketSettings.fromJson({'repo': 'owner/name', 'ref': 'main'}).repo, 'owner/name');
      expect(MarketSettings.fromJson({'repo': '../evil', 'ref': 'main'}).repo, defaultMarketRepo);
      expect(MarketSettings.fromJson({'repo': 'owner/name', 'ref': '..'}).ref, defaultMarketRef);
    });
  });
}
