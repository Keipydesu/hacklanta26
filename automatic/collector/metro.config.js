// The detector lives outside this Expo project (../detector) and uses Node-style ".js" import
// specifiers for its TypeScript modules. Watch that folder and map those specifiers for Metro.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const detector = path.resolve(__dirname, '../detector');

config.watchFolders = [...(config.watchFolders ?? []), detector];

const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = upstream ?? context.resolveRequest;
  const fromDetector = context.originModulePath.startsWith(detector + path.sep);
  if (fromDetector && /^\.{1,2}\/.+\.js$/.test(moduleName)) {
    return resolve(context, moduleName.slice(0, -3), platform);
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
