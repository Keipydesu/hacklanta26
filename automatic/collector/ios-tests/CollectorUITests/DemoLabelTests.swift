import XCTest

final class DemoLabelTests: CollectorUITest {
    func testInjectedDemoEventIsSimulatedAndEventOnly() throws {
        chooseDemoAndConsent()
        XCTAssertTrue(element("collector.demoBadge").exists)
        tap("collector.start")
        tap("test.demoJerk")
        XCTAssertTrue(waitForText("collector.detected", containing: "1"))
        tap("collector.stop")
        let requests = try requestLog()
        XCTAssertEqual(requests.count, 1)
        XCTAssertEqual(requests[0]["path"] as? String, "/v1/events")
        let body = try XCTUnwrap((requests[0]["body"] as? String)?.data(using: .utf8))
        let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        let events = try XCTUnwrap(payload["events"] as? [[String: Any]])
        XCTAssertEqual(events.count, 1)
        XCTAssertEqual(events[0]["source"] as? String, "simulated")
        XCTAssertNil(payload["points"])
        XCTAssertNil(events[0]["ax"], "Raw motion must never enter the observation body")
    }

    func testRecordingRequiresSeparateOptInAndNeverChangesRequestShape() throws {
        chooseDemoAndConsent()
        tap("collector.start")
        XCTAssertFalse(element("collector.status").label.contains("recording locally"))
        tap("collector.stop")
        tap("collector.consent")
        tap("collector.record")
        tap("collector.start")
        XCTAssertTrue(waitForText("collector.status", containing: "recording locally"))
        tap("test.demoJerk")
        XCTAssertTrue(waitForText("collector.detected", containing: "1"))
        tap("collector.stop")
        let requests = try requestLog()
        XCTAssertEqual(requests.count, 1)
        let body = try XCTUnwrap((requests[0]["body"] as? String)?.data(using: .utf8))
        let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual(Set(payload.keys), Set(["events"]))
    }
}
