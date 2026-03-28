# Changelog

All notable changes to this project will be documented in this file.

## [0.2.0] - 2026-03-28

### Added

- New README with AI pipeline positioning, AnyModel/AnySerp use cases, LangGraph comparison
- Published to npm
- Exhaustive test suite (33 tests: engine, store, types)
- "See Also" cross-links to related packages
- GitHub Actions CI (Node 20/22 matrix) and publish workflow

## [0.1.0] - 2026-03-26

### Added

- Initial release
- `Workflow` engine with chainable `.step()` and `.resource()` API
- `Step` interface with `concurrent` and `collective` execution modes
- Per-item concurrency control with configurable limits
- Automatic retry with exponential backoff
- `FileStore` with immutable write-once step outputs
- Pluggable `WorkflowStore` interface for custom persistence
- Progress callbacks via `onProgress`
- Abort signal support for cancellation
- Resume support — completed items and cached step outputs are skipped on restart
