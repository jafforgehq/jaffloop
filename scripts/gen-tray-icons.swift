// Draws the menu bar loop (and the loop with an overdue dot) as PNGs for Electron's Tray.
// Usage: swift scripts/gen-tray-icons.swift build/tray
// Files: loopTemplate.png / loopTemplate@2x.png (black, macOS tints them), loopDotLight*.png (dark ring, for light menu bars),
//        loopDotDark*.png (white ring, for dark menu bars). The dot is always the clay colour.
import AppKit
let out = CommandLine.arguments[1]
try? FileManager.default.createDirectory(atPath: out, withIntermediateDirectories: true)
func draw(scale: CGFloat, ring: NSColor, dot: Bool) -> Data {
    let w = 20 * scale, h = 18 * scale
    let img = NSImage(size: NSSize(width: w, height: h), flipped: false) { _ in
        let s = scale
        let c = NSPoint(x: 9 * s, y: 9 * s), r = 5.8 * s
        let path = NSBezierPath()
        path.appendArc(withCenter: c, radius: r, startAngle: 70, endAngle: 20, clockwise: false)
        path.lineWidth = 1.7 * s; path.lineCapStyle = .round
        ring.setStroke(); path.stroke()
        let tip = NSBezierPath(ovalIn: NSRect(x: c.x + r * cos(20 * .pi / 180) - 1.1 * s, y: c.y + r * sin(20 * .pi / 180) - 1.1 * s, width: 2.2 * s, height: 2.2 * s))
        ring.setFill(); tip.fill()
        if dot {
            NSColor(srgbRed: 0xE5 / 255, green: 0x65 / 255, blue: 0x4A / 255, alpha: 1).setFill()
            NSBezierPath(ovalIn: NSRect(x: 13.2 * s, y: 11.2 * s, width: 6 * s, height: 6 * s)).fill()
        }
        return true
    }
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(w), pixelsHigh: Int(h), bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    img.draw(in: NSRect(x: 0, y: 0, width: w, height: h))
    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])!
}
let sets: [(String, NSColor, Bool)] = [("loopTemplate", .black, false), ("loopDotLight", NSColor(white: 0.1, alpha: 1), true), ("loopDotDark", .white, true)]
for (name, color, dot) in sets {
    try! draw(scale: 1, ring: color, dot: dot).write(to: URL(fileURLWithPath: "\(out)/\(name).png"))
    try! draw(scale: 2, ring: color, dot: dot).write(to: URL(fileURLWithPath: "\(out)/\(name)@2x.png"))
}
print("wrote tray icons to \(out)")
