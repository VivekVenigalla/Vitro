// Generates the menu-bar template icon and the app icon.
//   swift scripts/make-icons.swift
import AppKit

func render(_ px: Int, _ draw: (CGContext, CGFloat) -> Void) -> Data {
    let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8, samplesPerPixel: 4,
        hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    let ctx = NSGraphicsContext(bitmapImageRep: rep)!
    NSGraphicsContext.current = ctx
    draw(ctx.cgContext, CGFloat(px))
    ctx.flushGraphics()
    NSGraphicsContext.current = nil
    return rep.representation(using: .png, properties: [:])!
}

func wave(_ s: CGFloat, level: CGFloat, amp: CGFloat) -> CGPath {
    let p = CGMutablePath()
    p.move(to: CGPoint(x: 0, y: s * level))
    p.addCurve(to: CGPoint(x: s, y: s * level),
               control1: CGPoint(x: s * 0.3, y: s * (level + amp)),
               control2: CGPoint(x: s * 0.62, y: s * (level - amp)))
    p.addLine(to: CGPoint(x: s, y: 0))
    p.addLine(to: CGPoint(x: 0, y: 0))
    p.closeSubpath()
    return p
}

// Menu-bar glyph: a glass orb half full of liquid. Black + alpha (template image).
func tray(_ c: CGContext, _ s: CGFloat) {
    let inset = s * 0.12
    let lw = s * 0.085
    let circle = CGRect(x: inset, y: inset, width: s - inset * 2, height: s - inset * 2)
    c.setStrokeColor(NSColor.black.cgColor)
    c.setLineWidth(lw)
    c.strokeEllipse(in: circle)
    c.saveGState()
    c.addEllipse(in: circle.insetBy(dx: lw * 1.15, dy: lw * 1.15))
    c.clip()
    c.addPath(wave(s, level: 0.5, amp: 0.13))
    c.setFillColor(NSColor.black.cgColor)
    c.fillPath()
    c.restoreGState()
}

// App icon: mesh-gradient squircle with the orb on top.
func appIcon(_ c: CGContext, _ s: CGFloat) {
    let cs = CGColorSpaceCreateDeviceRGB()
    let pad = s * 0.098
    let rect = CGRect(x: pad, y: pad, width: s - pad * 2, height: s - pad * 2)
    let squircle = CGPath(roundedRect: rect, cornerWidth: rect.width * 0.225, cornerHeight: rect.width * 0.225, transform: nil)
    c.saveGState()
    c.addPath(squircle)
    c.clip()
    func rgb(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat, _ a: CGFloat = 1) -> CGColor { CGColor(colorSpace: cs, components: [r / 255, g / 255, b / 255, a])! }
    let base = CGGradient(colorsSpace: cs, colors: [rgb(28, 17, 80), rgb(58, 23, 102), rgb(15, 47, 107)] as CFArray, locations: [0, 0.5, 1])!
    c.drawLinearGradient(base, start: CGPoint(x: 0, y: s), end: CGPoint(x: s, y: 0), options: [])
    func blob(_ x: CGFloat, _ y: CGFloat, _ r: CGFloat, _ col: CGColor) {
        let g = CGGradient(colorsSpace: cs, colors: [col, col.copy(alpha: 0)!] as CFArray, locations: [0, 1])!
        c.drawRadialGradient(g, startCenter: CGPoint(x: s * x, y: s * y), startRadius: 0, endCenter: CGPoint(x: s * x, y: s * y), endRadius: s * r, options: [])
    }
    blob(0.18, 0.86, 0.55, rgb(255, 93, 143, 0.95))
    blob(0.9, 0.8, 0.5, rgb(122, 92, 255, 0.95))
    blob(0.3, 0.1, 0.5, rgb(31, 182, 255, 0.9))
    blob(0.92, 0.12, 0.42, rgb(255, 169, 77, 0.9))
    c.restoreGState()

    let r = s * 0.27
    let orb = CGRect(x: s / 2 - r, y: s / 2 - r, width: r * 2, height: r * 2)
    c.setShadow(offset: CGSize(width: 0, height: -s * 0.02), blur: s * 0.05, color: rgb(0, 0, 0, 0.45))
    c.setFillColor(rgb(255, 255, 255, 0.2))
    c.fillEllipse(in: orb)
    c.setShadow(offset: .zero, blur: 0, color: nil)
    c.saveGState()
    c.addEllipse(in: orb)
    c.clip()
    c.addPath(wave(s, level: 0.5, amp: 0.07))
    c.clip()
    let liquid = CGGradient(colorsSpace: cs, colors: [rgb(56, 189, 248), rgb(14, 165, 233), rgb(245, 158, 11)] as CFArray, locations: [0, 0.45, 1])!
    c.drawLinearGradient(liquid, start: CGPoint(x: 0, y: s * 0.58), end: CGPoint(x: 0, y: s * 0.22), options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
    c.restoreGState()
    c.setStrokeColor(rgb(255, 255, 255, 0.75))
    c.setLineWidth(s * 0.012)
    c.strokeEllipse(in: orb)
    c.saveGState()
    c.addEllipse(in: orb)
    c.clip()
    let shine = CGGradient(colorsSpace: cs, colors: [rgb(255, 255, 255, 0.7), rgb(255, 255, 255, 0)] as CFArray, locations: [0, 1])!
    c.drawRadialGradient(shine, startCenter: CGPoint(x: s * 0.42, y: s * 0.67), startRadius: 0, endCenter: CGPoint(x: s * 0.42, y: s * 0.67), endRadius: s * 0.13, options: [])
    c.restoreGState()
}

let fm = FileManager.default
let root = URL(fileURLWithPath: fm.currentDirectoryPath)
let assets = root.appendingPathComponent("electron/assets")
let iconset = root.appendingPathComponent("build/icon.iconset")
try fm.createDirectory(at: assets, withIntermediateDirectories: true)
try fm.createDirectory(at: iconset, withIntermediateDirectories: true)

try render(18, tray).write(to: assets.appendingPathComponent("trayTemplate.png"))
try render(36, tray).write(to: assets.appendingPathComponent("trayTemplate@2x.png"))
for (name, px) in [("16x16", 16), ("16x16@2x", 32), ("32x32", 32), ("32x32@2x", 64), ("128x128", 128), ("128x128@2x", 256), ("256x256", 256), ("256x256@2x", 512), ("512x512", 512), ("512x512@2x", 1024)] {
    try render(px, appIcon).write(to: iconset.appendingPathComponent("icon_\(name).png"))
}
let p = Process()
p.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
p.arguments = ["-c", "icns", iconset.path, "-o", root.appendingPathComponent("build/icon.icns").path]
try p.run()
p.waitUntilExit()
print("icons written")
