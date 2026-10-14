import Foundation
import JaffloopCore

// jaffloop-mcp [--db <path>]  — stdio MCP server over the same SQLite file as the app.
var path = JaffloopPaths.defaultURL
let args = CommandLine.arguments
if let i = args.firstIndex(of: "--db"), i + 1 < args.count { path = URL(fileURLWithPath: args[i + 1]) }
if args.contains("--version") { print("jaffloop-mcp \(mcpServerVersion)"); exit(0) }

do {
    let pool = try openJaffloopDatabase(at: path)
    MCPServer(store: Store(pool)).runStdio()
} catch {
    FileHandle.standardError.write(Data("jaffloop-mcp: \(error)\n".utf8))
    exit(1)
}
