import 'package:flutter_test/flutter_test.dart';
import 'package:magpie_dafeiyu/core/position.dart';
import 'package:magpie_dafeiyu/core/types.dart';

void main() {
  final area = const PetRect(x: 0, y: 0, width: 1920, height: 1080);
  final dims = const PetDimensions(width: 460, height: 300);

  test('keeps in-bounds points unchanged', () {
    expect(clampPetPosition(const PetPoint(x: 900, y: 400), area, dims).x, 900);
    expect(clampPetPosition(const PetPoint(x: 900, y: 400), area, dims).y, 400);
  });

  test('clamps to the right grip margin', () {
    final clamped = clampPetPosition(const PetPoint(x: 5000, y: 400), area, dims);
    expect(clamped.x, (1920 - 230 - 36).toDouble());
  });

  test('clamps vertical overflow', () {
    final clamped = clampPetPosition(const PetPoint(x: 900, y: 5000), area, dims);
    expect(clamped.y, 780);
  });
}
