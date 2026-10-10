import XCTest

final class UploadRecoveryTests: CollectorUITest {
    func testUnknownOutcomeRetriesIdenticalBodyAfterRelaunch() throws {
        tap("test.unknown")
        XCTAssertTrue(waitForText("test.outcome", containing: "unknown"))
        chooseDemoAndConsent()
        tap("collector.start")
        tap("test.demoJerk")
        XCTAssertTrue(waitForText("collector.detected", containing: "1"))
        tap("collector.stop")
        let first = try requestLog()
        XCTAssertEqual(first.count, 1)
        tap("test.accept")
        XCTAssertTrue(waitForText("test.outcome", containing: "accept"))
        app.terminate()
        app.launch()
        XCTAssertTrue(app.staticTexts["collector.ready"].waitForExistence(timeout: 30))
        let second = try requestLog(expectedCount: 2)
        XCTAssertEqual(second.count, 2)
        XCTAssertEqual(first[0]["path"] as? String, second[1]["path"] as? String)
        XCTAssertEqual(first[0]["body"] as? String, second[1]["body"] as? String)
    }

    func testConflictIsTerminalAndVisible() throws {
        tap("test.conflict")
        XCTAssertTrue(waitForText("test.outcome", containing: "409"))
        chooseDemoAndConsent()
        tap("collector.start")
        tap("test.demoJerk")
        XCTAssertTrue(waitForText("collector.detected", containing: "1"))
        tap("collector.stop")
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "rejected by the server")).firstMatch.waitForExistence(timeout: 10))
        XCTAssertEqual(try requestLog().count, 1)
    }

    func testInvalidBatchIsTerminalAndVisible() throws {
        tap("test.invalid")
        XCTAssertTrue(waitForText("test.outcome", containing: "422"))
        chooseDemoAndConsent()
        tap("collector.start")
        tap("test.demoJerk")
        XCTAssertTrue(waitForText("collector.detected", containing: "1"))
        tap("collector.stop")
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "rejected by the server")).firstMatch.waitForExistence(timeout: 10))
        XCTAssertEqual(try requestLog().count, 1)
    }
}
