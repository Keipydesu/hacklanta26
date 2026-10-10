import XCTest

class CollectorUITest: XCTestCase {
    var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.staticTexts["collector.ready"].waitForExistence(timeout: 30))
        if app.staticTexts["collector.testMode"].exists {
            tap("test.reset")
            XCTAssertTrue(waitForText("test.outcome", containing: "reset"))
            app.terminate()
            app.launch()
            XCTAssertTrue(app.staticTexts["collector.ready"].waitForExistence(timeout: 30))
        }
    }

    func element(_ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    func tap(_ id: String) {
        let target = element(id)
        XCTAssertTrue(target.waitForExistence(timeout: 10), "Missing \(id)")
        for _ in 0..<8 where !target.isHittable { app.scrollViews.firstMatch.swipeUp() }
        XCTAssertTrue(target.isHittable, "Not hittable: \(id)")
        target.tap()
    }

    func waitForText(_ id: String, containing value: String, timeout: TimeInterval = 10) -> Bool {
        let item = element(id)
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@", value), object: item)
        return XCTWaiter.wait(for: [expectation], timeout: timeout) == .completed
    }

    func chooseDemoAndConsent() {
        tap("collector.demoMode")
        tap("collector.consent")
    }

    func requestLog(expectedCount: Int = 1) throws -> [[String: Any]] {
        for _ in 0..<10 {
            tap("test.refresh")
            if waitForText("test.requestCount", containing: "Stub requests: \(expectedCount)", timeout: 2) { break }
        }
        XCTAssertTrue(waitForText("test.requestCount", containing: "Stub requests: \(expectedCount)"))
        let label = element("test.requestLog").label
        let data = try XCTUnwrap(label.data(using: .utf8))
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [[String: Any]])
    }
}
