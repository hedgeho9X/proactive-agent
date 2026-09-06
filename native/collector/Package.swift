// swift-tools-version: 6.0
import PackageDescription
let package = Package(name: "ProactiveCollector", platforms: [.macOS(.v15)], targets: [.executableTarget(name: "ProactiveCollector", path: "Sources/Collector", swiftSettings: [.swiftLanguageMode(.v5)])])
