import { ALL_PERMISSIONS, DEFAULT_ROLES, PERMISSIONS, type RoleKey } from '@runtruck/permissions';
import { and, eq, inArray } from 'drizzle-orm';
import type { Database, DbExecutor } from '../client.js';
import { organizationMembers, organizations, permissions, rolePermissions, roles, userRoles, users } from '../schema/platform.js';
import { hashPassword } from '../security/password.js';

// Platform seeding: permission catalog, organizations with their default
// roles, and members. Shared by the demo seed and the test fixtures.

export async function ensurePermissionCatalog(db: DbExecutor): Promise<void> {
  await db
    .insert(permissions)
    .values(ALL_PERMISSIONS.map((key) => ({ key, description: PERMISSIONS[key] })))
    .onConflictDoNothing({ target: permissions.key });
}

export interface NewOrganization {
  name: string;
  shortName: string;
  companyNumber: string;
  timezone: string;
  mcNumber?: string;
  dotNumber?: string;
}

// Creates the organization and a copy of every default role (with permissions).
export async function createOrganizationWithRoles(db: DbExecutor, org: NewOrganization): Promise<{ organizationId: string; roleIds: Record<RoleKey, string> }> {
  const [created] = await db
    .insert(organizations)
    .values({ ...org, mcNumber: org.mcNumber ?? null, dotNumber: org.dotNumber ?? null })
    .returning({ id: organizations.id });
  if (!created) throw new Error('organization insert returned nothing');

  const catalog = await db.select({ id: permissions.id, key: permissions.key }).from(permissions).where(inArray(permissions.key, ALL_PERMISSIONS));
  const permissionIds = new Map(catalog.map((p) => [p.key, p.id]));

  const roleIds = {} as Record<RoleKey, string>;
  for (const role of DEFAULT_ROLES) {
    const [row] = await db
      .insert(roles)
      .values({ organizationId: created.id, key: role.key, name: role.name, description: role.description })
      .returning({ id: roles.id });
    if (!row) throw new Error(`role insert returned nothing for ${role.key}`);
    roleIds[role.key] = row.id;
    const links = role.permissions.map((p) => {
      const permissionId = permissionIds.get(p);
      if (!permissionId) throw new Error(`permission ${p} missing from catalog`);
      return { roleId: row.id, permissionId };
    });
    if (links.length > 0) await db.insert(rolePermissions).values(links);
  }
  return { organizationId: created.id, roleIds };
}

export interface NewMember {
  email: string;
  fullName: string;
  memberNumber: string;
  title: string;
  role: RoleKey;
}

export async function createMember(db: DbExecutor, organizationId: string, roleIds: Record<RoleKey, string>, member: NewMember, password: string): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({ email: member.email, fullName: member.fullName, passwordHash: await hashPassword(password) })
    .returning({ id: users.id });
  if (!user) throw new Error('user insert returned nothing');
  await db.insert(organizationMembers).values({ organizationId, userId: user.id, memberNumber: member.memberNumber, title: member.title });
  await db.insert(userRoles).values({ organizationId, userId: user.id, roleId: roleIds[member.role] });
  return user.id;
}

async function roleIdsOf(db: DbExecutor, organizationId: string): Promise<Record<RoleKey, string>> {
  const rows = await db.select({ id: roles.id, key: roles.key }).from(roles).where(eq(roles.organizationId, organizationId));
  return Object.fromEntries(rows.map((r) => [r.key, r.id])) as Record<RoleKey, string>;
}

export interface SeedAccessOptions {
  password: string;
  demoOrganizationId: string;
  users: NewMember[];
  otherOrganization: NewOrganization & { owner: NewMember };
}

// Test fixtures: extra role-limited members in the demo organization, plus a
// second tenant with its own owner.
export async function seedAccess(db: Database, options: SeedAccessOptions): Promise<{ otherOrganizationId: string }> {
  return db.transaction(async (tx) => {
    const demoRoles = await roleIdsOf(tx, options.demoOrganizationId);
    for (const member of options.users) await createMember(tx, options.demoOrganizationId, demoRoles, member, options.password);

    const { owner, ...org } = options.otherOrganization;
    const other = await createOrganizationWithRoles(tx, org);
    await createMember(tx, other.organizationId, other.roleIds, owner, options.password);
    return { otherOrganizationId: other.organizationId };
  });
}

export async function findOrganizationByCompanyNumber(db: DbExecutor, companyNumber: string): Promise<string | null> {
  const [row] = await db.select({ id: organizations.id }).from(organizations).where(and(eq(organizations.companyNumber, companyNumber))).limit(1);
  return row?.id ?? null;
}
