import Foundation

// Port of ~/base/relaunch-sessions.sh: rediscover the Claude Code sessions that
// were open before a restart and reopen them, grouped into iTerm2 windows by
// project family.
//
// Discovery reads Tricorder's OWN per-session state (~/.claude/tricorder/state/
// <id>/), not the raw transcript store (~/.claude/projects/*/*.jsonl). The
// transcript store holds every session ever run — hundreds of files, hundreds of
// MB — and reading it on every menu open froze the UI for several seconds.
// Tricorder's state dir is tiny (a handful of text files per session) and has
// exactly the lifecycle this feature needs for free: `SessionEnd` already deletes
// it on a clean exit, but a crash / terminal-quit / reboot never fires that hook,
// so the directory survives — "still there" already means "died abruptly", which
// is precisely what should be restorable.

let RELAUNCH_ROOT = "\(HOME)/base"
let RELAUNCH_GAP_SECONDS: Double = 1800
let RELAUNCH_MISC_GROUP = "misc"
let TRICORDER_STATE_DIR = "\(HOME)/.claude/tricorder/state"
let TRICORDER_DEBUG_DIR = "_debug"

struct RestorableSession {
    let name: String
    let cwd: String
    let sid: String
    let mtime: Double
}

// ---- live-session filtering -------------------------------------------------

// pid -> full command line, from `ps -eo pid=,command=`.
private func runningProcesses() -> [Int32: String] {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/bin/ps")
    p.arguments = ["-eo", "pid=,command="]
    let pipe = Pipe()
    p.standardOutput = pipe
    p.standardError = Pipe()
    do { try p.run() } catch { return [:] }
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    p.waitUntilExit()
    guard let text = String(data: data, encoding: .utf8) else { return [:] }
    var procs: [Int32: String] = [:]
    for line in text.split(separator: "\n") {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard let spaceIdx = trimmed.firstIndex(of: " ") else { continue }
        let pidStr = trimmed[..<spaceIdx]
        let command = trimmed[trimmed.index(after: spaceIdx)...].trimmingCharacters(in: .whitespaces)
        if let pid = Int32(pidStr) { procs[pid] = command }
    }
    return procs
}

// A registry entry counts as live only if its pid is a CURRENTLY RUNNING `claude`
// (or `claude --resume <sid>`) process. This must fail open: `~/.claude/sessions/
// *.json` files are not cleaned up on shutdown, so right after a restart every one
// of them is stale — its pid is dead, or (rarely) reused by an unrelated process.
// A dead pid, an unmatched command, or any parse failure must all resolve to "not
// live" so the session is still offered for restoration — never "blocked".
private func isRealSession(pid: Int32, sid: String, procs: [Int32: String]) -> Bool {
    guard let command = procs[pid] else { return false }
    let parts = command.split(separator: " ").map(String.init)
    guard let first = parts.first, (first as NSString).lastPathComponent == "claude" else { return false }
    let rest = Array(parts.dropFirst())
    if rest.isEmpty { return true }
    return rest.count >= 2 && rest[0] == "--resume" && rest[1] == sid
}

func liveSessionIds() -> Set<String> {
    let fm = FileManager.default
    let dir = "\(HOME)/.claude/sessions"
    guard let files = try? fm.contentsOfDirectory(atPath: dir) else { return [] }
    let procs = runningProcesses()
    let live = files.filter { $0.hasSuffix(".json") }.compactMap { f -> String? in
        guard let data = fm.contents(atPath: "\(dir)/\(f)"),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let sid = obj["sessionId"] as? String,
              let pidNum = obj["pid"] as? Int,
              isRealSession(pid: Int32(pidNum), sid: sid, procs: procs)
        else { return nil }
        return sid
    }
    return Set(live)
}

// ---- discovery from Tricorder's own state store -----------------------------

private func readTrimmed(_ path: String) -> String? {
    guard let s = try? String(contentsOfFile: path, encoding: .utf8) else { return nil }
    let trimmed = s.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
}

private func mtimeOf(_ path: String) -> Double? {
    let attrs = try? FileManager.default.attributesOfItem(atPath: path)
    return (attrs?[.modificationDate] as? Date)?.timeIntervalSince1970
}

func collectRestorableSessions() -> [RestorableSession] {
    let fm = FileManager.default
    guard let sids = try? fm.contentsOfDirectory(atPath: TRICORDER_STATE_DIR) else { return [] }
    let live = liveSessionIds()

    let candidates: [RestorableSession] = sids.compactMap { sid -> RestorableSession? in
        if sid == TRICORDER_DEBUG_DIR || live.contains(sid) { return nil }
        let dir = "\(TRICORDER_STATE_DIR)/\(sid)"
        var isDir: ObjCBool = false
        guard fm.fileExists(atPath: dir, isDirectory: &isDir), isDir.boolValue else { return nil }
        // cwd.txt is stashed by `capture` on nearly every hook call — no cwd means
        // this state dir predates that (or belongs to something else); skip it.
        guard let cwd = readTrimmed("\(dir)/cwd.txt"), fm.fileExists(atPath: cwd) else { return nil }
        let label = readTrimmed("\(dir)/label.txt")
        let name = (label ?? String(sid.prefix(8))).replacingOccurrences(of: " ", with: "-").lowercased()
        // attention.json is touched by every meaningful hook event, so its mtime
        // is the best "last activity" signal; fall back to cwd.txt's, then now.
        let mtime = mtimeOf("\(dir)/attention.json") ?? mtimeOf("\(dir)/cwd.txt")
            ?? Date().timeIntervalSince1970
        return RestorableSession(name: name, cwd: cwd, sid: sid, mtime: mtime)
    }

    // Keep only the most recent activity cluster: consecutive gaps ≤ the window.
    let sorted = candidates.sorted { $0.mtime > $1.mtime }
    var cluster: [RestorableSession] = []
    for row in sorted {
        if let last = cluster.last, last.mtime - row.mtime > RELAUNCH_GAP_SECONDS { break }
        cluster.append(row)
    }
    return cluster
}

// ---- grouping ----------------------------------------------------------------

// The session's path relative to ~/base, first component — "misc" for anything
// outside ~/base or sitting directly in it (the "doesn't fit anywhere" bucket).
func groupKey(for cwd: String) -> String {
    let root = RELAUNCH_ROOT
    guard cwd.hasPrefix(root + "/") else { return RELAUNCH_MISC_GROUP }
    let relative = String(cwd.dropFirst(root.count + 1))
    guard let slashIdx = relative.firstIndex(of: "/") else { return relative }
    return String(relative[..<slashIdx])
}

func groupedRestorableSessions() -> [(name: String, sessions: [RestorableSession])] {
    let all = collectRestorableSessions()
    let grouped = Dictionary(grouping: all, by: { groupKey(for: $0.cwd) })
    let names = grouped.keys.sorted { a, b in
        if a == RELAUNCH_MISC_GROUP { return false }
        if b == RELAUNCH_MISC_GROUP { return true }
        return a < b
    }
    return names.map { name in (name: name, sessions: grouped[name]!.sorted { $0.name < $1.name }) }
}

// ---- opening iTerm2 windows ---------------------------------------------------

// Flattens (dir, sid, isNew) triples across groups into one AppleScript call —
// each group's first entry opens a new window, the rest join it as tabs. The
// script is fed via stdin with `osascript -`, mirroring the bash original's
// `osascript - "$@" <<'APPLESCRIPT'`.
func restoreSessions(_ groups: [[RestorableSession]]) {
    var argv: [String] = []
    for group in groups {
        for (idx, sess) in group.enumerated() {
            argv.append(contentsOf: [sess.cwd, sess.sid, idx == 0 ? "1" : "0"])
        }
    }
    guard !argv.isEmpty else { return }

    let script = """
    on run argv
      set i to 1
      set n to count of argv
      tell application "iTerm2"
        activate
        repeat while i < n
          set d to item i of argv
          set sid to item (i + 1) of argv
          set isNew to item (i + 2) of argv
          set cmd to "cd " & quoted form of d & " && claude --resume " & sid
          if isNew is "1" then
            create window with default profile
            tell current session of current window to write text cmd
          else
            tell current window
              create tab with default profile
              tell current session to write text cmd
            end tell
          end if
          delay 0.4
          set i to i + 3
        end repeat
      end tell
    end run
    """
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
    p.arguments = ["-"] + argv
    let stdin = Pipe()
    p.standardInput = stdin
    p.standardError = Pipe()
    do {
        try p.run()
        if let data = script.data(using: .utf8) {
            stdin.fileHandleForWriting.write(data)
        }
        stdin.fileHandleForWriting.closeFile()
    } catch {
        // best-effort — nothing to recover
    }
}
