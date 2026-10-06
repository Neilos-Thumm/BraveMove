// bravemove-host.swift
// Native messaging host for the BraveMove extension. Brave launches it on
// demand, it answers one request over stdin/stdout, then exits.
// It reads/writes Brave's window names ("Window > Name Window...") through
// Brave's own AppleScript dictionary — something no extension API exposes.
//
// Requests:  {"op":"list"}
//            {"op":"rename","id":"123","bounds":[l,t,r,b],"name":"4"}
// Build:     swiftc bravemove-host.swift -o bravemove-host

import Foundation

let braveID = "com.brave.Browser"

// ---- Native messaging framing: 4-byte little-endian length + UTF-8 JSON ----

func readMessage() -> [String: Any]? {
    let stdin = FileHandle.standardInput
    let header = stdin.readData(ofLength: 4)
    guard header.count == 4 else { return nil }
    let length = header.withUnsafeBytes { $0.loadUnaligned(as: UInt32.self) }.littleEndian
    let body = stdin.readData(ofLength: Int(length))
    return (try? JSONSerialization.jsonObject(with: body)) as? [String: Any]
}

func writeMessage(_ message: [String: Any]) {
    guard let body = try? JSONSerialization.data(withJSONObject: message) else { return }
    var length = UInt32(body.count).littleEndian
    let stdout = FileHandle.standardOutput
    stdout.write(Data(bytes: &length, count: 4))
    stdout.write(body)
}

// ---- AppleScript ----

struct ScriptError: Error { let message: String }

func run(_ source: String) -> Result<NSAppleEventDescriptor, ScriptError> {
    var error: NSDictionary?
    guard let result = NSAppleScript(source: source)?.executeAndReturnError(&error) else {
        return .failure(ScriptError(message: error?[NSAppleScript.errorMessage] as? String ?? "AppleScript failed"))
    }
    return .success(result)
}

func quoted(_ s: String) -> String {
    "\"" + s.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"") + "\""
}

func listWindows() -> [String: Any] {
    let script = """
    tell application id "\(braveID)"
        set out to {}
        repeat with w in windows
            set end of out to {id of w as text, given name of w, bounds of w, mode of w}
        end repeat
        return out
    end tell
    """
    switch run(script) {
    case .failure(let e):
        return ["error": e.message]
    case .success(let list):
        var windows: [[String: Any]] = []
        for i in stride(from: 1, through: list.numberOfItems, by: 1) {
            guard let w = list.atIndex(i), w.numberOfItems == 4 else { continue }
            let boundsDesc = w.atIndex(3)
            let bounds = (1...4).map { Int(boundsDesc?.atIndex($0)?.int32Value ?? 0) }
            windows.append([
                "id": w.atIndex(1)?.stringValue ?? "",
                "name": w.atIndex(2)?.stringValue ?? "",   // missing value -> ""
                "bounds": bounds,
                "incognito": w.atIndex(4)?.stringValue == "incognito",
            ])
        }
        return ["windows": windows]
    }
}

func rename(id: String, bounds: [Int], name: String) -> [String: Any] {
    // Match by id first; fall back to exact bounds in case the AppleScript id
    // ever differs from the extension's windowId.
    let b = bounds.map(String.init).joined(separator: ", ")
    let script = """
    tell application id "\(braveID)"
        repeat with w in windows
            if (id of w as text) is \(quoted(id)) then
                set given name of w to \(quoted(name))
                return true
            end if
        end repeat
        repeat with w in windows
            if (bounds of w) is {\(b)} then
                set given name of w to \(quoted(name))
                return true
            end if
        end repeat
        return false
    end tell
    """
    switch run(script) {
    case .failure(let e):     return ["error": e.message]
    case .success(let found):   return ["ok": found.booleanValue]
    }
}

// ---- Debug log: ~/Library/Application Support/BraveMove/host.log ----

func log(_ line: String) {
    let url = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/BraveMove/host.log")
    let entry = Data("\(Date()) \(line)\n".utf8)
    if let handle = try? FileHandle(forWritingTo: url) {
        handle.seekToEndOfFile()
        handle.write(entry)
        try? handle.close()
    } else {
        try? entry.write(to: url)
    }
}

// ---- Main ----

log("launched by \(CommandLine.arguments.dropFirst().joined(separator: " "))")
guard let request = readMessage() else { log("no request on stdin"); exit(1) }

let response: [String: Any]
switch request["op"] as? String {
case "list":
    response = listWindows()
case "rename":
    response = rename(id: request["id"] as? String ?? "",
                      bounds: request["bounds"] as? [Int] ?? [],
                      name: request["name"] as? String ?? "")
default:
    response = ["error": "unknown op"]
}
log("\(request["op"] ?? "?") -> \(response["error"].map { "error: \($0)" } ?? "ok")")
writeMessage(response)
