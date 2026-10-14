// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "Jaffloop",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "Jaffloop", targets: ["Jaffloop"]),
        .executable(name: "jaffloop-mcp", targets: ["jaffloop-mcp"]),
    ],
    dependencies: [
        .package(url: "https://github.com/groue/GRDB.swift.git", from: "6.29.0"),
    ],
    targets: [
        .target(name: "JaffloopCore", dependencies: [.product(name: "GRDB", package: "GRDB.swift")]),
        .executableTarget(name: "Jaffloop", dependencies: ["JaffloopCore"]),
        .executableTarget(name: "jaffloop-mcp", dependencies: ["JaffloopCore"]),
        .testTarget(name: "JaffloopCoreTests", dependencies: ["JaffloopCore"]),
    ]
)
