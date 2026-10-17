import SwiftUI

@main
struct DispatchApp: App {
    var body: some Scene { WindowGroup { DispatchRoot() } }
}

struct DispatchRoot: View {
    @StateObject private var workspace = Workspace()
    var body: some View {
        TabView {
            OverviewView().tabItem { Label("Overview", systemImage: "square.grid.2x2") }
            ProjectsView().tabItem { Label("Projects", systemImage: "folder") }
            ActivityView().tabItem { Label("Activity", systemImage: "clock") }
        }
        .environmentObject(workspace)
        .tint(.indigo)
    }
}
