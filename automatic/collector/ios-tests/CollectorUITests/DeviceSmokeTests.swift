import XCTest

// Runs only in CollectorDevice, with real Expo sensor bindings and no injected fixtures.
final class DeviceSmokeTests: CollectorUITest {
    func testSignedAppLaunchesAndRequiresConsent() {
        XCTAssertFalse(element("collector.testMode").exists)
        XCTAssertFalse(element("collector.start").isEnabled)
        XCTAssertTrue(waitForText("collector.status", containing: "Not collecting"))
    }
}
