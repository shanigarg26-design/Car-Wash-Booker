const path = require("path");

// Monorepo fix: expo-router's automatic app-directory detection fails in this
// pnpm monorepo, and (during `expo export:embed`) nothing inlines
// process.env.EXPO_ROUTER_APP_ROOT — so its require.context() call breaks the
// production bundle. We set the value explicitly AND force-inline it with a
// dedicated Babel plugin so it becomes a literal string at build time.
process.env.EXPO_ROUTER_APP_ROOT =
  process.env.EXPO_ROUTER_APP_ROOT || path.resolve(__dirname, "app");

module.exports = function (api) {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { unstable_transformImportMeta: true }]],
    plugins: [
      [
        "transform-inline-environment-variables",
        { include: ["EXPO_ROUTER_APP_ROOT"] },
      ],
    ],
  };
};
