const path = require("path");

// Monorepo fix: expo-router's automatic app-directory detection fails in this
// pnpm monorepo, and (during `expo export:embed`) nothing inlines the env vars
// used inside its require.context() call — so the production bundle breaks with
// "require.context should be a string" errors. expo-router/_ctx.*.js calls:
//   require.context(EXPO_ROUTER_APP_ROOT, true, /.../, EXPO_ROUTER_IMPORT_MODE)
// We set both values explicitly AND force-inline them with a dedicated Babel
// plugin so they become literal strings at build time.
process.env.EXPO_ROUTER_APP_ROOT =
  process.env.EXPO_ROUTER_APP_ROOT || path.resolve(__dirname, "app");
process.env.EXPO_ROUTER_IMPORT_MODE =
  process.env.EXPO_ROUTER_IMPORT_MODE || "sync";

module.exports = function (api) {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { unstable_transformImportMeta: true }]],
    plugins: [
      [
        "transform-inline-environment-variables",
        { include: ["EXPO_ROUTER_APP_ROOT", "EXPO_ROUTER_IMPORT_MODE"] },
      ],
    ],
  };
};
