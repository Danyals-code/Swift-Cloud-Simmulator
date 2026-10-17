import SwiftUI

/// One instance, reached from every tab: saving on the detail screen changes the Saved tab.
final class TrailStore: ObservableObject {
    @Published var savedNames = ["Heather Meadows"]

    let trails = [
        Trail(name: "Cascade Ridge", region: "North Cascades", miles: 8.4, ascent: 2900, difficulty: .hard, symbol: "mountain.2",
              summary: "A long climb through old growth to a ridge above three valleys."),
        Trail(name: "Heather Meadows", region: "Mount Baker", miles: 3.1, ascent: 620, difficulty: .easy, symbol: "leaf",
              summary: "An easy loop through subalpine meadows, best in late August."),
        Trail(name: "Blue Lake Basin", region: "Okanogan", miles: 5.6, ascent: 1250, difficulty: .moderate, symbol: "drop",
              summary: "Switchbacks to a cold lake under granite spires. Busy after ten."),
        Trail(name: "Sun Point", region: "Methow", miles: 2.2, ascent: 400, difficulty: .easy, symbol: "sun.max",
              summary: "A short walk to a south-facing bench that stays warm into October."),
        Trail(name: "Granite Pass", region: "North Cascades", miles: 11.0, ascent: 3400, difficulty: .hard, symbol: "bolt",
              summary: "The long way in. Snow lingers on the north side until mid July."),
        Trail(name: "Rainy Tarn", region: "Okanogan", miles: 4.3, ascent: 880, difficulty: .moderate, symbol: "drop",
              summary: "A short steep pull to a tarn that holds the light until late."),
        Trail(name: "Larch Hollow", region: "Methow", miles: 6.8, ascent: 1600, difficulty: .moderate, symbol: "tree",
              summary: "Golden for two weeks in October and quiet for the other fifty."),
        Trail(name: "Cutthroat Lake", region: "North Cascades", miles: 3.8, ascent: 500, difficulty: .easy, symbol: "drop",
              summary: "Flat to the lake, then as far up the basin as the light allows.")
    ]

    /// The filter belongs to the screen looking at the list, not to the model.
    func results(matching query: String, within limit: Double) -> [Trail] {
        return trails.filter { trail in
            let needle = query.lowercased()
            let matches = needle.isEmpty
                || trail.name.lowercased().contains(needle)
                || trail.region.lowercased().contains(needle)
            return matches && trail.miles <= limit
        }
    }

    var featured: [Trail] {
        return trails.filter { trail in
            return trail.ascent >= 1000
        }
    }

    var saved: [Trail] {
        return trails.filter { trail in
            return savedNames.contains(trail.name)
        }
    }

    func isSaved(_ trail: Trail) -> Bool {
        return savedNames.contains(trail.name)
    }

    func toggleSaved(_ trail: Trail) {
        if let index = savedNames.firstIndex(of: trail.name) {
            savedNames.remove(at: index)
        } else {
            savedNames.append(trail.name)
        }
    }
}
