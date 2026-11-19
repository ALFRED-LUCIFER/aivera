import { useAzureMonitor } from '@azure/monitor-opentelemetry';
import { redactingLogRecordProcessor, redactingSpanProcessor } from './redact.ts';

/**
 * Exports traces, metrics and logs to Application Insights with the Azure Monitor OpenTelemetry distro. No connection
 * string (local development, tests) leaves telemetry off. Call once, at process start, before other imports.
 */
export function initTelemetry(service: 'web' | 'worker', connectionString: string | undefined): void {
  if (!connectionString) return;
  // The cloud role name in Application Insights.
  process.env['OTEL_SERVICE_NAME'] ??= `aivera-${service}`;
  // Statsbeat (the SDK's own usage counters) goes to a West US endpoint, outside the region (AGENTS.md 1.10). The
  // legacy name turns all of it off; the current one only the non-essential part.
  // shortcut: the distro still polls settings.sdk.monitor.azure.com for its config; no switch exists in 1.20.1, recheck on upgrade
  process.env['APPLICATION_INSIGHTS_NO_STATSBEAT'] ??= 'true';
  process.env['APPLICATIONINSIGHTS_STATSBEAT_DISABLED'] ??= 'true';
  useAzureMonitor({
    azureMonitorExporterOptions: { connectionString },
    // Every trace in dev (the distro's default is a 5-per-second rate limit).
    // shortcut: 100% sampling; set a ratio when pilot traffic makes ingestion cost (AIV-P5-010)
    samplingRatio: 1,
    tracesPerSecond: 0,
    // Live Metrics reads spans before the processors below run; off, so nothing reaches Azure unredacted.
    enableLiveMetrics: false,
    spanProcessors: [redactingSpanProcessor],
    logRecordProcessors: [redactingLogRecordProcessor],
  });
}
