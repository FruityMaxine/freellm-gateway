/**
 * Admin user + session management.
 *
 * Passwords are stored as `scrypt$<salt>$<hash>` (forwards-compatible with
 * the seed's helper) so we don't need bcrypt as a runtime dependency on the
 * Vega server, which keeps the install footprint small.
 */
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

const FAILED_LOGIN_LIMIT = 5;
const LOCKOUT_MS = 10 * 60_000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60_000; // 7 days

export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(plain, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(plain, salt, 64);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export interface LoginResult {
  ok: true;
  userId: string;
  sessionToken: string;
  expiresAt: Date;
}

export interface LoginFailure {
  ok: false;
  reason: 'unknown_user' | 'locked' | 'bad_password' | 'disabled';
  lockedUntil?: Date;
}

export class AdminUserService {
  constructor(private prisma: PrismaClient) {}

  async login(
    username: string,
    password: string,
    meta: { ip?: string | null; userAgent?: string | null } = {},
  ): Promise<LoginResult | LoginFailure> {
    const user = await this.prisma.adminUser.findUnique({ where: { username } });
    if (!user) return { ok: false, reason: 'unknown_user' };
    if (!user.enabled) return { ok: false, reason: 'disabled' };
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      return { ok: false, reason: 'locked', lockedUntil: user.lockedUntil };
    }
    if (!verifyPassword(password, user.passwordHash)) {
      const failed = user.failedLogins + 1;
      const lockedUntil = failed >= FAILED_LOGIN_LIMIT ? new Date(Date.now() + LOCKOUT_MS) : null;
      await this.prisma.adminUser.update({
        where: { id: user.id },
        data: { failedLogins: failed, lockedUntil },
      });
      return {
        ok: false,
        reason: 'bad_password',
        ...(lockedUntil ? { lockedUntil } : {}),
      };
    }

    // Successful login — reset counter, mint session
    const sessionPlain = randomBytes(32).toString('hex');
    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: sha256(sessionPlain),
        ...(meta.userAgent ? { userAgent: meta.userAgent } : {}),
        ...(meta.ip ? { ip: meta.ip } : {}),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });
    await this.prisma.adminUser.update({
      where: { id: user.id },
      data: {
        failedLogins: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        ...(meta.ip ? { lastLoginIp: meta.ip } : {}),
      },
    });
    return { ok: true, userId: user.id, sessionToken: sessionPlain, expiresAt: session.expiresAt };
  }

  async resolveSession(plain: string) {
    const tokenHash = sha256(plain);
    const session = await this.prisma.session.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!session) return null;
    if (session.revokedAt) return null;
    if (session.expiresAt.getTime() <= Date.now()) return null;
    return session;
  }

  async logout(plain: string) {
    const tokenHash = sha256(plain);
    await this.prisma.session.updateMany({ where: { tokenHash }, data: { revokedAt: new Date() } });
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string): Promise<boolean> {
    const user = await this.prisma.adminUser.findUnique({ where: { id: userId } });
    if (!user) return false;
    if (!verifyPassword(oldPassword, user.passwordHash)) return false;
    await this.prisma.adminUser.update({
      where: { id: userId },
      data: { passwordHash: hashPassword(newPassword), failedLogins: 0, lockedUntil: null },
    });
    return true;
  }

  // ===== Tick 53 v1.7.25.0：管理员账号 CRUD =====

  async listUsers() {
    const rows = await this.prisma.adminUser.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        username: true,
        enabled: true,
        failedLogins: true,
        lockedUntil: true,
        lastLoginAt: true,
        lastLoginIp: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return rows.map((u) => ({
      ...u,
      locked: !!u.lockedUntil && u.lockedUntil.getTime() > Date.now(),
    }));
  }

  async createUser(
    username: string,
    password: string,
    role: 'admin' | 'user' = 'user',
  ): Promise<{ id: string } | { error: string }> {
    const trimmed = username.trim();
    if (trimmed.length < 3) return { error: '用户名至少 3 个字符' };
    if (trimmed.length > 32) return { error: '用户名最多 32 个字符' };
    if (password.length < 8) return { error: '密码至少 8 个字符' };
    const existing = await this.prisma.adminUser.findUnique({ where: { username: trimmed } });
    if (existing) return { error: '用户名已存在' };
    const u = await this.prisma.adminUser.create({
      data: { username: trimmed, passwordHash: hashPassword(password), role },
    });
    return { id: u.id };
  }

  async setRole(userId: string, role: 'admin' | 'user'): Promise<{ ok: true } | { error: string }> {
    const user = await this.prisma.adminUser.findUnique({ where: { id: userId } });
    if (!user) return { error: '用户不存在' };
    if (user.role === 'admin' && role === 'user') {
      // 不能把最后一个 admin 降级
      const adminCount = await this.prisma.adminUser.count({ where: { role: 'admin', enabled: true } });
      if (adminCount <= 1) return { error: '系统至少需要保留 1 个 admin 角色' };
    }
    await this.prisma.adminUser.update({ where: { id: userId }, data: { role } });
    return { ok: true };
  }

  async setEnabled(userId: string, enabled: boolean): Promise<boolean> {
    const user = await this.prisma.adminUser.findUnique({ where: { id: userId } });
    if (!user) return false;
    await this.prisma.adminUser.update({ where: { id: userId }, data: { enabled } });
    return true;
  }

  async unlock(userId: string): Promise<boolean> {
    const user = await this.prisma.adminUser.findUnique({ where: { id: userId } });
    if (!user) return false;
    await this.prisma.adminUser.update({
      where: { id: userId },
      data: { failedLogins: 0, lockedUntil: null },
    });
    return true;
  }

  /** 重置任意 admin 密码（不需要旧密码 — 仅当前登录的管理员能调，路由层把关）。 */
  async resetPassword(userId: string, newPassword: string): Promise<{ ok: true } | { error: string }> {
    if (newPassword.length < 8) return { error: '新密码至少 8 个字符' };
    const user = await this.prisma.adminUser.findUnique({ where: { id: userId } });
    if (!user) return { error: '用户不存在' };
    await this.prisma.adminUser.update({
      where: { id: userId },
      data: { passwordHash: hashPassword(newPassword), failedLogins: 0, lockedUntil: null },
    });
    return { ok: true };
  }

  /** 删除管理员；防 self-delete + 防最后一个管理员被删空。 */
  async deleteUser(userId: string, currentUserId: string): Promise<{ ok: true } | { error: string }> {
    if (userId === currentUserId) return { error: '不能删除当前登录账号' };
    const totalEnabled = await this.prisma.adminUser.count({ where: { enabled: true } });
    if (totalEnabled <= 1) return { error: '系统至少需要保留 1 个启用的管理员' };
    const exists = await this.prisma.adminUser.findUnique({ where: { id: userId } });
    if (!exists) return { error: '用户不存在' };
    // 级联删 sessions(schema 已设 onDelete: Cascade)
    await this.prisma.adminUser.delete({ where: { id: userId } });
    return { ok: true };
  }

  // ===== Tick 53：会话管理 =====

  async listSessions() {
    const rows = await this.prisma.session.findMany({
      where: { revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
      include: { user: { select: { id: true, username: true } } },
    });
    return rows.map((s) => ({
      id: s.id,
      userId: s.userId,
      username: s.user.username,
      userAgent: s.userAgent,
      ip: s.ip,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      expiresAt: s.expiresAt,
    }));
  }

  async revokeSession(sessionId: string): Promise<boolean> {
    const s = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!s) return false;
    await this.prisma.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
    return true;
  }
}
