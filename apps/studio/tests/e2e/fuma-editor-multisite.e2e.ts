// Discoverable Playwright entrypoint. The scenario module guards registration so
// Bun's repository collector can import this wrapper without executing Playwright APIs.
import './fuma-editor-multisite.spec'
