// Haversine formula — distance between two GPS coordinates in metres.
// Pure calculation, no side effects.

const EARTH_RADIUS_M = 6_371_000; // mean radius in metres

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Calculate the distance in metres between two lat/lng points
 * using the Haversine formula.
 */
export function haversineDistanceMetres(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(EARTH_RADIUS_M * c); // whole metres
}
