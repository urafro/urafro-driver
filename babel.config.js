// Expo's babel preset — used by Metro (app builds) and jest-expo (component tests).
// Matches Expo's default; making it explicit lets jest-expo transform RN/Expo source.
module.exports = function (api) {
  api.cache(true);
  return { presets: ['babel-preset-expo'] };
};
