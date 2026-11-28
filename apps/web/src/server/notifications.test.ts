import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getNotifications } from './notifications';

// AIV-P1-165 Scenario Outline: Send actions are off the pilot path. Every email the web app queues (the rubric's
// approval request and decision, on Job saved, the rubric page and a hiring-owner change, and the Members invitation)
// comes from getNotifications, so where OUTBOUND is off none reaches the notifications outbox.

let outbound: 'on' | 'off' = 'off';
const createNotifications = vi.hoisted(() => vi.fn(() => ({ queueEmail: () => undefined })));
vi.mock('./env', () => ({
  env: () => ({
    APP_ENV: 'dev',
    OUTBOUND: outbound,
    NOTIFICATIONS_ENCRYPTION_KEY: 'key',
    AUTH_URL: 'https://app.credalent.example',
  }),
}));
vi.mock('@credalent/notifications/composition', () => ({ createNotifications }));
vi.mock('./auth', () => ({}));
vi.mock('./workspace', () => ({}));

const src = join(import.meta.dirname, '..');
// The app's own code, not its tests.
const sources = (readdirSync(src, { recursive: true }) as string[]).filter((f) => /(?<!\.test)\.tsx?$/.test(f));

describe('Where sending is off, the web app queues no email', () => {
  beforeEach(() => {
    outbound = 'off';
  });

  // SAFETY: mutation check: removed `!outboundOn() ||` from getNotifications -> this test failed (the module was built)
  it('with the email key and public origin set, OUTBOUND off gives no notifications module', () => {
    expect(getNotifications()).toBeNull();
    expect(createNotifications).not.toHaveBeenCalled();
  });

  it('OUTBOUND on gives it, with the public origin', () => {
    outbound = 'on';
    expect(getNotifications()).toMatchObject({ origin: 'https://app.credalent.example' });
  });

  // SAFETY: mutation check: called createNotifications in rubricEmails.ts -> this test failed
  it('no other file builds the notifications module, so nothing queues around the switch', () => {
    const builders = sources.filter((f) => readFileSync(join(src, f), 'utf8').includes('createNotifications('));
    expect(builders).toEqual(['server/notifications.ts']);
  });
});
