import SwiftUI
import Charts

// Native reference fixture for Wave 6e: Swift Charts. Bars (vertical, horizontal, stacked,
// grouped, by day), lines with points, areas, rules, sectors and donuts, hidden axes, a
// y-scale domain, annotations and the legend. One screen per launch, picked with
// `-screen <name>` (the arguments domain of UserDefaults). Each measured view prints
// "MEASURE <name> x y width height" in points, read by launching with
// `simctl launch --console-pty`; a chart's plot area prints as "<name>-plot", and the
// position of each probed value as "<name>-y <value>" or "<name>-x <value>".
// Geometry is in points on a 402 x 874 pt iPhone 18 Pro.

@main
struct NativeChartsApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}

struct RootView: View {
    let screen = UserDefaults.standard.string(forKey: "screen") ?? "bar"

    var body: some View {
        switch screen {
        case "bar": BarScreen()
        case "bar-small": SmallBarScreen()
        case "bar-horizontal": HorizontalBarScreen()
        case "bar-stacked": StackedBarScreen(hidesLegend: false)
        case "bar-grouped": GroupedBarScreen()
        case "bar-dates": DateBarScreen()
        case "palette": PaletteScreen()
        case "line": LineScreen()
        case "line-numeric": NumericLineScreen()
        case "line-series": SeriesLineScreen()
        case "area": AreaScreen()
        case "rule": RuleScreen()
        case "sector": SectorScreen(inner: 0, inset: 0)
        case "donut": SectorScreen(inner: 0.6, inset: 1.5)
        case "hidden": HiddenAxesScreen()
        case "legend-hidden": StackedBarScreen(hidesLegend: true)
        case "domain": DomainScreen()
        case "annotation": AnnotationScreen()
        case "plain": PlainChartScreen()
        case "fonts": FontsScreen()
        case "scroll": ScrollChartScreen()
        case "dates-3": DaysScreen(count: 3)
        case "dates-14": DaysScreen(count: 14)
        case "dates-30": DaysScreen(count: 30)
        case "ticks": TicksScreen(values: [[9], [1], [0.8], [95], [130], [47], [3], [-3, 7]])
        case "ticks-more": TicksScreen(values: [[12], [17], [33], [0.3], [250], [1800], [4.5], [-40, 15]])
        case "hourly-line": TimeLineScreen(points: hourly, name: "hourly")
        case "daily-line": TimeLineScreen(points: dates, name: "daily")
        case "monthly-bars": TimeBarScreen(points: monthly, name: "monthly")
        case "daily-bars": TimeBarScreen(points: dates, name: "daily")
        case "sector-top": SectorTopScreen()
        case "rule-annotation": RuleAnnotationScreen()
        case "xscale-category": CategoryDomainScreen()
        case "xscale-date": DateDomainScreen()
        case "stack-order": StackOrderScreen()
        case "gradient": GradientScreen()
        case "empty": EmptyScreen()
        default: Text("Unknown screen: \(screen)")
        }
    }
}

extension View {
    /// Prints the view's frame in the window, once it is laid out.
    func measure(_ name: String) -> some View {
        onGeometryChange(for: CGRect.self) { proxy in
            proxy.frame(in: .global)
        } action: { frame in
            print("MEASURE \(name) \(frame.minX) \(frame.minY) \(frame.width) \(frame.height)")
        }
    }

    /// Prints a chart's plot area, and where the values given land in the window.
    func plotProbe(_ name: String, ys: [Double] = [], xs: [String] = [], xn: [Double] = [], ysCategory: [String] = [], xd: [Date] = []) -> some View {
        chartOverlay { proxy in
            GeometryReader { geometry in
                Color.clear.onGeometryChange(for: CGRect.self) { inner in
                    inner.frame(in: .global)
                } action: { global in
                    guard let anchor = proxy.plotFrame else { return }
                    let plot = geometry[anchor]
                    print("MEASURE \(name)-plot \(global.minX + plot.minX) \(global.minY + plot.minY) \(plot.width) \(plot.height)")
                    for value in ys {
                        if let y = proxy.position(forY: value) { print("MEASURE \(name)-y \(value) \(global.minY + plot.minY + y) 0 0") }
                    }
                    for value in ysCategory {
                        if let y = proxy.position(forY: value) { print("MEASURE \(name)-y \(value) \(global.minY + plot.minY + y) 0 0") }
                    }
                    for value in xs {
                        if let x = proxy.position(forX: value) { print("MEASURE \(name)-x \(value) \(global.minX + plot.minX + x) 0 0") }
                    }
                    for value in xn {
                        if let x = proxy.position(forX: value) { print("MEASURE \(name)-x \(value) \(global.minX + plot.minX + x) 0 0") }
                    }
                    for value in xd {
                        if let x = proxy.position(forX: value) { print("MEASURE \(name)-x \(value.timeIntervalSince1970) \(global.minX + plot.minX + x) 0 0") }
                    }
                }
            }
        }
    }
}

/// A title over a chart 240 pt tall, in the padded column every screen uses.
struct Titled<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.headline).measure("title")
            content.frame(height: 240).measure("chart")
            Spacer()
        }
        .padding()
    }
}

// MARK: - Data

struct Day: Identifiable {
    let id: Int
    let day: String
    let steps: Double
}

let week = [
    Day(id: 0, day: "Mon", steps: 4200),
    Day(id: 1, day: "Tue", steps: 6100),
    Day(id: 2, day: "Wed", steps: 8800),
    Day(id: 3, day: "Thu", steps: 5300),
    Day(id: 4, day: "Fri", steps: 7400),
]

struct Sale: Identifiable {
    let id: Int
    let month: String
    let product: String
    let amount: Double
}

let sales = [
    Sale(id: 0, month: "Jan", product: "Coffee", amount: 30),
    Sale(id: 1, month: "Jan", product: "Tea", amount: 20),
    Sale(id: 2, month: "Jan", product: "Juice", amount: 10),
    Sale(id: 3, month: "Feb", product: "Coffee", amount: 40),
    Sale(id: 4, month: "Feb", product: "Tea", amount: 15),
    Sale(id: 5, month: "Feb", product: "Juice", amount: 25),
    Sale(id: 6, month: "Mar", product: "Coffee", amount: 35),
    Sale(id: 7, month: "Mar", product: "Tea", amount: 30),
    Sale(id: 8, month: "Mar", product: "Juice", amount: 5),
]

struct Hour: Identifiable {
    let id: Int
    let hour: Int
    let temperature: Double
}

let hours = [
    Hour(id: 0, hour: 0, temperature: 12),
    Hour(id: 1, hour: 3, temperature: 10),
    Hour(id: 2, hour: 6, temperature: 11),
    Hour(id: 3, hour: 9, temperature: 16),
    Hour(id: 4, hour: 12, temperature: 21),
    Hour(id: 5, hour: 15, temperature: 23),
    Hour(id: 6, hour: 18, temperature: 19),
    Hour(id: 7, hour: 21, temperature: 15),
]

struct Share: Identifiable {
    let id: Int
    let name: String
    let amount: Double
}

let shares = [
    Share(id: 0, name: "Rent", amount: 45),
    Share(id: 1, name: "Food", amount: 25),
    Share(id: 2, name: "Travel", amount: 15),
    Share(id: 3, name: "Other", amount: 15),
]

/// 15 June 2026 and the six days after it, at noon in the device's own time zone.
let dates: [(Date, Double)] = (0..<7).map { offset in
    let day = Calendar.current.date(from: DateComponents(year: 2026, month: 6, day: 15 + offset, hour: 12))!
    return (day, [3, 5, 4, 7, 6, 2, 8][offset])
}

/// 15 June 2026 from 9:00 to 14:00, each hour, in the device's own time zone.
let hourly: [(Date, Double)] = (0..<6).map { hour in
    (Calendar.current.date(from: DateComponents(year: 2026, month: 6, day: 15, hour: 9 + hour))!, [12, 15, 14, 18, 21, 19][hour])
}

/// The first of each month, January to June 2026.
let monthly: [(Date, Double)] = (0..<6).map { month in
    (Calendar.current.date(from: DateComponents(year: 2026, month: 1 + month, day: 1))!, [30, 42, 38, 51, 47, 60][month])
}

/// Sales whose series come in a different order in each month: Coffee, Tea and Juice are first seen in that order.
let mixed = [
    Sale(id: 0, month: "Jan", product: "Coffee", amount: 30),
    Sale(id: 1, month: "Jan", product: "Tea", amount: 20),
    Sale(id: 2, month: "Feb", product: "Juice", amount: 25),
    Sale(id: 3, month: "Feb", product: "Tea", amount: 15),
    Sale(id: 4, month: "Feb", product: "Coffee", amount: 40),
    Sale(id: 5, month: "Mar", product: "Tea", amount: 30),
    Sale(id: 6, month: "Mar", product: "Juice", amount: 5),
    Sale(id: 7, month: "Mar", product: "Coffee", amount: 35),
]

let none: [Day] = []

// MARK: - Bars

struct BarScreen: View {
    var body: some View {
        Titled(title: "Steps") {
            Chart(week) { item in
                BarMark(x: .value("Day", item.day), y: .value("Steps", item.steps))
            }
            .plotProbe("bar", ys: [0, 2000, 4000, 6000, 8000, 10000], xs: ["Mon", "Fri"])
        }
    }
}

/// Literal marks, with values too small for thousands: how ticks step through 0 to 5.
struct SmallBarScreen: View {
    var body: some View {
        Titled(title: "Small") {
            Chart {
                BarMark(x: .value("Day", "A"), y: .value("Count", 3))
                BarMark(x: .value("Day", "B"), y: .value("Count", 5))
                BarMark(x: .value("Day", "C"), y: .value("Count", 2))
            }
            .plotProbe("small", ys: [0, 1, 2, 3, 4, 5, 6], xs: ["A", "C"])
        }
    }
}

struct HorizontalBarScreen: View {
    var body: some View {
        Titled(title: "Horizontal") {
            Chart(week) { item in
                BarMark(x: .value("Steps", item.steps), y: .value("Day", item.day))
            }
            .plotProbe("horizontal", xn: [0, 2000, 4000, 6000, 8000, 10000], ysCategory: ["Mon", "Fri"])
        }
    }
}

struct StackedBarScreen: View {
    let hidesLegend: Bool

    var body: some View {
        Titled(title: "Stacked") {
            if hidesLegend {
                Chart(sales) { item in
                    BarMark(x: .value("Month", item.month), y: .value("Sales", item.amount))
                        .foregroundStyle(by: .value("Product", item.product))
                }
                .chartLegend(.hidden)
                .plotProbe("stacked", ys: [0, 20, 40, 60, 80], xs: ["Jan", "Mar"])
            } else {
                Chart(sales) { item in
                    BarMark(x: .value("Month", item.month), y: .value("Sales", item.amount))
                        .foregroundStyle(by: .value("Product", item.product))
                }
                .plotProbe("stacked", ys: [0, 20, 40, 60, 80], xs: ["Jan", "Mar"])
            }
        }
    }
}

struct GroupedBarScreen: View {
    var body: some View {
        Titled(title: "Grouped") {
            Chart(sales) { item in
                BarMark(x: .value("Month", item.month), y: .value("Sales", item.amount))
                    .foregroundStyle(by: .value("Product", item.product))
                    .position(by: .value("Product", item.product))
            }
            .plotProbe("grouped", ys: [0, 10, 20, 30, 40], xs: ["Jan", "Mar"])
        }
    }
}

struct DateBarScreen: View {
    var body: some View {
        Titled(title: "By day") {
            Chart {
                ForEach(dates, id: \.0) { entry in
                    BarMark(x: .value("Day", entry.0, unit: .day), y: .value("Count", entry.1))
                }
            }
            .plotProbe("dates", ys: [0, 2, 4, 6, 8])
        }
    }
}

/// Ten series, one bar each: Charts' default palette in order, and the legend's wrap.
struct PaletteScreen: View {
    let names = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]

    var body: some View {
        Titled(title: "Palette") {
            Chart {
                ForEach(names, id: \.self) { name in
                    BarMark(x: .value("Name", name), y: .value("Value", 5))
                        .foregroundStyle(by: .value("Series", name))
                }
            }
            .plotProbe("palette", ys: [0, 5], xs: ["A", "J"])
        }
    }
}

// MARK: - Lines and areas

struct LineScreen: View {
    var body: some View {
        Titled(title: "Line") {
            Chart(week) { item in
                LineMark(x: .value("Day", item.day), y: .value("Steps", item.steps))
                PointMark(x: .value("Day", item.day), y: .value("Steps", item.steps))
            }
            .plotProbe("line", ys: [0, 2000, 4000, 6000, 8000, 10000], xs: ["Mon", "Wed", "Fri"])
        }
    }
}

struct NumericLineScreen: View {
    var body: some View {
        Titled(title: "Numeric") {
            Chart(hours) { item in
                LineMark(x: .value("Hour", item.hour), y: .value("Temperature", item.temperature))
                RuleMark(x: .value("Noon", 12))
            }
            .plotProbe("numeric", ys: [0, 5, 10, 15, 20, 25], xn: [0, 5, 10, 15, 20, 21])
        }
    }
}

struct SeriesLineScreen: View {
    var body: some View {
        Titled(title: "Series") {
            Chart(sales) { item in
                LineMark(x: .value("Month", item.month), y: .value("Sales", item.amount))
                    .foregroundStyle(by: .value("Product", item.product))
            }
            .plotProbe("series", ys: [0, 10, 20, 30, 40], xs: ["Jan", "Mar"])
        }
    }
}

struct AreaScreen: View {
    var body: some View {
        Titled(title: "Area") {
            Chart(week) { item in
                AreaMark(x: .value("Day", item.day), y: .value("Steps", item.steps))
            }
            .plotProbe("area", ys: [0, 2000, 4000, 6000, 8000, 10000], xs: ["Mon", "Fri"])
        }
    }
}

struct RuleScreen: View {
    var body: some View {
        Titled(title: "Rule") {
            Chart {
                ForEach(week) { item in
                    BarMark(x: .value("Day", item.day), y: .value("Steps", item.steps))
                }
                RuleMark(y: .value("Goal", 6000))
            }
            .plotProbe("rule", ys: [0, 6000, 10000], xs: ["Mon", "Fri"])
        }
    }
}

// MARK: - Sectors

struct SectorScreen: View {
    let inner: Double
    let inset: Double

    var body: some View {
        Titled(title: inner > 0 ? "Donut" : "Sector") {
            Chart(shares) { item in
                SectorMark(angle: .value("Amount", item.amount), innerRadius: .ratio(inner), angularInset: inset)
                    .foregroundStyle(by: .value("Name", item.name))
                    .annotation(position: .overlay) {
                        Text("\(Int(item.amount))").font(.caption).measure("label-\(item.name)")
                    }
            }
            .plotProbe(inner > 0 ? "donut" : "sector")
        }
    }
}

// MARK: - Modifiers

struct HiddenAxesScreen: View {
    var body: some View {
        Titled(title: "Hidden") {
            Chart(week) { item in
                BarMark(x: .value("Day", item.day), y: .value("Steps", item.steps))
            }
            .chartXAxis(.hidden)
            .chartYAxis(.hidden)
            .plotProbe("hidden", ys: [0, 8800], xs: ["Mon", "Fri"])
        }
    }
}

struct DomainScreen: View {
    var body: some View {
        Titled(title: "Domain") {
            Chart(week) { item in
                BarMark(x: .value("Day", item.day), y: .value("Steps", item.steps))
            }
            .chartYScale(domain: 0...20000)
            .plotProbe("domain", ys: [0, 5000, 10000, 15000, 20000], xs: ["Mon", "Fri"])
        }
    }
}

struct AnnotationScreen: View {
    var body: some View {
        Titled(title: "Annotation") {
            Chart(week) { item in
                BarMark(x: .value("Day", item.day), y: .value("Steps", item.steps))
                    .annotation(position: .top) {
                        Text("\(Int(item.steps))").font(.caption).measure("top-\(item.day)")
                    }
            }
            .plotProbe("annotation", ys: [0, 10000], xs: ["Mon", "Fri"])
        }
    }
}

/// A bar chart with no title and no frame, the size Charts takes on its own in a padded stack.
struct PlainChartScreen: View {
    var body: some View {
        VStack {
            Chart(week) { item in
                BarMark(x: .value("Day", item.day), y: .value("Steps", item.steps))
            }
            .measure("chart")
            .plotProbe("plain", ys: [0, 10000], xs: ["Mon", "Fri"])
        }
        .padding()
    }
}

/// One bar per chart, at a range of tops: where Charts puts its ticks for each.
struct TicksScreen: View {
    let values: [[Double]]

    var body: some View {
        VStack(spacing: 8) {
            ForEach(0..<values.count / 2, id: \.self) { row in
                HStack(spacing: 16) {
                    ForEach(0..<2, id: \.self) { column in
                        let tops = values[row * 2 + column]
                        Chart {
                            ForEach(tops.indices, id: \.self) { index in
                                BarMark(x: .value("Key", "\(index)"), y: .value("Value", tops[index]))
                            }
                        }
                        .frame(height: 170)
                    }
                }
            }
        }
        .padding()
    }
}

/// Axis and legend words as plain Text, for their widths and where their ink sits in the line.
struct FontsScreen: View {
    let words = ["10,000", "20,000", "7,500", "80", "30", "40", "8", "6", "Mon", "Jun 15", "Coffee"]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(words, id: \.self) { word in
                HStack(spacing: 20) {
                    Text(word).font(.caption2).foregroundStyle(.secondary).measure("caption2 \(word)")
                    Text(word).font(.caption).foregroundStyle(.secondary).measure("caption \(word)")
                    Text(word).font(.footnote).foregroundStyle(.secondary).measure("footnote \(word)")
                }
            }
        }
        .padding()
    }
}

/// A chart in a ScrollView with no frame: the height Charts takes when nothing proposes one.
struct ScrollChartScreen: View {
    var body: some View {
        ScrollView {
            VStack {
                Chart(week) { item in
                    BarMark(x: .value("Day", item.day), y: .value("Steps", item.steps))
                }
                .measure("chart")
            }
            .padding()
        }
    }
}

/// Bars by day over 3, 14 and 30 days: which days the axis labels.
struct DaysScreen: View {
    let count: Int

    var body: some View {
        Titled(title: "\(count) days") {
            Chart {
                ForEach(0..<count, id: \.self) { offset in
                    BarMark(
                        x: .value("Day", Calendar.current.date(from: DateComponents(year: 2026, month: 6, day: 15 + offset, hour: 12))!, unit: .day),
                        y: .value("Count", Double(offset % 5 + 2))
                    )
                }
            }
            .plotProbe("days")
        }
    }
}

// MARK: - Fixes (Wave 6e review)

/// Dates with no unit: how a line through them is spaced.
struct TimeLineScreen: View {
    let points: [(Date, Double)]
    let name: String

    var body: some View {
        Titled(title: "Times") {
            Chart {
                ForEach(points, id: \.0) { entry in
                    LineMark(x: .value("Time", entry.0), y: .value("Value", entry.1))
                    PointMark(x: .value("Time", entry.0), y: .value("Value", entry.1))
                }
            }
            .plotProbe(name, ys: [0, 10, 20, 30, 40, 50, 60], xd: points.map(\.0))
        }
    }
}

/// Dates with no unit under bars: how wide each bar is.
struct TimeBarScreen: View {
    let points: [(Date, Double)]
    let name: String

    var body: some View {
        Titled(title: "Bars") {
            Chart {
                ForEach(points, id: \.0) { entry in
                    BarMark(x: .value("Time", entry.0), y: .value("Value", entry.1))
                }
            }
            .plotProbe(name, ys: [0, 2, 4, 6, 8, 20, 40, 60], xd: points.map(\.0))
        }
    }
}

struct SectorTopScreen: View {
    var body: some View {
        Titled(title: "Sector top") {
            Chart(shares) { item in
                SectorMark(angle: .value("Amount", item.amount))
                    .foregroundStyle(by: .value("Name", item.name))
                    .annotation(position: .top) {
                        Text("\(Int(item.amount))").font(.caption).measure("top-\(item.name)")
                    }
            }
            .plotProbe("sectortop")
        }
    }
}

struct RuleAnnotationScreen: View {
    var body: some View {
        Titled(title: "Rule note") {
            Chart {
                ForEach(week) { item in
                    BarMark(x: .value("Day", item.day), y: .value("Steps", item.steps))
                }
                RuleMark(y: .value("Goal", 6000))
                    .annotation(position: .top) {
                        Text("Goal").font(.caption).measure("goal")
                    }
                RuleMark(x: .value("Day", "Wed"))
                    .annotation(position: .top) {
                        Text("Mid").font(.caption).measure("mid")
                    }
            }
            .plotProbe("rulenote", ys: [0, 6000, 10000], xs: ["Mon", "Wed", "Fri"])
        }
    }
}

struct CategoryDomainScreen: View {
    var body: some View {
        Titled(title: "Categories") {
            Chart(week) { item in
                BarMark(x: .value("Day", item.day), y: .value("Steps", item.steps))
            }
            .chartXScale(domain: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"])
            .plotProbe("xcategory", ys: [0, 10000], xs: ["Mon", "Fri", "Sun"])
        }
    }
}

struct DateDomainScreen: View {
    let from = Calendar.current.date(from: DateComponents(year: 2026, month: 6, day: 13))!
    let to = Calendar.current.date(from: DateComponents(year: 2026, month: 6, day: 24))!

    var body: some View {
        Titled(title: "Date domain") {
            Chart {
                ForEach(dates, id: \.0) { entry in
                    BarMark(x: .value("Day", entry.0, unit: .day), y: .value("Count", entry.1))
                }
            }
            .chartXScale(domain: from...to)
            .plotProbe("xdate", ys: [0, 8], xd: [from, to] + dates.map(\.0))
        }
    }
}

struct StackOrderScreen: View {
    var body: some View {
        Titled(title: "Stack order") {
            Chart(mixed) { item in
                BarMark(x: .value("Month", item.month), y: .value("Sales", item.amount))
                    .foregroundStyle(by: .value("Product", item.product))
            }
            .plotProbe("order", ys: [0, 20, 40, 60, 80], xs: ["Jan", "Feb", "Mar"])
        }
    }
}

struct GradientScreen: View {
    var body: some View {
        Titled(title: "Gradient") {
            Chart {
                ForEach(week) { item in
                    LineMark(x: .value("Day", item.day), y: .value("Steps", item.steps))
                        .foregroundStyle(LinearGradient(colors: [.red, .blue], startPoint: .leading, endPoint: .trailing))
                }
                RuleMark(y: .value("Goal", 2000))
                    .foregroundStyle(LinearGradient(colors: [.green, .orange], startPoint: .leading, endPoint: .trailing))
            }
            .plotProbe("gradient", ys: [0, 2000, 10000], xs: ["Mon", "Fri"])
        }
    }
}

struct EmptyScreen: View {
    var body: some View {
        Titled(title: "Empty") {
            Chart(none) { item in
                BarMark(x: .value("Day", item.day), y: .value("Steps", item.steps))
            }
            .plotProbe("empty", ys: [0, 0.5, 1, 10], xs: ["Mon"])
        }
    }
}
