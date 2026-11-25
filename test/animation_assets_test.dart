import 'dart:convert';
import 'dart:ui' as ui;

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('every catalog animation keeps its transparent stage', () async {
    final catalog = jsonDecode(await rootBundle.loadString('assets/catalog.json')) as Map<String, dynamic>;
    final names = (catalog['names'] as List).cast<String>();
    expect(names, hasLength(106));
    for (final name in names) {
      final bytes = await rootBundle.load('assets/pet/$name.webp');
      final codec = await ui.instantiateImageCodec(bytes.buffer.asUint8List());
      try {
        expect(codec.frameCount, greaterThan(1), reason: '$name must remain animated');
        // The pet window has no opaque background behind it, so a single frame
        // that paints the whole stage would show up as a black rectangle on the
        // desktop. Sample the head of the clip on every platform.
        final samples = codec.frameCount < 8 ? codec.frameCount : 8;
        for (var index = 0; index < samples; index += 1) {
          final frame = await codec.getNextFrame();
          try {
            final image = frame.image;
            expect(image.width, 512, reason: name);
            expect(image.height, 288, reason: name);
            final pixels = (await image.toByteData(format: ui.ImageByteFormat.rawStraightRgba))!.buffer.asUint8List();
            var clear = 0;
            var opaque = 0;
            var blackOpaque = 0;
            for (var offset = 0; offset < pixels.length; offset += 4) {
              final alpha = pixels[offset + 3];
              if (alpha <= 8) clear += 1;
              if (alpha >= 200) opaque += 1;
              if (alpha > 128 && pixels[offset] < 16 && pixels[offset + 1] < 16 && pixels[offset + 2] < 16) {
                blackOpaque += 1;
              }
            }
            final count = image.width * image.height;
            final where = '$name frame $index';
            expect(clear / count, greaterThan(0.5), reason: '$where lost its alpha channel');
            expect(blackOpaque / count, lessThan(0.05), reason: '$where paints an opaque black stage');
            expect(opaque / count, greaterThan(0.01), reason: '$where has no visible artwork');
            expect(opaque / count, lessThan(0.6), reason: '$where is almost entirely opaque');
          } finally {
            frame.image.dispose();
          }
        }
      } finally {
        codec.dispose();
      }
    }
  });
}
