// Draws the Jaffloop icon (an open loop on warm graphite) into an .iconset. Usage: swift make-icon.swift <out.iconset>
import AppKit
let out = CommandLine.arguments[1]
try? FileManager.default.createDirectory(atPath: out, withIntermediateDirectories: true)
func draw(_ px: Int) -> Data {
    let s = CGFloat(px)
    let img = NSImage(size: NSSize(width: s, height: s), flipped: false) { r in
        let inset = s * 0.055
        let body = NSBezierPath(roundedRect: r.insetBy(dx: inset, dy: inset), xRadius: s * 0.225, yRadius: s * 0.225)
        NSColor(srgbRed: 0x1B/255, green: 0x1B/255, blue: 0x1A/255, alpha: 1).setFill(); body.fill()
        NSColor(white: 1, alpha: 0.08).setStroke(); body.lineWidth = s * 0.004; body.stroke()
        let c = NSPoint(x: s / 2, y: s / 2), rad = s * 0.245
        let arc = NSBezierPath()
        arc.appendArc(withCenter: c, radius: rad, startAngle: 62, endAngle: 18, clockwise: false)
        arc.lineWidth = s * 0.07; arc.lineCapStyle = .round
        NSColor(srgbRed: 0xED/255, green: 0xEB/255, blue: 0xE6/255, alpha: 1).setStroke(); arc.stroke()
        let a = 18 * CGFloat.pi / 180
        let dot = NSBezierPath(ovalIn: NSRect(x: c.x + rad * cos(a) - s * 0.05, y: c.y + rad * sin(a) - s * 0.05, width: s * 0.1, height: s * 0.1))
        NSColor(srgbRed: 0xE5/255, green: 0x65/255, blue: 0x4A/255, alpha: 1).setFill(); dot.fill()
        return true
    }
    let rep = NSBitmapImageRep(data: img.tiffRepresentation!)!
    return rep.representation(using: .png, properties: [:])!
}
for (name, px) in [("16",16),("16@2x",32),("32",32),("32@2x",64),("128",128),("128@2x",256),("256",256),("256@2x",512),("512",512),("512@2x",1024)] {
    try! draw(px).write(to: URL(fileURLWithPath: "\(out)/icon_\(name.replacingOccurrences(of: "@2x", with: "")).png".replacingOccurrences(of: "icon_\(name.replacingOccurrences(of: "@2x", with: "")).png", with: name.contains("@2x") ? "icon_\(name.replacingOccurrences(of: "@2x", with: ""))x\(name.replacingOccurrences(of: "@2x", with: ""))@2x.png" : "icon_\(name)x\(name).png")))
}
