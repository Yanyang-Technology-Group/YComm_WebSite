/**
 * Central schema barrel. Every table, every enum — one import point for the
 * whole application, and the single definition fed to `drizzle-kit`.
 */
export * from './identity';
export * from './access';
export * from './forum';
export * from './downloads';
export * from './moderation';
export * from './notify';
export * from './badges';
export * from './system';