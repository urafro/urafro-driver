// jest mock for @expo/vector-icons — its real entry pulls expo-font (native), which
// doesn't resolve under jest. Every icon set (Feather, etc.) becomes a no-op component.
module.exports = new Proxy(
  { __esModule: true },
  { get: () => () => null },
);
