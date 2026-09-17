import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const routePrefixes: Record<string, string> = {
  'health.ts': '/api',
  'auth.ts': '/api/auth',
  'forum.ts': '/api/forum',
  'downloads.ts': '/api/downloads',
  'admin.ts': '/api/admin',
  'uploads.ts': '/api/uploads',
  'users.ts': '/api/users',
  'notifications.ts': '/api/notifications',
};

const routesDir = fileURLToPath(new URL('.', import.meta.url));
const docsPath = fileURLToPath(new URL('../../../../docs/API.md', import.meta.url));

describe('REST API documentation route inventory', () => {
  it('mentions every route declared by the API routers', () => {
    const docs = readFileSync(docsPath, 'utf8');
    const missing: string[] = [];
    let routeCount = 0;

    for (const [file, prefix] of Object.entries(routePrefixes)) {
      const source = readFileSync(new URL(file, `file://${routesDir}`), 'utf8');
      const declarations = source.matchAll(/router\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g);
      for (const declaration of declarations) {
        routeCount += 1;
        const method = declaration[1]!.toUpperCase();
        const suffix = declaration[2] === '/' ? '' : declaration[2];
        const route = `${method} ${prefix}${suffix}`;
        if (!docs.includes(`\`${route}\``)) missing.push(route);
      }
    }

    expect(routeCount).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });
});
