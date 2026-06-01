/**
 * 组织 / 项目管理页（Tick 20 v1.3.1.0 引入）。
 *
 * 列表所有 Organization 卡片，含：
 * - name / slug / billingEmail / rpmLimit
 * - projects 数（来自 ?include=projects）
 * - 嵌套展开看 projects 列表 + 项目级创建表单 + 删除确认
 *
 * 顶部含"添加组织"表单。
 */
import { useState } from 'react';
import { Building2, Plus, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { PageHeader } from './_PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { GlassCard } from '@/components/bits/GlassCard';
import { api } from '@/lib/api';
import {
  useOrganizationsWithProjects,
  type OrganizationRow,
} from '@/lib/lab-keys-logs-hooks';
import { toast } from 'sonner';

export function OrganizationsPage() {
  const { data, isLoading, refetch } = useOrganizationsWithProjects();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'organizations'] });
    void qc.invalidateQueries({ queryKey: ['admin', 'projects'] });
    void refetch();
  };

  return (
    <div>
      <PageHeader
        eyebrow="多租户"
        title="组织 / 项目"
        description="一个组织包含多个项目；虚拟密钥按项目归属。组织级 RPM 限额可在此设置。"
        status={isLoading ? '加载中' : '实时'}
        statusTone={isLoading ? 'warning' : 'success'}
        actions={
          <Button variant="primary" size="sm" onClick={() => setShowCreate((s) => !s)}>
            <Plus className="size-3.5" /> {showCreate ? '收起表单' : '添加组织'}
          </Button>
        }
      />

      <div className="mx-auto max-w-6xl px-6 py-8 space-y-6">
        {showCreate && (
          <GlassCard className="p-5">
            <CreateOrganizationForm
              onCreated={() => {
                setShowCreate(false);
                invalidate();
              }}
            />
          </GlassCard>
        )}

        {isLoading ? (
          <GlassCard className="p-8 text-center text-sm text-[var(--color-muted)]">
            正在加载组织列表 …
          </GlassCard>
        ) : (data?.data ?? []).length === 0 ? (
          <GlassCard className="p-8 text-center text-sm text-[var(--color-muted)]">
            尚未创建任何组织。点击右上 "添加组织" 创建第一个。
          </GlassCard>
        ) : (
          (data?.data ?? []).map((org) => (
            <OrganizationCard key={org.id} org={org} onChange={invalidate} />
          ))
        )}
      </div>
    </div>
  );
}

function OrganizationCard({ org, onChange }: { org: OrganizationRow; onChange: () => void }) {
  const [showProjForm, setShowProjForm] = useState(false);

  const onDelete = async () => {
    if (!confirm(`确定删除组织 "${org.name}"？\n所有项目会被级联删除；虚拟密钥保留但项目归属会被清空。`)) return;
    try {
      await api.delete(`/admin/organizations/${org.id}`);
      toast.success(`组织 "${org.name}" 已删除`);
      onChange();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const projects = org.projects ?? [];

  return (
    <GlassCard className="p-5">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-[var(--radius-md)] bg-[var(--color-primary)]/15 text-[var(--color-primary)]">
            <Building2 className="size-5" />
          </span>
          <div>
            <div className="font-semibold text-[var(--color-ink)]">{org.name}</div>
            <div className="text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
              {org.slug}
              {org.billingEmail ? <span className="ml-2">· {org.billingEmail}</span> : null}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-[var(--radius-sm)] bg-[var(--color-surface-soft)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
            {projects.length} 个项目
          </span>
          <Button variant="danger" size="sm" onClick={onDelete}>
            <Trash2 className="size-3.5" /> 删除
          </Button>
        </div>
      </div>

      <div className="mt-5 space-y-2">
        <div className="text-xs uppercase tracking-wider text-[var(--color-muted)]">项目列表</div>
        {projects.length === 0 ? (
          <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-hairline-strong)] px-3 py-3 text-xs text-[var(--color-muted)]">
            该组织尚无项目
          </div>
        ) : (
          projects.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface-soft)] px-3 py-2 text-xs"
            >
              <span className="text-[var(--color-ink)]">{p.name}</span>
              <span className="font-mono text-[var(--color-muted)]">{p.slug}</span>
            </div>
          ))
        )}
        <div className="pt-1">
          <Button variant="ghost" size="sm" onClick={() => setShowProjForm((s) => !s)}>
            <Plus className="size-3.5" /> {showProjForm ? '收起表单' : '添加项目'}
          </Button>
        </div>
        {showProjForm && (
          <CreateProjectForm
            organizationId={org.id}
            onCreated={() => {
              setShowProjForm(false);
              onChange();
            }}
          />
        )}
      </div>
    </GlassCard>
  );
}

function CreateOrganizationForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [billingEmail, setBillingEmail] = useState('');
  const [rpmLimit, setRpmLimit] = useState<string>('');
  const [pending, setPending] = useState(false);

  const onSubmit = async () => {
    if (!name.trim() || !slug.trim()) return;
    setPending(true);
    try {
      await api.post('/admin/organizations', {
        name: name.trim(),
        slug: slug.trim(),
        ...(billingEmail.trim() ? { billingEmail: billingEmail.trim() } : {}),
        ...(rpmLimit.trim() ? { rpmLimit: Number.parseInt(rpmLimit, 10) } : {}),
      });
      toast.success(`组织 "${name}" 已创建`);
      setName('');
      setSlug('');
      setBillingEmail('');
      setRpmLimit('');
      onCreated();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium text-[var(--color-ink)]">新建组织</div>
      <div className="grid grid-cols-2 gap-3">
        <Input placeholder="组织名（例如 Acme Inc）" value={name} onChange={(e) => setName(e.currentTarget.value)} />
        <Input placeholder="slug（例如 acme）" value={slug} onChange={(e) => setSlug(e.currentTarget.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input placeholder="计费邮箱（可选）" value={billingEmail} onChange={(e) => setBillingEmail(e.currentTarget.value)} />
        <Input placeholder="RPM 上限（可选，留空则不限）" type="number" value={rpmLimit} onChange={(e) => setRpmLimit(e.currentTarget.value)} />
      </div>
      <div className="flex justify-end">
        <Button variant="primary" size="sm" onClick={onSubmit} disabled={!name.trim() || !slug.trim() || pending}>
          {pending ? '创建中…' : '创建组织'}
        </Button>
      </div>
    </div>
  );
}

function CreateProjectForm({
  organizationId,
  onCreated,
}: {
  organizationId: string;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [pending, setPending] = useState(false);

  const onSubmit = async () => {
    if (!name.trim() || !slug.trim()) return;
    setPending(true);
    try {
      await api.post('/admin/projects', {
        organizationId,
        name: name.trim(),
        slug: slug.trim(),
      });
      toast.success(`项目 "${name}" 已创建`);
      setName('');
      setSlug('');
      onCreated();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="mt-2 grid grid-cols-[1fr_1fr_auto] gap-2">
      <Input placeholder="项目名" value={name} onChange={(e) => setName(e.currentTarget.value)} />
      <Input placeholder="slug" value={slug} onChange={(e) => setSlug(e.currentTarget.value)} />
      <Button variant="primary" size="sm" onClick={onSubmit} disabled={!name.trim() || !slug.trim() || pending}>
        {pending ? '创建中…' : '创建项目'}
      </Button>
    </div>
  );
}
