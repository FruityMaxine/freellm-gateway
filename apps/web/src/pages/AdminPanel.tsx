/**
 * 管理员面板（Tick 53 v1.7.25.0 引入）。
 *
 * 把"管理员级"运维收成一个集中入口，避免散在 Settings / Audit / Dashboard 等多处。
 * 风格统一：所有卡片复用 GlassCard + 同款卡头（图标 + 标题 + 描述 + 状态徽章）。
 *
 * 分组：
 *  1. 概览        — 系统健康度（复用 HealthOverviewCard）
 *  2. 账号       — 管理员账号 CRUD + 当前活跃会话 + 强制下线
 *  3. 运行时配置 — 重试策略 / 数据保留 / cron 调度状态（复用 Settings 页同款卡片，通过共享组件）
 *
 * 入口仅在已登录时显示（Sidebar 控制）。
 */
import { useState } from 'react';
import {
  Activity,
  KeyRound,
  LogOut,
  ShieldCheck,
  Trash2,
  Unlock,
  UserPlus,
  Users,
} from 'lucide-react';
import { PageHeader } from './_PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { GlassCard } from '@/components/bits/GlassCard';
import { HealthOverviewCard } from '@/components/data/HealthOverviewCard';
import {
  useAdminUsers,
  useCreateAdminUser,
  usePatchAdminUser,
  useDeleteAdminUser,
  useAdminSessions,
  useRevokeAdminSession,
  type AdminUserRow,
  type AdminSessionRow,
} from '@/lib/admin-users-hooks';
import { useAuthStatus } from '@/lib/useAuthStatus';
import { timeAgo } from '@/lib/utils';
import { toast } from 'sonner';

export function AdminPanelPage() {
  const { data: auth } = useAuthStatus();
  return (
    <div>
      <PageHeader
        eyebrow="平台管理"
        title="管理员面板"
        description="管理员账号 / 活跃会话 / 系统健康度 / 运行时配置 一站式入口。"
        status={auth.loggedIn ? '已登录' : '未登录'}
        statusTone={auth.loggedIn ? 'success' : 'danger'}
      />

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        {!auth.loggedIn ? (
          <GlassCard className="border-[var(--color-warning)]/40 bg-[var(--color-warning)]/5 p-6">
            <div className="flex items-start gap-3">
              <ShieldCheck className="size-5 shrink-0 text-[var(--color-warning)]" />
              <div className="flex-1">
                <div className="font-semibold text-[var(--color-warning)]">需要登录管理员账号</div>
                <div className="mt-1 text-xs text-[var(--color-muted)]">
                  本页是管理员专属。请点右上角 “登录” 或侧边栏 “去登录 →”。
                </div>
              </div>
            </div>
          </GlassCard>
        ) : (
          <>
            {/* 概览：系统健康度（复用 Dashboard 上的卡片） */}
            <HealthOverviewCard />

            {/* 账号：管理员 + 会话 */}
            <div className="grid gap-4 lg:grid-cols-2">
              <AdminUsersCard currentUserId={auth.userId ?? ''} />
              <AdminSessionsCard />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// 管理员账号卡
// =============================================================================
function AdminUsersCard({ currentUserId }: { currentUserId: string }) {
  const { data, isLoading } = useAdminUsers();
  const create = useCreateAdminUser();
  const patch = usePatchAdminUser();
  const del = useDeleteAdminUser();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPass, setNewPass] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'user'>('user');

  async function onCreate() {
    if (newName.length < 3 || newPass.length < 8) {
      toast.error('用户名至少 3 位，密码至少 8 位');
      return;
    }
    try {
      await create.mutateAsync({ username: newName, password: newPass, role: newRole });
      toast.success(`已创建 ${newRole === 'admin' ? '管理员' : '普通用户'} ${newName}`);
      setShowCreate(false);
      setNewName('');
      setNewPass('');
      setNewRole('user');
    } catch (e) {
      toast.error('创建失败：' + ((e as Error).message ?? '未知错误'));
    }
  }

  return (
    <GlassCard className="p-5">
      <div className="mb-3 flex items-center justify-between gap-3 border-b border-[var(--color-hairline)] pb-3">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-[var(--radius-md)] bg-[var(--color-primary)]/10 text-[var(--color-primary)] ring-1 ring-[var(--color-primary)]/30">
            <Users className="size-4" />
          </span>
          <div className="min-w-0">
            <div className="font-semibold text-[var(--color-ink)]">管理员账号</div>
            <div className="text-[11px] text-[var(--color-muted)]">
              新增 / 改密码 / 锁定解锁 / 删除（防自删 + 至少保留 1 个启用）
            </div>
          </div>
        </div>
        <Button variant="primary" size="sm" onClick={() => setShowCreate((s) => !s)}>
          <UserPlus className="size-3.5" /> {showCreate ? '取消' : '新增'}
        </Button>
      </div>

      {showCreate && (
        <div className="mb-3 space-y-2 rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Input value={newName} onChange={(e) => setNewName(e.currentTarget.value)} placeholder="用户名 (≥3)" />
            <Input
              type="password"
              value={newPass}
              onChange={(e) => setNewPass(e.currentTarget.value)}
              placeholder="密码 (≥8)"
            />
          </div>
          <div className="flex items-center gap-3">
            <div className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">角色</div>
            <div className="inline-flex rounded-[var(--radius-md)] border border-[var(--color-hairline-strong)] bg-[var(--color-surface-soft)] p-1 text-xs">
              {(['user', 'admin'] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setNewRole(r)}
                  className={`rounded-[var(--radius-sm)] px-2.5 py-1.5 ${
                    newRole === r
                      ? 'bg-[var(--color-surface-card)] text-[var(--color-ink)]'
                      : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
                  }`}
                >
                  {r === 'admin' ? 'admin 全权' : 'user 仅 VK'}
                </button>
              ))}
            </div>
            <Button variant="primary" size="sm" onClick={onCreate} disabled={create.isPending} className="ml-auto">
              {create.isPending ? '创建中…' : '确认创建'}
            </Button>
          </div>
        </div>
      )}

      {isLoading || !data ? (
        <div className="py-6 text-center text-sm text-[var(--color-muted)]">加载中…</div>
      ) : data.data.length === 0 ? (
        <div className="py-6 text-center text-sm text-[var(--color-muted)]">暂无管理员（异常状态）</div>
      ) : (
        <div className="space-y-1.5">
          {data.data.map((u) => (
            <AdminUserRowItem
              key={u.id}
              user={u}
              isSelf={u.id === currentUserId}
              onToggle={async (enabled) => {
                try {
                  await patch.mutateAsync({ id: u.id, enabled });
                  toast.success(enabled ? `已启用 ${u.username}` : `已禁用 ${u.username}`);
                } catch (e) {
                  toast.error('操作失败：' + (e as Error).message);
                }
              }}
              onUnlock={async () => {
                try {
                  await patch.mutateAsync({ id: u.id, unlock: true });
                  toast.success(`已解锁 ${u.username}`);
                } catch (e) {
                  toast.error('解锁失败：' + (e as Error).message);
                }
              }}
              onResetPassword={async (np) => {
                try {
                  await patch.mutateAsync({ id: u.id, newPassword: np });
                  toast.success(`已重置 ${u.username} 密码`);
                } catch (e) {
                  toast.error('重置失败：' + (e as Error).message);
                }
              }}
              onDelete={async () => {
                if (!confirm(`确认删除管理员 ${u.username}？此操作不可撤销。`)) return;
                try {
                  await del.mutateAsync(u.id);
                  toast.success(`已删除 ${u.username}`);
                } catch (e) {
                  toast.error('删除失败：' + (e as Error).message);
                }
              }}
            />
          ))}
        </div>
      )}
    </GlassCard>
  );
}

function AdminUserRowItem({
  user,
  isSelf,
  onToggle,
  onUnlock,
  onResetPassword,
  onDelete,
}: {
  user: AdminUserRow;
  isSelf: boolean;
  onToggle: (enabled: boolean) => void;
  onUnlock: () => void;
  onResetPassword: (newPassword: string) => void;
  onDelete: () => void;
}) {
  const [showPass, setShowPass] = useState(false);
  const [np, setNp] = useState('');
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface)] px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-[var(--color-ink)]">{user.username}</span>
            <Badge tone={user.role === 'admin' ? 'primary' : 'muted'}>
              {user.role === 'admin' ? 'admin' : 'user'}
            </Badge>
            {isSelf && <Badge tone="primary">当前账号</Badge>}
            {!user.enabled && <Badge tone="danger">已禁用</Badge>}
            {user.locked && <Badge tone="warning">已锁定</Badge>}
            {user.enabled && !user.locked && <Badge tone="success">活跃</Badge>}
          </div>
          <div className="mt-0.5 text-[10px] text-[var(--color-muted)]">
            上次登录 {user.lastLoginAt ? timeAgo(user.lastLoginAt) : '从未'}
            {user.lastLoginIp ? ` · IP ${user.lastLoginIp}` : ''}
            {user.failedLogins > 0 ? ` · 失败 ${user.failedLogins} 次` : ''}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {user.locked && (
            <Button variant="ghost" size="sm" onClick={onUnlock} title="解锁">
              <Unlock className="size-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowPass((s) => !s)}
            title="重置密码"
          >
            <KeyRound className="size-3.5" />
          </Button>
          {!isSelf && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onToggle(!user.enabled)}
                title={user.enabled ? '禁用' : '启用'}
              >
                {user.enabled ? '禁' : '启'}
              </Button>
              <Button variant="ghost" size="sm" onClick={onDelete} title="删除">
                <Trash2 className="size-3.5 text-[var(--color-error)]" />
              </Button>
            </>
          )}
        </div>
      </div>
      {showPass && (
        <div className="mt-2 flex gap-2">
          <Input
            type="password"
            value={np}
            onChange={(e) => setNp(e.currentTarget.value)}
            placeholder="新密码 (≥8)"
            className="flex-1"
          />
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              if (np.length < 8) {
                toast.error('密码至少 8 位');
                return;
              }
              onResetPassword(np);
              setShowPass(false);
              setNp('');
            }}
          >
            确认重置
          </Button>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// 活跃会话卡
// =============================================================================
function AdminSessionsCard() {
  const { data, isLoading } = useAdminSessions();
  const revoke = useRevokeAdminSession();

  return (
    <GlassCard className="p-5">
      <div className="mb-3 flex items-center justify-between gap-3 border-b border-[var(--color-hairline)] pb-3">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-[var(--radius-md)] bg-[var(--color-primary)]/10 text-[var(--color-primary)] ring-1 ring-[var(--color-primary)]/30">
            <Activity className="size-4" />
          </span>
          <div className="min-w-0">
            <div className="font-semibold text-[var(--color-ink)]">活跃会话</div>
            <div className="text-[11px] text-[var(--color-muted)]">
              当前未撤销 + 未过期 · 15 秒自动刷新 · 可强制下线
            </div>
          </div>
        </div>
        <Badge tone="primary">{data?.total ?? 0} 个</Badge>
      </div>

      {isLoading || !data ? (
        <div className="py-6 text-center text-sm text-[var(--color-muted)]">加载中…</div>
      ) : data.data.length === 0 ? (
        <div className="py-6 text-center text-sm text-[var(--color-muted)]">当前无活跃会话</div>
      ) : (
        <div className="space-y-1.5">
          {data.data.map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              onRevoke={async () => {
                if (!confirm(`确认强制下线 ${s.username} 的会话？`)) return;
                try {
                  await revoke.mutateAsync(s.id);
                  toast.success('会话已撤销');
                } catch (e) {
                  toast.error('撤销失败：' + (e as Error).message);
                }
              }}
            />
          ))}
        </div>
      )}
    </GlassCard>
  );
}

function SessionRow({ session, onRevoke }: { session: AdminSessionRow; onRevoke: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface)] px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-[var(--color-ink)]">{session.username}</span>
          <Badge tone="muted">{session.ip ?? '?'}</Badge>
        </div>
        <div className="mt-0.5 truncate text-[10px] text-[var(--color-muted)]">
          上次活跃 {timeAgo(session.lastSeenAt)} · 创建于 {timeAgo(session.createdAt)} · UA:{' '}
          {session.userAgent ? session.userAgent.slice(0, 60) : '未知'}
        </div>
      </div>
      <Button variant="ghost" size="sm" onClick={onRevoke} title="强制下线">
        <LogOut className="size-3.5 text-[var(--color-error)]" />
      </Button>
    </div>
  );
}
