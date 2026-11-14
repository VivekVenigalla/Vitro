// vitro-keyd — detects a double-tap of the Option key system-wide and prints
// "toggle" on stdout. It only polls modifier state and "time since last event"
// counters, so it needs no Accessibility or Input Monitoring permission and
// never sees which keys are typed.
import CoreGraphics
import Foundation

setvbuf(stdout, nil, _IOLBF, 0)

let maxHold = 0.30 // a tap is Option held for at most this long
let maxGap = 0.40 // second tap must begin within this long of the first release
let others: CGEventFlags = [.maskCommand, .maskControl, .maskShift]
let noisy: [CGEventType] = [.keyDown, .leftMouseDown, .rightMouseDown, .otherMouseDown, .scrollWheel]

func now() -> Double { ProcessInfo.processInfo.systemUptime }

/// True if any key press, click or scroll happened since `t`.
func activity(since t: Double) -> Bool {
    let window = now() - t
    for type in noisy where CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: type) < window {
        return true
    }
    return false
}

var wasDown = false
var downAt = 0.0
var clean = false
var firstDownAt = -1.0
var firstUpAt = -1.0

func reset() {
    firstDownAt = -1
    firstUpAt = -1
}

let timer = DispatchSource.makeTimerSource(queue: .main)
timer.schedule(deadline: .now(), repeating: .milliseconds(10), leeway: .milliseconds(2))
timer.setEventHandler {
    let flags = CGEventSource.flagsState(.combinedSessionState)
    let down = flags.contains(.maskAlternate)
    let chord = !flags.intersection(others).isEmpty
    let t = now()
    if down && !wasDown {
        downAt = t
        clean = !chord
        if firstUpAt >= 0 && t - firstUpAt > maxGap { reset() }
    } else if down && chord {
        clean = false
    } else if !down && wasDown {
        let tap = clean && (t - downAt) <= maxHold && !activity(since: downAt)
        if !tap {
            reset()
        } else if firstUpAt >= 0 && !activity(since: firstDownAt) {
            print("toggle")
            reset()
        } else {
            firstDownAt = downAt
            firstUpAt = t
        }
    } else if !down && firstUpAt >= 0 && t - firstUpAt > maxGap {
        reset()
    }
    wasDown = down
}
timer.resume()

// Exit with the parent: stdin closes when Vitro quits or crashes.
DispatchQueue.global(qos: .utility).async {
    while let _ = readLine(strippingNewline: false) {}
    exit(0)
}

dispatchMain()
