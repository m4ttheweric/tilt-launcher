import Cocoa
import Foundation
import ServiceManagement

// ─── Path Resolution ────────────────────────────────────────────────
// All paths are derived dynamically. No hardcoded user-specific paths.
//
// REPO_DIR: the directory containing this source file (injected into
//           Info.plist at build time by build.sh)
// CONFIG:   ~/.config/tilt-launcher/config.json
// NODE:     discovered via PATH

let CONFIG_DIR: String = {
    let dir = NSHomeDirectory() + "/.config/tilt-launcher"
    try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    return dir
}()

let CONFIG_PATH = CONFIG_DIR + "/config.json"
let LOG_PATH = CONFIG_DIR + "/server.log"

func resolveResourcesDir() -> String {
    // When running as a proper .app bundle, resources are in Contents/Resources/
    if let resourcePath = Bundle.main.resourcePath,
       FileManager.default.fileExists(atPath: resourcePath + "/tilt-launcher.mjs") {
        return resourcePath
    }
    // Fallback for development: look in the repo directory (parent of .app)
    let binary = CommandLine.arguments[0]
    let repoDir = URL(fileURLWithPath: binary)
        .deletingLastPathComponent() // MacOS/
        .deletingLastPathComponent() // Contents/
        .deletingLastPathComponent() // TiltLauncher.app/
        .deletingLastPathComponent() // repo dir
        .path
    if FileManager.default.fileExists(atPath: repoDir + "/tilt-launcher.mjs") {
        return repoDir
    }
    // Last fallback: current directory
    return FileManager.default.currentDirectoryPath
}

func findNode() -> String {
    // Check common locations
    let candidates = [
        "/opt/homebrew/bin/node",
        "/usr/local/bin/node",
        NSHomeDirectory() + "/.bun/bin/bun",
    ]

    // Also check nvm
    let nvmDir = NSHomeDirectory() + "/.nvm/versions/node"
    if let versions = try? FileManager.default.contentsOfDirectory(atPath: nvmDir) {
        let sorted = versions.sorted().reversed()
        for v in sorted {
            let candidate = "\(nvmDir)/\(v)/bin/node"
            if FileManager.default.fileExists(atPath: candidate) {
                return candidate
            }
        }
    }

    for c in candidates {
        if FileManager.default.fileExists(atPath: c) {
            return c
        }
    }

    // Last resort: rely on PATH
    return "/usr/bin/env"
}

let RESOURCES_DIR = resolveResourcesDir()
let SERVER_SCRIPT = RESOURCES_DIR + "/tilt-launcher.mjs"
let NODE_PATH = findNode()

// ─── Config ─────────────────────────────────────────────────────────
struct ServiceDef: Codable {
    var id: String
    var label: String
    var port: Int
    var path: String
}

struct TiltEnvironment: Codable {
    var id: String
    var name: String
    var repoDir: String
    var tiltfile: String
    var tiltPort: Int
    var description: String
    var services: [ServiceDef]
}

struct LauncherConfig: Codable {
    var port: Int
    var dashboardUrl: String
    var environments: [TiltEnvironment]
}

func loadConfig() -> LauncherConfig {
    let defaultConfig = LauncherConfig(
        port: 10400,
        dashboardUrl: "http://localhost:10400",
        environments: []
    )

    // Try user config first
    if let data = try? Data(contentsOf: URL(fileURLWithPath: CONFIG_PATH)),
       let config = try? JSONDecoder().decode(LauncherConfig.self, from: data) {
        return config
    }

    // Copy example config if no user config exists
    let examplePath = RESOURCES_DIR + "/config.example.json"
    if FileManager.default.fileExists(atPath: examplePath) {
        try? FileManager.default.copyItem(atPath: examplePath, toPath: CONFIG_PATH)
        if let data = try? Data(contentsOf: URL(fileURLWithPath: CONFIG_PATH)),
           let config = try? JSONDecoder().decode(LauncherConfig.self, from: data) {
            return config
        }
    }

    return defaultConfig
}

func saveConfig(_ config: LauncherConfig) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    guard let data = try? encoder.encode(config) else { return }
    try? data.write(to: URL(fileURLWithPath: CONFIG_PATH))
}

// ─── Preferences Window ─────────────────────────────────────────────
class PreferencesWindowController: NSWindowController, NSTableViewDataSource, NSTableViewDelegate {
    var config: LauncherConfig
    let onSave: (LauncherConfig) -> Void

    var envTable: NSTableView!
    var svcTable: NSTableView!
    var dashboardUrlField: NSTextField!
    var selectedEnvIndex: Int = 0

    init(config: LauncherConfig, onSave: @escaping (LauncherConfig) -> Void) {
        self.config = config
        self.onSave = onSave

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 720, height: 640),
            styleMask: [.titled, .closable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Tilt Launcher Preferences"
        window.center()
        window.isReleasedWhenClosed = false

        super.init(window: window)
        setupUI()
    }

    required init?(coder: NSCoder) { fatalError() }

    func setupUI() {
        guard let window = self.window else { return }

        let contentView = NSView(frame: window.contentView!.bounds)
        contentView.autoresizingMask = [.width, .height]
        window.contentView = contentView

        var y = contentView.bounds.height - 40

        // ── General ──
        let generalLabel = makeLabel("General", bold: true)
        generalLabel.frame = NSRect(x: 20, y: y, width: 200, height: 20)
        contentView.addSubview(generalLabel)
        y -= 30

        let dashLabel = makeLabel("Dashboard URL:")
        dashLabel.frame = NSRect(x: 20, y: y, width: 120, height: 22)
        contentView.addSubview(dashLabel)

        dashboardUrlField = NSTextField(frame: NSRect(x: 145, y: y, width: 550, height: 22))
        dashboardUrlField.stringValue = config.dashboardUrl
        dashboardUrlField.font = NSFont.systemFont(ofSize: 12)
        contentView.addSubview(dashboardUrlField)
        y -= 40

        // ── Environments ──
        let envLabel = makeLabel("Tilt Environments", bold: true)
        envLabel.frame = NSRect(x: 20, y: y, width: 300, height: 20)
        contentView.addSubview(envLabel)

        let addEnvBtn = NSButton(title: "+", target: self, action: #selector(addEnvironment))
        addEnvBtn.frame = NSRect(x: 630, y: y - 2, width: 30, height: 24)
        addEnvBtn.bezelStyle = .roundRect
        addEnvBtn.font = NSFont.systemFont(ofSize: 14, weight: .bold)
        contentView.addSubview(addEnvBtn)

        let removeEnvBtn = NSButton(title: "−", target: self, action: #selector(removeEnvironment))
        removeEnvBtn.frame = NSRect(x: 665, y: y - 2, width: 30, height: 24)
        removeEnvBtn.bezelStyle = .roundRect
        removeEnvBtn.font = NSFont.systemFont(ofSize: 14, weight: .bold)
        contentView.addSubview(removeEnvBtn)

        y -= 25

        let envScroll = NSScrollView(frame: NSRect(x: 20, y: y - 140, width: 680, height: 140))
        envTable = NSTableView()
        envTable.dataSource = self
        envTable.delegate = self
        envTable.tag = 1
        for (title, width, identifier) in [
            ("ID", 70, "env_id"), ("Name", 100, "env_name"), ("Repo Directory", 200, "env_repoDir"),
            ("Tiltfile", 110, "env_tiltfile"), ("Port", 50, "env_port"), ("Description", 130, "env_desc"),
        ] as [(String, Int, String)] {
            let col = NSTableColumn(identifier: NSUserInterfaceItemIdentifier(identifier))
            col.title = title
            col.width = CGFloat(width)
            envTable.addTableColumn(col)
        }
        envScroll.documentView = envTable
        envScroll.hasVerticalScroller = true
        envScroll.borderType = .bezelBorder
        contentView.addSubview(envScroll)
        y -= 165

        // ── Services ──
        let svcLabel = makeLabel("Services for selected environment:", bold: true)
        svcLabel.frame = NSRect(x: 20, y: y, width: 400, height: 20)
        contentView.addSubview(svcLabel)

        let addSvcBtn = NSButton(title: "+", target: self, action: #selector(addService))
        addSvcBtn.frame = NSRect(x: 630, y: y - 2, width: 30, height: 24)
        addSvcBtn.bezelStyle = .roundRect
        addSvcBtn.font = NSFont.systemFont(ofSize: 14, weight: .bold)
        contentView.addSubview(addSvcBtn)

        let removeSvcBtn = NSButton(title: "−", target: self, action: #selector(removeService))
        removeSvcBtn.frame = NSRect(x: 665, y: y - 2, width: 30, height: 24)
        removeSvcBtn.bezelStyle = .roundRect
        removeSvcBtn.font = NSFont.systemFont(ofSize: 14, weight: .bold)
        contentView.addSubview(removeSvcBtn)

        y -= 25

        let svcScroll = NSScrollView(frame: NSRect(x: 20, y: y - 140, width: 680, height: 140))
        svcTable = NSTableView()
        svcTable.dataSource = self
        svcTable.delegate = self
        svcTable.tag = 2
        for (title, width, identifier) in [
            ("ID", 140, "svc_id"), ("Label", 180, "svc_label"),
            ("Port", 80, "svc_port"), ("Path", 240, "svc_path"),
        ] as [(String, Int, String)] {
            let col = NSTableColumn(identifier: NSUserInterfaceItemIdentifier(identifier))
            col.title = title
            col.width = CGFloat(width)
            svcTable.addTableColumn(col)
        }
        svcScroll.documentView = svcTable
        svcScroll.hasVerticalScroller = true
        svcScroll.borderType = .bezelBorder
        contentView.addSubview(svcScroll)
        y -= 160

        // ── Save / Cancel ──
        let saveBtn = NSButton(title: "Save & Restart Server", target: self, action: #selector(savePrefs))
        saveBtn.frame = NSRect(x: 510, y: 15, width: 190, height: 32)
        saveBtn.bezelStyle = .rounded
        saveBtn.keyEquivalent = "\r"
        contentView.addSubview(saveBtn)

        let cancelBtn = NSButton(title: "Cancel", target: self, action: #selector(cancelPrefs))
        cancelBtn.frame = NSRect(x: 410, y: 15, width: 90, height: 32)
        cancelBtn.bezelStyle = .rounded
        cancelBtn.keyEquivalent = "\u{1b}"
        contentView.addSubview(cancelBtn)
    }

    func makeLabel(_ text: String, bold: Bool = false) -> NSTextField {
        let label = NSTextField(labelWithString: text)
        label.font = bold ? NSFont.systemFont(ofSize: 12, weight: .bold) : NSFont.systemFont(ofSize: 12)
        return label
    }

    var selectedServices: [ServiceDef] {
        guard selectedEnvIndex >= 0, selectedEnvIndex < config.environments.count else { return [] }
        return config.environments[selectedEnvIndex].services
    }

    func numberOfRows(in tableView: NSTableView) -> Int {
        if tableView.tag == 1 { return config.environments.count }
        return selectedServices.count
    }

    func tableView(_ tableView: NSTableView, objectValueFor tableColumn: NSTableColumn?, row: Int) -> Any? {
        let id = tableColumn?.identifier.rawValue ?? ""
        if tableView.tag == 1 {
            let env = config.environments[row]
            switch id {
            case "env_id": return env.id
            case "env_name": return env.name
            case "env_repoDir": return env.repoDir
            case "env_tiltfile": return env.tiltfile
            case "env_port": return "\(env.tiltPort)"
            case "env_desc": return env.description
            default: return nil
            }
        } else {
            let svcs = selectedServices
            guard row < svcs.count else { return nil }
            let svc = svcs[row]
            switch id {
            case "svc_id": return svc.id
            case "svc_label": return svc.label
            case "svc_port": return "\(svc.port)"
            case "svc_path": return svc.path
            default: return nil
            }
        }
    }

    func tableView(_ tableView: NSTableView, setObjectValue object: Any?, for tableColumn: NSTableColumn?, row: Int) {
        guard let val = object as? String, let id = tableColumn?.identifier.rawValue else { return }
        if tableView.tag == 1 {
            switch id {
            case "env_id": config.environments[row].id = val
            case "env_name": config.environments[row].name = val
            case "env_repoDir": config.environments[row].repoDir = val
            case "env_tiltfile": config.environments[row].tiltfile = val
            case "env_port": config.environments[row].tiltPort = Int(val) ?? config.environments[row].tiltPort
            case "env_desc": config.environments[row].description = val
            default: break
            }
        } else {
            guard selectedEnvIndex >= 0, selectedEnvIndex < config.environments.count else { return }
            switch id {
            case "svc_id": config.environments[selectedEnvIndex].services[row].id = val
            case "svc_label": config.environments[selectedEnvIndex].services[row].label = val
            case "svc_port": config.environments[selectedEnvIndex].services[row].port = Int(val) ?? config.environments[selectedEnvIndex].services[row].port
            case "svc_path": config.environments[selectedEnvIndex].services[row].path = val
            default: break
            }
        }
    }

    func tableViewSelectionDidChange(_ notification: Notification) {
        guard let table = notification.object as? NSTableView, table.tag == 1 else { return }
        selectedEnvIndex = table.selectedRow >= 0 ? table.selectedRow : 0
        svcTable.reloadData()
    }

    @objc func addEnvironment() {
        config.environments.append(TiltEnvironment(
            id: "new-env", name: "New Environment",
            repoDir: NSHomeDirectory(),
            tiltfile: "Tiltfile",
            tiltPort: 10350 + config.environments.count,
            description: "",
            services: []
        ))
        envTable.reloadData()
    }

    @objc func removeEnvironment() {
        let row = envTable.selectedRow
        guard row >= 0 else { return }
        config.environments.remove(at: row)
        selectedEnvIndex = max(0, min(selectedEnvIndex, config.environments.count - 1))
        envTable.reloadData()
        svcTable.reloadData()
    }

    @objc func addService() {
        guard selectedEnvIndex >= 0, selectedEnvIndex < config.environments.count else { return }
        config.environments[selectedEnvIndex].services.append(
            ServiceDef(id: "new-svc", label: "New Service", port: 3000, path: "/")
        )
        svcTable.reloadData()
    }

    @objc func removeService() {
        let row = svcTable.selectedRow
        guard row >= 0, selectedEnvIndex >= 0, selectedEnvIndex < config.environments.count else { return }
        config.environments[selectedEnvIndex].services.remove(at: row)
        svcTable.reloadData()
    }

    @objc func savePrefs() {
        config.dashboardUrl = dashboardUrlField.stringValue
        saveConfig(config)
        onSave(config)
        window?.close()
    }

    @objc func cancelPrefs() {
        window?.close()
    }
}

// ─── App Delegate ───────────────────────────────────────────────────
class AppDelegate: NSObject, NSApplicationDelegate {
    var statusItem: NSStatusItem!
    var serverProcess: Process?
    var serverStatusItem: NSMenuItem!
    var config: LauncherConfig!
    var prefsController: PreferencesWindowController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        config = loadConfig()

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = statusItem.button {
            button.title = "▲"
            button.font = NSFont.systemFont(ofSize: 14, weight: .bold)
        }

        buildMenu()
        startServer()
    }

    func applicationWillTerminate(_ notification: Notification) {
        stopServer()
    }

    func buildMenu() {
        let menu = NSMenu()

        let header = NSMenuItem(title: "Tilt Launcher", action: nil, keyEquivalent: "")
        header.isEnabled = false
        header.attributedTitle = NSAttributedString(
            string: "Tilt Launcher",
            attributes: [.font: NSFont.systemFont(ofSize: 13, weight: .bold)]
        )
        menu.addItem(header)
        menu.addItem(NSMenuItem.separator())

        let dashItem = NSMenuItem(title: "Open Dashboard", action: #selector(openDashboard), keyEquivalent: "d")
        dashItem.target = self
        menu.addItem(dashItem)
        menu.addItem(NSMenuItem.separator())

        for env in config.environments {
            let envHeader = NSMenuItem(title: env.name, action: nil, keyEquivalent: "")
            envHeader.isEnabled = false
            envHeader.attributedTitle = NSAttributedString(
                string: env.name.uppercased(),
                attributes: [
                    .font: NSFont.systemFont(ofSize: 10, weight: .semibold),
                    .foregroundColor: NSColor.secondaryLabelColor,
                ]
            )
            menu.addItem(envHeader)

            let tiltItem = NSMenuItem(title: "Tilt Dashboard — :\(env.tiltPort)", action: #selector(openURL(_:)), keyEquivalent: "")
            tiltItem.target = self
            tiltItem.representedObject = "http://localhost:\(env.tiltPort)"
            menu.addItem(tiltItem)

            for svc in env.services {
                let item = NSMenuItem(title: "\(svc.label) — :\(svc.port)", action: #selector(openURL(_:)), keyEquivalent: "")
                item.target = self
                item.representedObject = "http://localhost:\(svc.port)"
                menu.addItem(item)
            }

            menu.addItem(NSMenuItem.separator())
        }

        serverStatusItem = NSMenuItem(title: "Server: Starting...", action: nil, keyEquivalent: "")
        serverStatusItem.isEnabled = false
        menu.addItem(serverStatusItem)

        let restartItem = NSMenuItem(title: "Restart Server", action: #selector(restartServer), keyEquivalent: "r")
        restartItem.target = self
        menu.addItem(restartItem)

        menu.addItem(NSMenuItem.separator())

        // Launch at Login toggle
        let launchAtLogin = NSMenuItem(title: "Launch at Login", action: #selector(toggleLaunchAtLogin(_:)), keyEquivalent: "")
        launchAtLogin.target = self
        launchAtLogin.state = isLaunchAtLoginEnabled() ? .on : .off
        menu.addItem(launchAtLogin)

        let prefsItem = NSMenuItem(title: "Preferences…", action: #selector(openPreferences), keyEquivalent: ",")
        prefsItem.target = self
        menu.addItem(prefsItem)

        menu.addItem(NSMenuItem.separator())

        let quitItem = NSMenuItem(title: "Quit Tilt Launcher", action: #selector(quitApp), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)

        statusItem.menu = menu
    }

    func startServer() {
        let nodePath = NODE_PATH
        let process = Process()

        if nodePath == "/usr/bin/env" {
            process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
            process.arguments = ["node", SERVER_SCRIPT]
        } else {
            process.executableURL = URL(fileURLWithPath: nodePath)
            process.arguments = [SERVER_SCRIPT]
        }

        process.environment = ProcessInfo.processInfo.environment.merging([
            "PATH": "\(NSString(string: nodePath).deletingLastPathComponent):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
            "TILT_LAUNCHER_CONFIG": CONFIG_PATH,
        ]) { _, new in new }
        process.currentDirectoryURL = URL(fileURLWithPath: RESOURCES_DIR)

        FileManager.default.createFile(atPath: LOG_PATH, contents: nil)
        let logHandle = FileHandle(forWritingAtPath: LOG_PATH)
        process.standardOutput = logHandle
        process.standardError = logHandle

        process.terminationHandler = { [weak self] _ in
            DispatchQueue.main.async { self?.updateStatus(running: false) }
        }

        do {
            try process.run()
            serverProcess = process
            updateStatus(running: true)
        } catch {
            print("Failed to start server: \(error)")
            updateStatus(running: false)
        }
    }

    func stopServer() {
        guard let process = serverProcess, process.isRunning else { return }
        process.terminate()
        DispatchQueue.global().async { process.waitUntilExit() }
        serverProcess = nil
    }

    func updateStatus(running: Bool) {
        if running {
            serverStatusItem.title = "● Server Running"
            serverStatusItem.attributedTitle = NSAttributedString(
                string: "● Server Running",
                attributes: [.foregroundColor: NSColor.controlTextColor, .font: NSFont.systemFont(ofSize: 13, weight: .medium)]
            )
            statusItem.button?.title = "▲"
        } else {
            serverStatusItem.title = "○ Server Stopped"
            serverStatusItem.attributedTitle = NSAttributedString(
                string: "○ Server Stopped",
                attributes: [.foregroundColor: NSColor.secondaryLabelColor, .font: NSFont.systemFont(ofSize: 13, weight: .medium)]
            )
            statusItem.button?.title = "△"
        }
    }

    @objc func openDashboard() {
        NSWorkspace.shared.open(URL(string: config.dashboardUrl)!)
    }

    @objc func openURL(_ sender: NSMenuItem) {
        guard let urlString = sender.representedObject as? String,
              let url = URL(string: urlString) else { return }
        NSWorkspace.shared.open(url)
    }

    func isLaunchAtLoginEnabled() -> Bool {
        return SMAppService.mainApp.status == .enabled
    }

    @objc func toggleLaunchAtLogin(_ sender: NSMenuItem) {
        do {
            if isLaunchAtLoginEnabled() {
                try SMAppService.mainApp.unregister()
                sender.state = .off
            } else {
                try SMAppService.mainApp.register()
                sender.state = .on
            }
        } catch {
            print("Failed to toggle launch at login: \(error)")
        }
    }

    @objc func openPreferences() {
        if prefsController == nil || prefsController?.window?.isVisible == false {
            prefsController = PreferencesWindowController(config: config) { [weak self] newConfig in
                self?.config = newConfig
                self?.buildMenu()
                self?.restartServer()
            }
        }
        prefsController?.showWindow(nil)
        prefsController?.window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc func restartServer() {
        stopServer()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            self?.startServer()
        }
    }

    @objc func quitApp() {
        stopServer()
        NSApp.terminate(nil)
    }
}

// ─── Main ───────────────────────────────────────────────────────────
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let delegate = AppDelegate()
app.delegate = delegate
app.run()
