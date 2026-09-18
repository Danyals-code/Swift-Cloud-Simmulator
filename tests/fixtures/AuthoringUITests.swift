import XCTest

final class AuthoringUITests: XCTestCase {
    func testSourceFixtureAndInteraction() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        let count = app.staticTexts["count"]
        XCTAssertTrue(count.waitForExistence(timeout: 15))
        XCTAssertEqual(count.label, "Count 0")
        XCTAssertTrue(app.staticTexts["Catalog"].exists)
        for index in 0..<5 {
            let capture = XCTAttachment(screenshot: app.screenshot())
            capture.name = "authoring-rest-\(index)"
            capture.lifetime = .keepAlways
            add(capture)
        }
        app.buttons["increment"].tap()
        XCTAssertEqual(count.label, "Count 1")
        XCTAssertTrue(app.staticTexts["Updated"].exists)
        let capture = XCTAttachment(screenshot: app.screenshot())
        capture.name = "authoring-after-increment"
        capture.lifetime = .keepAlways
        add(capture)
        let bounds: [String: [String: Double]] = ["count": ["x": count.frame.minX, "y": count.frame.minY, "width": count.frame.width, "height": count.frame.height]]
        let measurements = XCTAttachment(data: try JSONSerialization.data(withJSONObject: bounds, options: .sortedKeys), uniformTypeIdentifier: "public.json")
        measurements.name = "authoring-geometry"
        measurements.lifetime = .keepAlways
        add(measurements)
    }
}
