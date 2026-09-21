import AppKit
import Foundation

// ---- paths -----------------------------------------------------------------

let HOME = FileManager.default.homeDirectoryForCurrentUser.path
let SHIM = "\(HOME)/.claude/tricorder-src/plugin/bin/tricorder"
let IT2 = "/Applications/iTerm.app/Contents/Resources/utilities/it2"

// ---- status model ----------------------------------------------------------

struct SessionStatus: Codable {
    let id: String
    let label: String
    let state: String
    let at: Double
    let iterm: String
    let agents: Int
    let lastSound: Double?
}
struct Sounds: Codable {
    let question: Bool
    let permission: Bool
    let plan: Bool
    let stop: Bool
}
struct Status: Codable {
    let muted: Bool
    let worktreeClick: String
    let sounds: Sounds
    let sessions: [SessionStatus]
}

// A row's sound counts as "just played" for this long after it fired — long
// enough to notice among several "mission complete" rows, short enough that
// it stops pointing at a stale event.
let JUST_PLAYED_WINDOW_MS: Double = 8000
func justPlayed(_ lastSound: Double?) -> Bool {
    guard let at = lastSound else { return false }
    return Date().timeIntervalSince1970 * 1000 - at < JUST_PLAYED_WINDOW_MS
}

// ---- running the tricorder binary (GUI apps lack nvm's node on PATH) --------

func resolveNode() -> String {
    let fm = FileManager.default
    // 1. nvm versions (launchctl's env has no PATH to node, and `zsh -lc` skips
    //    .zshrc where nvm lives — so scan the dir directly).
    let nvmDir = "\(HOME)/.nvm/versions/node"
    if let entries = try? fm.contentsOfDirectory(atPath: nvmDir) {
        for e in entries.sorted().reversed() {
            let c = "\(nvmDir)/\(e)/bin/node"
            if fm.isExecutableFile(atPath: c) { return c }
        }
    }
    // 2. common install locations
    for c in ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"] where
        fm.isExecutableFile(atPath: c) { return c }
    // 3. last resort: an interactive login shell (sources .zshrc → nvm)
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/bin/zsh")
    p.arguments = ["-ilc", "command -v node"]
    let pipe = Pipe()
    p.standardOutput = pipe
    p.standardError = Pipe()
    do { try p.run(); p.waitUntilExit() } catch { return "" }
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    return String(data: data, encoding: .utf8)?
        .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
}
let NODE = resolveNode()

@discardableResult
func runTricorder(_ args: [String], capture: Bool = false) -> String {
    if NODE.isEmpty { return "" }
    let p = Process()
    p.executableURL = URL(fileURLWithPath: NODE)
    p.arguments = [SHIM] + args
    let out = Pipe()
    if capture { p.standardOutput = out }
    p.standardError = Pipe()
    do { try p.run() } catch { return "" }
    if capture {
        let data = out.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        return String(data: data, encoding: .utf8) ?? ""
    }
    return ""
}

func fetchStatus() -> Status? {
    let json = runTricorder(["status"], capture: true)
    guard let data = json.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode(Status.self, from: data)
}

// ITERM_SESSION_ID is "<pane>:<GUID>"; an iTerm2 session's AppleScript id IS
// that GUID.
func guidFromIterm(_ iterm: String) -> String {
    iterm.contains(":") ? String(iterm.split(separator: ":").last ?? "") : iterm
}

let CLAUDE_TITLE_SUFFIX = " (claude)"

// Claude Code sets the iTerm2 tab title to a leading status glyph (◑/✳/...)
// plus the session's own name plus " (claude)". That name is the ground truth
// for "what is this session called" — a user-renamed worktree or basename
// heuristic can't compete with it, so it takes priority over the stored label
// whenever iTerm2 has one for this session.
func cleanSessionName(_ raw: String) -> String {
    var s = raw
    if s.hasSuffix(CLAUDE_TITLE_SUFFIX) {
        s = String(s.dropLast(CLAUDE_TITLE_SUFFIX.count))
    }
    if let first = s.first, !first.isLetter, !first.isNumber {
        s = String(s.dropFirst()).trimmingCharacters(in: .whitespaces)
    }
    return s.isEmpty ? raw : s
}

// One AppleScript call enumerating every window/tab/session, run once per
// background refresh tick rather than per row — cheap relative to fetchStatus.
func iterm2SessionNames() -> [String: String] {
    // `tab`/`linefeed` must be resolved to the global text constants *before*
    // entering `tell application "iTerm2"` — iTerm2's own dictionary defines a
    // `tab` class (window > tab > session), and inside the tell block bare
    // `tab` resolves to that class instead of the ASCII tab character, so the
    // separator silently became the literal text "tab".
    let script = """
    set tabChar to tab
    set nl to linefeed
    tell application "iTerm2"
      set output to ""
      repeat with w in windows
        repeat with t in tabs of w
          repeat with s in sessions of t
            set output to output & (id of s) & tabChar & (name of s) & nl
          end repeat
        end repeat
      end repeat
      return output
    end tell
    """
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
    p.arguments = ["-e", script]
    let out = Pipe()
    p.standardOutput = out
    p.standardError = Pipe()
    do { try p.run() } catch { return [:] }
    let data = out.fileHandleForReading.readDataToEndOfFile()
    p.waitUntilExit()
    let text = String(data: data, encoding: .utf8) ?? ""
    var result: [String: String] = [:]
    for line in text.split(separator: "\n") {
        let parts = line.split(separator: "\t", maxSplits: 1)
        guard parts.count == 2 else { continue }
        result[String(parts[0])] = cleanSessionName(String(parts[1]))
    }
    return result
}

func focusSession(_ iterm: String) {
    // AppleScript is reliable from the app (it2 needs API auth the launchctl
    // context lacks).
    let guid = guidFromIterm(iterm)
    if guid.isEmpty { return }
    // Find the session first, then select its window/tab/session — selecting a
    // window mid-iteration invalidates the loop. Raising the window is what makes
    // it jump to the right tab across multiple iTerm2 windows.
    let script = """
    tell application "iTerm2"
      set found to missing value
      repeat with w in windows
        repeat with t in tabs of w
          repeat with s in sessions of t
            if (id of s) is "\(guid)" then
              set found to {w, t, s}
              exit repeat
            end if
          end repeat
          if found is not missing value then exit repeat
        end repeat
        if found is not missing value then exit repeat
      end repeat
      if found is missing value then return
      select (item 1 of found)
      select (item 2 of found)
      select (item 3 of found)
      activate
    end tell
    """
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
    p.arguments = ["-e", script]
    p.standardError = Pipe()
    try? p.run()
}

func flyEnterprise() {
    let script = """
    tell application "iTerm2"
      activate
      if (count of windows) is 0 then create window with default profile
      tell current window
        set t to (create tab with default profile)
        tell current session of t to write text "\(SHIM) warp"
      end tell
    end tell
    """
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
    p.arguments = ["-e", script]
    p.standardError = Pipe()
    try? p.run()
}

// ---- helpers ---------------------------------------------------------------

// Star Trek alert conditions. "working" is a real, distinct state (capture.ts
// sets it on any tool/sub-agent activity) — it must never read as idle.
func stateDot(_ s: String) -> String {
    switch s {
    case "security": return "🔴"
    case "question": return "🟡"
    case "done": return "🟢"
    default: return "🖖"
    }
}
func stateLabel(_ s: String) -> String {
    switch s {
    case "security": return "red alert"
    case "question": return "yellow alert"
    case "done": return "mission complete"
    case "working": return "working"
    default: return "standing by"
    }
}
func rank(_ s: String) -> Int {
    switch s {
    case "security": return 0
    case "question": return 1
    case "done": return 2
    case "working": return 3
    default: return 4
    }
}
func stateName(_ s: String) -> String {
    switch s {
    case "security": return "security"
    case "question": return "question"
    case "done": return "done"
    default: return "idle"
    }
}
// Star Trek SVG per state. Override at ~/.claude/tricorder/icons/<state>.svg, else
// the bundled copy. Template image so it adapts to the menu bar (light/dark).
func iconImage(_ state: String) -> NSImage? {
    let name = stateName(state) + ".svg"
    let override = "\(HOME)/.claude/tricorder/icons/\(name)"
    let source = FileManager.default.fileExists(atPath: override)
        ? override
        : (Bundle.main.resourcePath.map { "\($0)/\(name)" } ?? "")
    guard let img = NSImage(contentsOfFile: source) else { return nil }
    img.size = NSSize(width: 18, height: 18)
    img.isTemplate = true
    return img
}
func ageString(_ atMs: Double) -> String {
    let secs = max(0, Int((Date().timeIntervalSince1970 * 1000 - atMs) / 1000))
    if secs < 60 { return "\(secs)s" }
    if secs < 3600 { return "\(secs / 60)m" }
    return "\(secs / 3600)h"
}

// "2026-09-17T18:11:39.241Z capture ... → ..." -> "18:11:39 capture ... → ..."
func shortLog(_ s: String) -> String {
    guard let tIdx = s.firstIndex(of: "T") else { return s }
    let rest = String(s[s.index(after: tIdx)...])
    guard let zIdx = rest.firstIndex(of: "Z") else { return rest }
    let time = String(rest[..<zIdx]).prefix(8)
    let msg = String(rest[rest.index(after: zIdx)...]).trimmingCharacters(in: .whitespaces)
    return "\(time)  \(msg)"
}

// ---- app -------------------------------------------------------------------

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    let menu = NSMenu()
    var timer: Timer?
    var current: Status?
    // Snapshot from the last background refresh, so click handlers act on exactly
    // what was displayed rather than a freshly re-derived (possibly different) set.
    var restorableGroups: [(name: String, sessions: [RestorableSession])] = []
    var recentLogLines: [String] = []
    // GUID -> live iTerm2 session name. Ground truth for "what is this session
    // called" — preferred over the stored label whenever iTerm2 has one.
    var itermNames: [String: String] = [:]
    private let refreshQueue = DispatchQueue(label: "com.gago.tricorder.refresh", qos: .utility)
    private var isRefreshing = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSAppleEventManager.shared().setEventHandler(
            self, andSelector: #selector(handleURL(_:withReplyEvent:)),
            forEventClass: AEEventClass(kInternetEventClass), andEventID: AEEventID(kAEGetURL))
        menu.delegate = self
        statusItem.menu = menu
        statusItem.button?.title = "🖖"
        refresh()
        timer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in self?.refresh() }
    }

    func highestState() -> String {
        guard let s = current else { return "working" }
        let states = Set(s.sessions.map { $0.state })
        if states.contains("security") { return "security" }
        if states.contains("question") { return "question" }
        if states.contains("done") { return "done" }
        return "working"
    }
    func waitingCount() -> Int {
        guard let s = current else { return 0 }
        return s.sessions.filter { ["security", "question", "done"].contains($0.state) }.count
    }
    func updateIcon() {
        guard let button = statusItem.button else { return }
        let count = waitingCount()
        if let img = iconImage(highestState()) {
            button.image = img
            button.imagePosition = .imageLeading
            button.title = count > 1 ? " \(count)" : ""
        } else {
            button.image = nil
            button.title = count > 1 ? "\(stateDot(highestState()))\(count)" : stateDot(highestState())
        }
    }

    // All the slow work (spawning `tricorder status`/`logs`, scanning the state
    // dir, shelling `ps`) happens here, off the main thread, on a 1s timer. Menu
    // opening (menuNeedsUpdate) only ever reads the results this leaves behind —
    // it does zero I/O of its own, so it is instant regardless of how long
    // collection takes. `isRefreshing` drops an overlapping tick rather than
    // piling up background work if something is slow.
    func refresh() {
        guard !isRefreshing else { return }
        isRefreshing = true
        refreshQueue.async { [weak self] in
            let status = fetchStatus()
            let groups = groupedRestorableSessions()
            let names = iterm2SessionNames()
            let logs = runTricorder(["logs", "8"], capture: true)
                .split(separator: "\n").suffix(8).map(String.init)
            DispatchQueue.main.async {
                guard let self else { return }
                self.current = status
                self.restorableGroups = groups
                self.itermNames = names
                self.recentLogLines = logs
                self.updateIcon()
                self.isRefreshing = false
            }
        }
    }

    // The live iTerm2 name (Claude Code's own tab title, minus its status
    // glyph and " (claude)" suffix) if we have one for this session, else the
    // stored label. iTerm2 is ground truth for "what is this session called."
    func displayLabel(_ sess: SessionStatus) -> String {
        itermNames[guidFromIterm(sess.iterm)] ?? sess.label
    }

    // Rebuild the menu only when it's about to open (avoids flicker on the 1s
    // tick) — purely from cached data, no process spawns or disk scans here.
    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        guard let s = current else { return }

        let all = s.sessions.sorted { a, b in
            let ra = rank(a.state)
            let rb = rank(b.state)
            return ra != rb ? ra < rb : a.at > b.at
        }
        if all.isEmpty {
            let none = NSMenuItem(title: "No active sessions", action: nil, keyEquivalent: "")
            none.isEnabled = false
            menu.addItem(none)
        } else {
            for sess in all {
                let agentsSuffix = sess.agents > 0 ? " · \(sess.agents) agent\(sess.agents == 1 ? "" : "s")" : ""
                let speaker = justPlayed(sess.lastSound) ? "🔊 " : ""
                let item = NSMenuItem(
                    title: "\(speaker)\(displayLabel(sess)) — \(stateLabel(sess.state))\(agentsSuffix) · \(ageString(sess.at))",
                    action: #selector(rowClicked(_:)), keyEquivalent: "")
                item.target = self
                item.image = iconImage(sess.state)  // the actual Star Trek icon per state
                item.representedObject = sess.iterm
                menu.addItem(item)
            }
        }

        menu.addItem(.separator())
        menu.addItem(restoreSessionsMenuItem())

        menu.addItem(.separator())
        let mute = NSMenuItem(title: "Muted", action: #selector(toggleMute), keyEquivalent: "")
        mute.target = self
        mute.state = s.muted ? .on : .off
        menu.addItem(mute)

        let soundsItem = NSMenuItem(title: "Sounds", action: nil, keyEquivalent: "")
        let sub = NSMenu()
        addSoundToggle(sub, "Question", "question", s.sounds.question)
        addSoundToggle(sub, "Permission", "permission", s.sounds.permission)
        addSoundToggle(sub, "Plan", "plan", s.sounds.plan)
        addSoundToggle(sub, "Done", "stop", s.sounds.stop)
        soundsItem.submenu = sub
        menu.addItem(soundsItem)

        let worktreeItem = NSMenuItem(title: "Worktree Link", action: nil, keyEquivalent: "")
        let worktreeSub = NSMenu()
        addWorktreeClickOption(worktreeSub, "Open the directory", "open", s.worktreeClick)
        addWorktreeClickOption(worktreeSub, "Copy the path", "copy", s.worktreeClick)
        addWorktreeClickOption(worktreeSub, "Both", "both", s.worktreeClick)
        worktreeItem.submenu = worktreeSub
        menu.addItem(worktreeItem)

        menu.addItem(.separator())
        let warp = NSMenuItem(title: "Fly the Enterprise 🚀", action: #selector(warpClicked), keyEquivalent: "")
        warp.target = self
        menu.addItem(warp)

        menu.addItem(.separator())
        let actHeader = NSMenuItem(title: "Recent activity", action: nil, keyEquivalent: "")
        actHeader.isEnabled = false
        menu.addItem(actHeader)
        if recentLogLines.isEmpty {
            let empty = NSMenuItem(title: "  (no activity yet)", action: nil, keyEquivalent: "")
            empty.isEnabled = false
            menu.addItem(empty)
        } else {
            for line in recentLogLines {
                let item = NSMenuItem(title: "", action: nil, keyEquivalent: "")
                item.isEnabled = false
                item.attributedTitle = NSAttributedString(
                    string: shortLog(String(line)),
                    attributes: [.font: NSFont.monospacedSystemFont(ofSize: 10, weight: .regular)])
                menu.addItem(item)
            }
        }
        let openLogItem = NSMenuItem(title: "Open live log…", action: #selector(openLogClicked), keyEquivalent: "l")
        openLogItem.target = self
        menu.addItem(openLogItem)

        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Quit Tricorder", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
    }

    func addSoundToggle(_ menu: NSMenu, _ title: String, _ key: String, _ on: Bool) {
        let item = NSMenuItem(title: title, action: #selector(toggleSound(_:)), keyEquivalent: "")
        item.target = self
        item.state = on ? .on : .off
        item.representedObject = key
        menu.addItem(item)
    }

    func addWorktreeClickOption(_ menu: NSMenu, _ title: String, _ mode: String, _ current: String) {
        let item = NSMenuItem(title: title, action: #selector(worktreeClickSelected(_:)), keyEquivalent: "")
        item.target = self
        item.state = mode == current ? .on : .off
        item.representedObject = mode
        menu.addItem(item)
    }

    // "Restore Sessions" — reads the group snapshot the background refresh already
    // computed (never recomputes on click; manual-only refers to actually opening
    // windows, not to how the list is gathered). A submenu with "Restore All"
    // plus one clickable entry per project-family group, "misc" always last.
    func restoreSessionsMenuItem() -> NSMenuItem {
        let total = restorableGroups.reduce(0) { $0 + $1.sessions.count }
        let top = NSMenuItem(title: "Restore Sessions (\(total))", action: nil, keyEquivalent: "")
        guard total > 0 else {
            top.isEnabled = false
            return top
        }
        let sub = NSMenu()
        let allItem = NSMenuItem(title: "Restore All (\(total))", action: #selector(restoreAllClicked), keyEquivalent: "")
        allItem.target = self
        sub.addItem(allItem)
        sub.addItem(.separator())
        for (idx, group) in restorableGroups.enumerated() {
            let item = NSMenuItem(
                title: "\(group.name) (\(group.sessions.count))",
                action: #selector(restoreGroupClicked(_:)), keyEquivalent: "")
            item.target = self
            item.representedObject = idx
            item.toolTip = group.sessions.map { $0.name }.joined(separator: "\n")
            sub.addItem(item)
        }
        top.submenu = sub
        return top
    }

    @objc func rowClicked(_ sender: NSMenuItem) {
        // Focus only — do NOT acknowledge. The state persists until the session
        // actually resumes working (its next UserPromptSubmit sets "working").
        guard let iterm = sender.representedObject as? String, !iterm.isEmpty else { return }
        focusSession(iterm)
    }
    @objc func toggleMute() { runTricorder(["mute", "toggle"]); refresh() }
    @objc func toggleSound(_ sender: NSMenuItem) {
        guard let key = sender.representedObject as? String else { return }
        runTricorder(["sound-enable", key, "toggle"]); refresh()
    }
    @objc func warpClicked() { flyEnterprise() }
    @objc func worktreeClickSelected(_ sender: NSMenuItem) {
        guard let mode = sender.representedObject as? String else { return }
        runTricorder(["worktree-click", mode]); refresh()
    }
    @objc func restoreAllClicked() { restoreSessions(restorableGroups.map { $0.sessions }) }
    @objc func restoreGroupClicked(_ sender: NSMenuItem) {
        guard let idx = sender.representedObject as? Int, idx >= 0, idx < restorableGroups.count else { return }
        restoreSessions([restorableGroups[idx].sessions])
    }
    @objc func openLogClicked() {
        let log = "\(HOME)/.claude/tricorder/tricorder.log"
        let script = """
        tell application "iTerm2"
          activate
          if (count of windows) is 0 then create window with default profile
          tell current window
            set t to (create tab with default profile)
            tell current session of t to write text "tail -f \(log)"
          end tell
        end tell
        """
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        p.arguments = ["-e", script]
        p.standardError = Pipe()
        try? p.run()
    }

    @objc func handleURL(_ event: NSAppleEventDescriptor, withReplyEvent: NSAppleEventDescriptor) {
        guard let url = event.paramDescriptor(forKeyword: AEKeyword(keyDirectObject))?.stringValue else { return }
        // Path links (worktree/plan) use plain file:// now, opened by macOS
        // itself via LaunchServices — no app-specific handling needed for
        // those, so the statusline works standalone without this app.
        if url == "tricorder://mute" { runTricorder(["mute", "toggle"]); refresh() }
        else if url == "tricorder://warp" { flyEnterprise() }
        else if url.hasPrefix("tricorder://worktree") {
            handleWorktreeClick(url)
        } else if url.hasPrefix("tricorder://sound-set") {
            handleSoundSet(url)
        }
    }

    // tricorder://worktree?path=...&mode=copy|both — the statusline routes the
    // worktree link here whenever the configured click mode needs the app
    // (a bare link can't write the clipboard on its own).
    func handleWorktreeClick(_ url: String) {
        guard let comps = URLComponents(string: url) else { return }
        let items = comps.queryItems ?? []
        let path = items.first(where: { $0.name == "path" })?.value ?? ""
        let mode = items.first(where: { $0.name == "mode" })?.value ?? ""
        guard !path.isEmpty else { return }
        if mode == "copy" || mode == "both" {
            let pb = NSPasteboard.general
            pb.clearContents()
            pb.setString(path, forType: .string)
        }
        if mode == "both" {
            NSWorkspace.shared.open(URL(fileURLWithPath: path))
        }
    }

    // tricorder://sound-set?event=question&url=https://...&name=Engage — from
    // the catalog page on the site. Validation (event key, host allowlist) lives
    // in the `sound-set` subcommand; this just passes the three params through.
    func handleSoundSet(_ url: String) {
        guard let comps = URLComponents(string: url) else { return }
        let items = comps.queryItems ?? []
        let event = items.first(where: { $0.name == "event" })?.value ?? ""
        let soundUrl = items.first(where: { $0.name == "url" })?.value ?? ""
        let name = items.first(where: { $0.name == "name" })?.value ?? ""
        guard !event.isEmpty, !soundUrl.isEmpty else { return }
        runTricorder(["sound-set", event, soundUrl, name])
        refresh()
    }
}

// Multi-file `swiftc` needs an explicit entry point (only a file literally named
// main.swift gets automatic top-level code).
@main
struct TricorderBarMain {
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.accessory)
        app.run()
    }
}
