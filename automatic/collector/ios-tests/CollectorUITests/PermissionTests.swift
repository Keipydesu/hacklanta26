import XCTest

final class PermissionTests: CollectorUITest {
    func testMockMotionDenialIsVisible() {
        tap("test.motionDenied")
        chooseDemoAndConsent()
        tap("collector.start")
        XCTAssertTrue(waitForText("collector.message", containing: "Motion permission was denied"))
        XCTAssertTrue(waitForText("collector.status", containing: "Not collecting"))
    }

    func testMockLocationDenialIsVisible() {
        tap("test.locationDenied")
        tap("collector.consent")
        tap("collector.start")
        XCTAssertTrue(waitForText("collector.message", containing: "Location permission was denied"))
    }

    func testMockMissingSensorIsVisible() {
        tap("test.noSensor")
        chooseDemoAndConsent()
        tap("collector.start")
        XCTAssertTrue(waitForText("collector.message", containing: "not available"))
    }
}
