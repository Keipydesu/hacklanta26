// Recreates the UI-test target from checked-in sources on every Expo iOS prebuild.
const fs = require('node:fs');
const path = require('node:path');
const { withXcodeProject } = require('@expo/config-plugins');

const APP = 'CampusCollector';
const TARGET = 'CollectorUITests';
const SOURCES = [
  'ConsentLifecycleTests.swift', 'PermissionTests.swift', 'DemoLabelTests.swift',
  'UploadRecoveryTests.swift', 'DeviceSmokeTests.swift', 'Support/CollectorApp.swift',
];
const PLANS = ['CollectorSimulator', 'CollectorDevice'];

function scheme(appId, testId) {
  const buildable = (id, name, product) => `<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="${id}" BuildableName="${product}" BlueprintName="${name}" ReferencedContainer="container:${APP}.xcodeproj"/>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="1600" version="1.3">
  <BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries>
    <BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">${buildable(appId, APP, `${APP}.app`)}</BuildActionEntry>
    <BuildActionEntry buildForTesting="YES" buildForRunning="NO" buildForProfiling="NO" buildForArchiving="NO" buildForAnalyzing="NO">${buildable(testId, TARGET, `${TARGET}.xctest`)}</BuildActionEntry>
  </BuildActionEntries></BuildAction>
  <TestAction buildConfiguration="Release" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.Posix" shouldUseLaunchSchemeArgsEnv="YES">
    <TestPlans>
      <TestPlanReference reference="container:${TARGET}/Plans/CollectorSimulator.xctestplan" default="YES"/>
      <TestPlanReference reference="container:${TARGET}/Plans/CollectorDevice.xctestplan"/>
    </TestPlans>
  </TestAction>
  <LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.Posix" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0">${buildable(appId, APP, `${APP}.app`)}</BuildableProductRunnable></LaunchAction>
  <ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0">${buildable(appId, APP, `${APP}.app`)}</BuildableProductRunnable></ProfileAction>
  <AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>
`;
}

module.exports = function withCollectorTests(config) {
  return withXcodeProject(config, mod => {
    const project = mod.modResults;
    const appId = project.getFirstTarget().uuid;
    const app = project.pbxNativeTargetSection()[appId];
    if (!app) throw new Error(`${APP} app target not found`);
    const existingId = Object.keys(project.pbxNativeTargetSection()).find(id =>
      !id.endsWith('_comment') && project.pbxNativeTargetSection()[id].name?.replaceAll('"', '') === TARGET);
    let test = existingId ? { uuid: existingId, pbxNativeTarget: project.pbxNativeTargetSection()[existingId] } : null;
    if (!test) {
      project.hash.project.objects.PBXTargetDependency ??= {};
      project.hash.project.objects.PBXContainerItemProxy ??= {};
      test = project.addTarget(TARGET, 'unit_test_bundle', TARGET, 'org.hacklanta.campuscollector.uitests');
      test.pbxNativeTarget.productType = '"com.apple.product-type.bundle.ui-testing"';
      const productRef = test.pbxNativeTarget.productReference;
      const reference = project.pbxFileReferenceSection()[productRef];
      reference.name = '"CollectorUITests.xctest"';
      reference.path = '"CollectorUITests.xctest"';
      project.pbxFileReferenceSection()[`${productRef}_comment`] = 'CollectorUITests.xctest';
      test.pbxNativeTarget.productReference_comment = 'CollectorUITests.xctest';
      // xcode's addTarget creates app -> test, which is backwards for UI tests.
      const appDeps = app.dependencies;
      const dependency = appDeps.pop();
      if (dependency) {
        const dep = project.hash.project.objects.PBXTargetDependency[dependency.value];
        delete project.hash.project.objects.PBXContainerItemProxy[dep.targetProxy];
        delete project.hash.project.objects.PBXContainerItemProxy[`${dep.targetProxy}_comment`];
        delete project.hash.project.objects.PBXTargetDependency[dependency.value];
        delete project.hash.project.objects.PBXTargetDependency[`${dependency.value}_comment`];
      }
      project.addTargetDependency(test.uuid, [appId]);
      project.addBuildPhase([], 'PBXSourcesBuildPhase', 'Sources', test.uuid);
      const group = project.addPbxGroup([], TARGET, TARGET);
      const root = project.getPBXGroupByKey(project.hash.project.objects.PBXProject[project.hash.project.rootObject].mainGroup);
      root.children.push({ value: group.uuid, comment: TARGET });
      for (const source of SOURCES) project.addSourceFile(source, { target: test.uuid }, group.uuid);
      for (const plan of PLANS) project.addFile(`Plans/${plan}.xctestplan`, group.uuid);
      const list = project.hash.project.objects.XCConfigurationList[test.pbxNativeTarget.buildConfigurationList];
      for (const configuration of list.buildConfigurations) {
        const settings = project.hash.project.objects.XCBuildConfiguration[configuration.value].buildSettings;
        delete settings.INFOPLIST_FILE;
        settings.GENERATE_INFOPLIST_FILE = 'YES';
        settings.SWIFT_VERSION = '5.0';
        settings.IPHONEOS_DEPLOYMENT_TARGET = '15.1';
        settings.TARGETED_DEVICE_FAMILY = '"1,2"';
        settings.TEST_TARGET_NAME = APP;
        settings.TEST_TARGET_APP_PATH = '"$(BUILT_PRODUCTS_DIR)/CampusCollector.app"';
        settings.CODE_SIGN_STYLE = 'Automatic';
      }
    }

    const ios = mod.modRequest.platformProjectRoot;
    const sourceRoot = path.join(mod.modRequest.projectRoot, 'ios-tests');
    for (const source of SOURCES) {
      const dest = path.join(ios, TARGET, source);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(sourceRoot, 'CollectorUITests', source), dest);
    }
    for (const plan of PLANS) {
      const dest = path.join(ios, TARGET, 'Plans', `${plan}.xctestplan`);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const raw = fs.readFileSync(path.join(sourceRoot, 'Plans', `${plan}.xctestplan`), 'utf8');
      fs.writeFileSync(dest, raw.replaceAll('__APP_TARGET_ID__', appId).replaceAll('__TEST_TARGET_ID__', test.uuid));
    }
    const schemes = path.join(ios, `${APP}.xcodeproj`, 'xcshareddata', 'xcschemes');
    fs.mkdirSync(schemes, { recursive: true });
    fs.writeFileSync(path.join(schemes, `${APP}.xcscheme`), scheme(appId, test.uuid));
    return mod;
  });
};
