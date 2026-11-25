/// Clamp a floating pet window so it stays reachable while still allowing the
/// artwork to hang off either screen edge. Ported from src/core/position.ts.
library;

import 'types.dart';

PetPoint clampPetPosition(PetPoint position, PetRect area, PetDimensions dimensions) {
  final halfWidth = dimensions.width / 2;
  final grip = area.width / 2 < 36.0 ? area.width / 2 : 36.0;
  final clampedX = position.x.clamp(area.x - halfWidth + grip, area.x + area.width - halfWidth - grip);
  final clampedY = position.y.clamp(area.y, area.y + (area.height - dimensions.height).clamp(0, area.height));
  return PetPoint(x: clampedX.roundToDouble(), y: clampedY.roundToDouble());
}
