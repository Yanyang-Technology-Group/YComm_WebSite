import { logger } from '@ycomm/kernel';

/** Public wire protocol. No notification content or session data belongs here. */
export type RealtimeEvent =
  | { type: 'ready'; data: { userId: string; serverTime: string } }
  | { type: 'notification.changed'; data: { reason: 'created'; at: string } };
export type NotificationChangedEvent = Extract<RealtimeEvent, { type: 'notification.changed' }>;
export type NotificationListener = (userId: string, event: NotificationChangedEvent) => void;

/** Replace this boundary with Redis Pub/Sub or PostgreSQL LISTEN/NOTIFY for replicas. */
export interface NotificationEventBus {
  publish(userId: string, event: NotificationChangedEvent): void;
  subscribe(listener: NotificationListener): () => void;
}

export function createNotificationEventBus(): NotificationEventBus {
  const listeners = new Set<NotificationListener>();
  return {
    publish(userId, event) {
      for (const listener of listeners) {
        try { listener(userId, event); }
        catch { logger.error('notification subscriber failed'); }
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

// Next's route bundles and the custom Node server can load separate copies of
// this module. As with getDb(), share the actual bus across those copies/HMR.
const key = '__ycomm_notification_events_v1__';
export function getNotificationEventBus(): NotificationEventBus {
  const store = globalThis as unknown as Record<string, unknown>;
  return (store[key] ??= createNotificationEventBus()) as NotificationEventBus;
}
