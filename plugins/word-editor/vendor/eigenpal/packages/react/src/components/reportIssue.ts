// Re-export the framework-agnostic helpers so existing React imports keep working.
// The core package is the semantic engine and
// owns no issue-reporting URL builder, so the file is ported verbatim into `lib/`
// alongside the component that uses it.
export { buildReportIssueUrl, openReportIssue, type ReportIssueEnv } from '../lib/reportIssue';
