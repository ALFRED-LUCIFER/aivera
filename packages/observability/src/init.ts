import { useAzureMonitor } from '@azure/monitor-opentelemetry';
import { redactingLogRecordProcessor, redactingSpanProcessor } from './redact';

/**
 * Exports traces, metrics and logs to Application Insights with the Azure Monitor OpenTelemetry distro. No connection
 * string (local development, tests) leaves telemetry off. Call once, at process start, before other imports.
 */
export function initTelemetry(service: 'web' | 'worker', connectionString: string | undefined): void {
  if (!connectionString) return;
  // The cloud role name in Application Insights.
  process.env['OTEL_SERVICE_NAME'] ??= `aivera-${service}`;
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
