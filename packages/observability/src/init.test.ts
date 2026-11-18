import { useAzureMonitor } from '@azure/monitor-opentelemetry';
import { describe, expect, it, vi } from 'vitest';
import { initTelemetry } from './init';
import { redactingLogRecordProcessor, redactingSpanProcessor } from './redact';

vi.mock('@azure/monitor-opentelemetry', () => ({ useAzureMonitor: vi.fn() }));

describe('initTelemetry', () => {
  it('stays off without a connection string (local development, tests)', () => {
    initTelemetry('web', undefined);
    expect(useAzureMonitor).not.toHaveBeenCalled();
  });

  // SAFETY: mutation check: dropped spanProcessors from the options -> this test failed
  it('exports every trace through the redacting processors, with Live Metrics off', () => {
    initTelemetry('web', 'InstrumentationKey=00000000-0000-0000-0000-000000000000');
    expect(useAzureMonitor).toHaveBeenCalledWith(
      expect.objectContaining({
        samplingRatio: 1,
        tracesPerSecond: 0,
        enableLiveMetrics: false,
        spanProcessors: [redactingSpanProcessor],
        logRecordProcessors: [redactingLogRecordProcessor],
      }),
    );
  });
});
