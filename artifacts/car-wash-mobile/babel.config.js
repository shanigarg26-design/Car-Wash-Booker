const path = require("path");

// Monorepo fix: expo-router's automatic app-directory detection fails in this
// pnpm monorepo, which breaks its route scanning (require.context) during the
// production build. Set the app root explicitly so it always resolves correctly.
process.env.EXPO_ROUTER_APP_ROOT =
  process.env.EXPO_ROUTER_APP_ROOT || path.resolve(__dirname, "app");

module.exports = function (api) {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { unstable_transformImportMeta: true }]],
  };
};
