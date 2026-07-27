// Discoverable Playwright entrypoint. The scenario module is kept separate so Bun's
// repository test collector can parse it without executing browser-only tests.
import './fuma-context-switching.spec'
