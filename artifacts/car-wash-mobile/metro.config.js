const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Watch the entire pnpm workspace root so Metro can resolve the .pnpm virtual store
config.watchFolders = [workspaceRoot];

// Tell Metro where to find modules — project node_modules first, then workspace root
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// Follow pnpm symlinks correctly
config.resolver.unstable_enableSymlinks = true;

module.exports = config;
