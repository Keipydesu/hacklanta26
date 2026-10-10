import XCTest

final class ConsentLifecycleTests: CollectorUITest {
    func testFreshConsentAndRepeatedStops() {
        XCTAssertFalse(element("collector.start").isEnabled)
        chooseDemoAndConsent()
        tap("collector.start")
        XCTAssertTrue(waitForText("collector.status", containing: "Collecting"))
        tap("collector.stop")
        XCTAssertTrue(waitForText("collector.status", containing: "Not collecting"))
        XCTAssertFalse(element("collector.start").isEnabled, "A new ride must require fresh consent")
        tap("collector.consent")
        tap("collector.start")
        XCTAssertTrue(waitForText("collector.status", containing: "Collecting"))
        tap("collector.stop")
    }

    func testForegroundExitDoesNotResumeSensing() {
        chooseDemoAndConsent()
        tap("collector.start")
        XCTAssertTrue(waitForText("collector.status", containing: "Collecting"))
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertTrue(waitForText("collector.status", containing: "Not collecting"))
        XCTAssertFalse(element("collector.start").isEnabled)
    }
}
