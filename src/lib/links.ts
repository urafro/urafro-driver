// Pure deep-link builders — the actual Linking.openURL is the caller's job, so
// these stay unit-testable.

export function telUrl(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

// Google Maps universal directions link — opens the maps app (or browser) and
// routes to the coordinates on both Android and iOS (ADR-001's nav approach: we
// deep-link, we don't route in-app).
export function mapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}
