const path = require("path");

// Absolute path to the expo-router app directory (resolved on whatever machine
// Babel runs on — locally or on the EAS build worker).
const APP_ROOT_ABS = path.resolve(__dirname, "app");

// Monorepo fix for expo-router in production (`expo export:embed`).
//
// expo-router/_ctx.*.js calls:
//   require.context(process.env.EXPO_ROUTER_APP_ROOT, true, /.../, process.env.EXPO_ROUTER_IMPORT_MODE)
// In this pnpm monorepo, babel-preset-expo's own expo-router plugin does NOT
// inline these when bundling for production, so the build either errors
// ("require.context should be a string") or ships an empty route table
// ("No routes found") if inlined incorrectly.
//
// babel-preset-expo inlines EXPO_ROUTER_APP_ROOT as a *relative* path from the
// file being transformed to the app dir — NOT an absolute path (Metro's
// require.context globs relative to the requiring file, so an absolute path
// matches nothing). We replicate that exact behaviour here, per-file, which is
// correct no matter where expo-router is hoisted.
function inlineExpoRouterEnv({ types: t }) {
  const isProcessEnv = (node, name) =>
    t.isMemberExpression(node) &&
    t.isMemberExpression(node.object) &&
    t.isIdentifier(node.object.object, { name: "process" }) &&
    t.isIdentifier(node.object.property, { name: "env" }) &&
    ((!node.computed && t.isIdentifier(node.property, { name })) ||
      (node.computed && t.isStringLiteral(node.property, { value: name })));

  return {
    name: "inline-expo-router-env",
    visitor: {
      MemberExpression(p, state) {
        const filename = state.filename || (state.file && state.file.opts.filename);
        if (isProcessEnv(p.node, "EXPO_ROUTER_APP_ROOT")) {
          if (!filename) return;
          // Relative path from the current file to the app dir, POSIX-style
          // (build runs on Linux; forward slashes are what Metro expects).
          const rel =
            path.relative(path.dirname(filename), APP_ROOT_ABS).split(path.sep).join("/") || ".";
          p.replaceWith(t.stringLiteral(rel));
        } else if (isProcessEnv(p.node, "EXPO_ROUTER_IMPORT_MODE")) {
          p.replaceWith(t.stringLiteral("sync"));
        }
      },
    },
  };
}

module.exports = function (api) {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { unstable_transformImportMeta: true }]],
    plugins: [inlineExpoRouterEnv],
  };
};
