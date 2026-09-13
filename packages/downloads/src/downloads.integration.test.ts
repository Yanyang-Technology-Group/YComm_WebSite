import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { createInMemoryDb, schema, type DatabaseHandle } from '@ycomm/db';
import { consumeInviteCode, createInviteCode, hashPassword } from '@ycomm/identity';
import { errors } from '@ycomm/kernel';
import type { AccessSubject } from '@ycomm/access';
import {
  addLink,
  authorizedFetch,
  createCard,
  createResource,
  getResource,
  listPublishedResources,
  listVisibleCards,
  registerDownloadDeciders,
  reportDeadLinkByResource,
  reviewCard,
  updateCard,
  updateResourceMetadata,
} from './index';

let handle: DatabaseHandle;
/** 真实成员用户（download_logs.user_id / download_reports.reporter_id 外键需要）。 */
let memberId = '';

beforeEach(async () => {
  memberId = await seedUser('fetch-member', 'member');
});

function subject(overrides: Partial<AccessSubject> = {}): AccessSubject {
  return { id: memberId, role: 'member', level: 2, state: 'active', mutedUntil: null, banReason: null, ...overrides };
}

beforeAll(async () => {
  const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'db', 'migrations');
  handle = await createInMemoryDb({ migrationsFolder });
  await handle.runMigrations();
  registerDownloadDeciders();
});

afterEach(async () => {
  for (const table of [
    schema.downloadReports,
    schema.downloadLogs,
    schema.downloadLinks,
    schema.downloadResources,
    schema.downloadCategories,
    schema.downloadCards,
    schema.inviteCodeUses,
    schema.inviteCodes,
    schema.moderationItems,
    schema.users,
  ]) {
    await handle.db.delete(table);
  }
});

async function seedUser(username: string, role: 'member' | 'admin' | 'owner'): Promise<string> {
  const [row] = await handle.db
    .insert(schema.users)
    .values({
      username,
      email: `${username}@example.com`,
      password_hash: await hashPassword('password-1'),
      role,
      state: 'active',
      display_name: username,
    })
    .returning({ id: schema.users.id });
  if (!row) throw new Error('no user');
  return row.id;
}

/** 测试里默认以站长身份建卡片（自动通过审核、对外可见）。 */
function seedCard(
  input: Parameters<typeof createCard>[1],
): Promise<Awaited<ReturnType<typeof createCard>>> {
  return createCard(handle.db, input, 'owner');
}

async function seedCategory(): Promise<string> {
  const [row] = await handle.db
    .insert(schema.downloadCategories)
    .values({ slug: 'tools', name: '工具', access_policy: { visibility: 'login', minLevel: 0, requireInvite: false } })
    .returning({ id: schema.downloadCategories.id });
  if (!row) throw new Error('no category');
  return row.id;
}

describe('resource state machine', () => {
  it('admin uploads need review; owner uploads publish directly', async () => {
    const categoryId = await seedCategory();
    const admin = await seedUser('admin-a', 'admin');
    const owner = await seedUser('owner-a', 'owner');

    const adminResource = await createResource(handle.db, {
      categoryId,
      authorId: admin,
      authorRole: 'admin',
      title: '管理员上传',
      sourceType: 'external',
    });
    expect(adminResource.status).toBe('pending_review');

    const items = await handle.db
      .select()
      .from(schema.moderationItems)
      .where(eq(schema.moderationItems.reason, 'admin_upload_review'));
    expect(items).toHaveLength(1);

    const ownerResource = await createResource(handle.db, {
      categoryId,
      authorId: owner,
      authorRole: 'owner',
      title: '站长直发',
      sourceType: 'external',
    });
    expect(ownerResource.status).toBe('published');
  });

  it('metadata edits do not re-open review; link changes on published admin resources do', async () => {
    const categoryId = await seedCategory();
    const admin = await seedUser('admin-a', 'admin');
    const owner = await seedUser('owner-a', 'owner');

    const published = await createResource(handle.db, {
      categoryId,
      authorId: owner,
      authorRole: 'owner',
      title: '已发布',
      sourceType: 'external',
    });
    await addLink(handle.db, {
      resourceId: published.id,
      sourceType: 'external',
      url: 'https://pan.baidu.com/s/abc',
    });
    // Owner-published stays published when links change (no higher authority).
    expect((await getResource(handle.db, published.id))?.status).toBe('published');

    // Admin-authored, owner-approved resource goes back to review on link change.
    const adminResource = await createResource(handle.db, {
      categoryId,
      authorId: admin,
      authorRole: 'admin',
      title: '管理员资源',
      sourceType: 'external',
    });
    await handle.db
      .update(schema.downloadResources)
      .set({ status: 'published', published_at: new Date() })
      .where(eq(schema.downloadResources.id, adminResource.id));

    const afterMeta = await updateResourceMetadata(handle.db, adminResource.id, { summary: '只改文案' });
    expect(afterMeta.status).toBe('published');

    await addLink(handle.db, {
      resourceId: adminResource.id,
      sourceType: 'external',
      url: 'https://pan.baidu.com/s/def',
    });
    expect((await getResource(handle.db, adminResource.id))?.status).toBe('pending_review');
  });

  it('external links are host allow-listed', async () => {
    const categoryId = await seedCategory();
    const owner = await seedUser('owner-a', 'owner');
    const resource = await createResource(handle.db, {
      categoryId,
      authorId: owner,
      authorRole: 'owner',
      title: '外链测试',
      sourceType: 'external',
    });
    await expect(
      addLink(handle.db, { resourceId: resource.id, sourceType: 'external', url: 'https://evil.example.com/file' }),
    ).rejects.toMatchObject({ code: errors.validation().code });
    await expect(
      addLink(handle.db, { resourceId: resource.id, sourceType: 'external', url: 'https://pan.baidu.com/s/xyz' }),
    ).resolves.toBeTruthy();
  });
});

describe('gated fetch', () => {
  it('external fetch returns the URL only through the gate and logs a download', async () => {
    const categoryId = await seedCategory();
    const owner = await seedUser('owner-a', 'owner');
    const resource = await createResource(handle.db, {
      categoryId,
      authorId: owner,
      authorRole: 'owner',
      title: '可下载资源',
      sourceType: 'external',
    });
    await addLink(handle.db, {
      resourceId: resource.id,
      sourceType: 'external',
      url: 'https://pan.baidu.com/s/xyz',
      extractCode: '1234',
    });

    const outcome = await authorizedFetch(handle.db, subject(), resource.id, { ip: '203.0.113.9' });
    expect(outcome).toMatchObject({ kind: 'external', url: 'https://pan.baidu.com/s/xyz', extractCode: '1234' });

    const logs = await handle.db
      .select()
      .from(schema.downloadLogs)
      .where(eq(schema.downloadLogs.resource_id, resource.id));
    expect(logs).toHaveLength(1);

    const [row] = await handle.db.select().from(schema.downloadResources).where(eq(schema.downloadResources.id, resource.id));
    expect(row?.download_count).toBe(1);
  });

  it('refuses unpublished resources with RESOURCE_NOT_PUBLISHED', async () => {
    const categoryId = await seedCategory();
    const admin = await seedUser('admin-a', 'admin');
    const resource = await createResource(handle.db, {
      categoryId,
      authorId: admin,
      authorRole: 'admin',
      title: '未审核',
      sourceType: 'external',
    });
    await expect(authorizedFetch(handle.db, subject(), resource.id, { ip: '203.0.113.9' })).rejects.toMatchObject({
      code: 'RESOURCE_NOT_PUBLISHED',
    });
  });

  it('enforces the daily quota from the log table', async () => {
    const categoryId = await seedCategory();
    const owner = await seedUser('owner-a', 'owner');
    const resource = await createResource(handle.db, {
      categoryId,
      authorId: owner,
      authorRole: 'owner',
      title: '限量资源',
      sourceType: 'external',
    });
    await addLink(handle.db, { resourceId: resource.id, sourceType: 'external', url: 'https://pan.baidu.com/s/q' });

    // Drain the daily budget (50) with synthetic log rows.
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const rows = Array.from({ length: 50 }, () => ({
      resource_id: resource.id,
      user_id: memberId,
      created_at: new Date(dayStart.getTime() + 1000),
    }));
    await handle.db.insert(schema.downloadLogs).values(rows);

    await expect(authorizedFetch(handle.db, subject(), resource.id, { ip: '203.0.113.9' })).rejects.toMatchObject({
      code: errors.rateLimited().code,
    });
  });

  it('published resources are only listed when visible', async () => {
    const categoryId = await seedCategory();
    const owner = await seedUser('owner-a', 'owner');
    await createResource(handle.db, {
      categoryId,
      authorId: owner,
      authorRole: 'owner',
      title: '列表可见',
      sourceType: 'external',
    });
    const { resources, total } = await listPublishedResources(handle.db, subject(), { categoryId });
    expect(total).toBe(1);
    expect(resources[0]?.title).toBe('列表可见');
  });
});

describe('guests', () => {
  it('guests may download PUBLIC resources and are rebuffed elsewhere', async () => {
    const categoryId = await seedCategory();
    const owner = await seedUser('owner-a', 'owner');

    const publicResource = await createResource(handle.db, {
      categoryId,
      authorId: owner,
      authorRole: 'owner',
      title: '公开资源',
      sourceType: 'external',
      policy: { visibility: 'public', minLevel: 0, requireInvite: false },
    });
    await addLink(handle.db, {
      resourceId: publicResource.id,
      sourceType: 'external',
      url: 'https://pan.baidu.com/s/guest1',
    });

    const outcome = await authorizedFetch(handle.db, null, publicResource.id, { ip: '203.0.113.7' });
    expect(outcome.kind).toBe('external');
  });

  it('guests are blocked from login-required resources', async () => {
    const categoryId = await seedCategory();
    const owner = await seedUser('owner-a', 'owner');
    const privateResource = await createResource(handle.db, {
      categoryId,
      authorId: owner,
      authorRole: 'owner',
      title: '仅会员',
      sourceType: 'external',
    });
    await addLink(handle.db, { resourceId: privateResource.id, sourceType: 'external', url: 'https://pan.baidu.com/s/pvt' });
    await expect(authorizedFetch(handle.db, null, privateResource.id, { ip: '203.0.113.7' })).rejects.toMatchObject({
      code: errors.loginRequired().code,
    });
  });
});

describe('dead-link reports', () => {
  it('flags a link for review after the threshold', async () => {
    const categoryId = await seedCategory();
    const owner = await seedUser('owner-a', 'owner');
    const resource = await createResource(handle.db, {
      categoryId,
      authorId: owner,
      authorRole: 'owner',
      title: '失效链接测试',
      sourceType: 'external',
    });
    await addLink(handle.db, { resourceId: resource.id, sourceType: 'external', url: 'https://pan.baidu.com/s/z' });

    for (let index = 0; index < 3; index++) {
      await reportDeadLinkByResource(handle.db, { resourceId: resource.id, reporterId: memberId });
    }

    const links = await handle.db.select().from(schema.downloadLinks).where(eq(schema.downloadLinks.resource_id, resource.id));
    expect(links[0]?.status).toBe('under_review');

    const items = await handle.db
      .select()
      .from(schema.moderationItems)
      .where(eq(schema.moderationItems.reason, 'dead_link_review'));
    expect(items.length).toBeGreaterThanOrEqual(1);
  });
});

describe('card portal nesting', () => {
  it('returns every level so child cards can be opened, and hides staff cards from guests', async () => {
    const root = await seedCard({ parentId: null, title: '工具', kind: 'container' });
    const child = await seedCard({ parentId: root.id, title: '网络工具', kind: 'container' });
    const grandChild = await seedCard({
      parentId: child.id,
      title: '代理工具',
      kind: 'resources',
    });
    const staffOnly = await seedCard({
      parentId: root.id,
      title: '内部资料',
      kind: 'container',
      visibility: 'staff',
    });

    // 访客：看得到公开卡片（含嵌套层级），看不到 staff 卡片。
    const guestCards = await listVisibleCards(handle.db, null);
    const guestIds = guestCards.map((card) => card.id);
    expect(guestIds).toContain(root.id);
    expect(guestIds).toContain(child.id);
    expect(guestIds).toContain(grandChild.id);
    expect(guestIds).not.toContain(staffOnly.id);

    // 子卡片的 parentId 必须保留，前台才能组树（否则「进入子卡片」永远是空的）。
    expect(guestCards.find((card) => card.id === grandChild.id)?.parent_id).toBe(child.id);

    // 管理员：staff 卡片可见。
    const adminIds = (await listVisibleCards(handle.db, subject({ role: 'admin' }))).map((card) => card.id);
    expect(adminIds).toContain(staffOnly.id);
  });

  it('invite visibility needs a bound 注册码 (staff exempt)', async () => {
    const inviteOnly = await seedCard({
      parentId: null,
      title: '会员专区',
      kind: 'container',
      visibility: 'invite',
    });

    // 访客：看不到。
    expect((await listVisibleCards(handle.db, null)).map((card) => card.id)).not.toContain(inviteOnly.id);

    // 已登录但没绑定注册码：看不到。
    expect((await listVisibleCards(handle.db, subject())).map((card) => card.id)).not.toContain(inviteOnly.id);

    // 绑定注册码后可见。
    const owner = await seedUser('invite-owner', 'owner');
    const code = await createInviteCode(handle.db, { createdBy: owner, maxUses: 1 });
    await consumeInviteCode(handle.db, code, memberId);
    expect((await listVisibleCards(handle.db, subject())).map((card) => card.id)).toContain(inviteOnly.id);

    // 管理员/站长不受限。
    const adminIds = (await listVisibleCards(handle.db, subject({ role: 'admin' }))).map((card) => card.id);
    expect(adminIds).toContain(inviteOnly.id);
  });

  it('已有的卡片可以移动进另一张卡片（真正的套娃开关）', async () => {
    const parent = await seedCard({ parentId: null, title: '父卡片', kind: 'container' });
    const loose = await seedCard({ parentId: null, title: '散着的卡片', kind: 'container' });

    // 一开始是根层。
    expect((await listVisibleCards(handle.db, null)).find((card) => card.id === loose.id)?.parent_id).toBeNull();

    await updateCard(handle.db, loose.id, { parentId: parent.id });

    const moved = (await listVisibleCards(handle.db, null)).find((card) => card.id === loose.id);
    expect(moved?.parent_id).toBe(parent.id);
    // 前台按 parentId 组树后，它出现在父卡片的子层级里。
    expect((await listVisibleCards(handle.db, null)).filter((card) => card.parent_id === parent.id)).toHaveLength(1);

    // 尺寸也可以单独改（编辑框里的宽/高）。
    const resized = await updateCard(handle.db, loose.id, { w: 3, h: 2 });
    expect([resized.w, resized.h]).toEqual([3, 2]);
  });

  it('下载卡片要站长审核：管理员建的默认待审核，站长通过后才可见', async () => {
    // 管理员建卡 → pending，前台不可见。
    const adminSubmitted = await createCard(
      handle.db,
      { parentId: null, title: '待审核卡片', kind: 'resources' },
      'admin',
    );
    expect(adminSubmitted.status).toBe('pending');
    expect((await listVisibleCards(handle.db, null)).map((card) => card.id)).not.toContain(adminSubmitted.id);

    // 站长审核通过 → 可见。
    await reviewCard(handle.db, adminSubmitted.id, 'approve');
    expect((await listVisibleCards(handle.db, null)).map((card) => card.id)).toContain(adminSubmitted.id);

    // 站长拒绝 → 保持不可见。
    const rejected = await createCard(
      handle.db,
      { parentId: null, title: '被拒卡片', kind: 'resources' },
      'admin',
    );
    await reviewCard(handle.db, rejected.id, 'reject');
    expect(rejected.status).toBe('pending');
    const cards = await listVisibleCards(handle.db, null);
    expect(cards.map((card) => card.id)).not.toContain(rejected.id);
    // 已通过的卡片仍然可见。
    expect(cards.map((card) => card.id)).toContain(adminSubmitted.id);
  });
});