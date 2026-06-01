import { useState, type ComponentType } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  Bell,
  BellRing,
  Boxes,
  Building2,
  Cable,
  ChevronDown,
  ClipboardList,
  Coins,
  FlaskConical,
  Gauge,
  GitCompare,
  History,
  KeyRound,
  Landmark,
  LayoutDashboard,
  LayoutGrid,
  Network,
  PlayCircle,
  ScrollText,
  ServerCog,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Wallet,
  Webhook,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStatus } from '@/lib/useAuthStatus';

type IconType = ComponentType<{ className?: string; strokeWidth?: number }>;
interface NavItem {
  to: string;
  label: string;
  Icon: IconType;
  hint: string;
}
interface NavGroup {
  key: string;
  label: string;
  Icon: IconType;
  items: NavItem[];
}

const GUEST_NAV: NavItem[] = [
  { to: '/playground', label: 'Playground', Icon: PlayCircle, hint: '5 秒试用路由' },
];

// 普通用户(role=user)视图 — 项少，平铺不折叠。
const USER_NAV: NavItem[] = [
  { to: '/playground', label: 'Playground', Icon: PlayCircle, hint: '试模型 / 调参' },
  { to: '/virtual-keys', label: '我的密钥', Icon: KeyRound, hint: '签发 / 改 / 撤自己的密钥' },
  { to: '/logs', label: '我的日志', Icon: ScrollText, hint: '自己密钥的请求审计' },
];

// 管理员 26 项按功能域分 7 组折叠收纳（展开态分组 / 窄边栏态平铺）。
const ADMIN_GROUPS: NavGroup[] = [
  {
    key: 'overview',
    label: '总览',
    Icon: LayoutDashboard,
    items: [
      { to: '/dashboard', label: '仪表盘', Icon: LayoutDashboard, hint: '24 小时总览' },
      { to: '/usage-analytics', label: '用量分析', Icon: BarChart3, hint: '历史用量趋势 + 排行' },
    ],
  },
  {
    key: 'models',
    label: '模型',
    Icon: Boxes,
    items: [
      { to: '/models', label: '模型池', Icon: Boxes, hint: '免费池 · 评分 · 状态' },
      { to: '/model-compare', label: '模型对比', Icon: GitCompare, hint: '多模型 9 维并排' },
      { to: '/model-capability-matrix', label: '能力矩阵', Icon: LayoutGrid, hint: '全模型 × 7 维能力总览' },
      { to: '/model-snapshot-history', label: '变更历史', Icon: History, hint: '模型快照 diff 时间线' },
      { to: '/batch-test', label: '批量测试', Icon: FlaskConical, hint: '多模型并排试跑对比' },
    ],
  },
  {
    key: 'routing',
    label: '路由',
    Icon: Activity,
    items: [
      { to: '/routing-lab', label: '路由实验室', Icon: Activity, hint: '实时路由 + 回放' },
      { to: '/routing-policies', label: '策略管理', Icon: Network, hint: '多命名策略 + 激活切换' },
      { to: '/routing-policy-editor', label: '策略编辑器', Icon: SlidersHorizontal, hint: '权重 slider + 实时排名预览' },
      { to: '/route-health', label: '路由健康', Icon: Gauge, hint: '熔断 + 评分 + 上游健康' },
      { to: '/route-failure-analysis', label: '失败分析', Icon: ShieldAlert, hint: 'errorKind 占比 + 上游失败率' },
    ],
  },
  {
    key: 'cost',
    label: '成本',
    Icon: Coins,
    items: [
      { to: '/cost-analytics', label: '成本分析', Icon: Coins, hint: 'VK / 模型成本排行 + 趋势' },
      { to: '/budgets', label: '成本预算', Icon: Wallet, hint: '周期上限 + 用量告警' },
      { to: '/org-cost', label: '组织成本', Icon: Landmark, hint: '组织/项目维度成本分摊' },
    ],
  },
  {
    key: 'keys',
    label: '密钥 & 上游',
    Icon: KeyRound,
    items: [
      { to: '/virtual-keys', label: '虚拟密钥', Icon: KeyRound, hint: '下游鉴权' },
      { to: '/providers', label: '上游服务', Icon: Cable, hint: '上游健康' },
      { to: '/provider-ops', label: '上游运营', Icon: ServerCog, hint: '余额耗尽排序 + 趋势 + SLA' },
      { to: '/organizations', label: '组织 / 项目', Icon: Building2, hint: '多租户管理' },
    ],
  },
  {
    key: 'integration',
    label: '告警 & 集成',
    Icon: Bell,
    items: [
      { to: '/alerts', label: '告警中心', Icon: Bell, hint: '统一告警源 + 解决标记' },
      { to: '/notify-channels', label: '通知渠道', Icon: BellRing, hint: 'email/Slack/Webhook 告警分发' },
      { to: '/webhooks', label: 'Webhook', Icon: Webhook, hint: '出站事件订阅 + 签名' },
    ],
  },
  {
    key: 'system',
    label: '审计 & 系统',
    Icon: Shield,
    items: [
      { to: '/logs', label: '请求日志', Icon: ScrollText, hint: 'API 请求审计链路' },
      { to: '/audit', label: '操作审计', Icon: Shield, hint: '管理员操作审计' },
      { to: '/admin-panel', label: '管理员面板', Icon: ShieldCheck, hint: '账号 · 会话 · 健康度 一站管理' },
      { to: '/settings', label: '设置', Icon: Settings, hint: '策略 · 主题 · 安全' },
    ],
  },
];

// 底部工具（admin 也常用，独立不折叠）。
const ADMIN_TOOLS: NavItem[] = [
  { to: '/playground', label: 'Playground', Icon: PlayCircle, hint: '5 秒试用路由' },
];

function NavItemLink({ item, collapsed, indent }: { item: NavItem; collapsed: boolean; indent?: boolean }) {
  return (
    <NavLink
      to={item.to}
      title={item.hint}
      className={({ isActive }) =>
        cn(
          'group/item flex items-center gap-3 rounded-[var(--radius-md)] py-2 text-sm transition-colors',
          collapsed ? 'justify-center px-2' : indent ? 'pl-9 pr-3' : 'px-3',
          'text-[var(--color-body)] hover:bg-[var(--color-surface-card)] hover:text-[var(--color-ink)]',
          isActive &&
            'text-[var(--color-primary)] bg-[var(--color-surface-card)] shadow-[inset_2px_0_0_var(--color-primary)]',
        )
      }
    >
      <item.Icon className="size-4 shrink-0" />
      {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
    </NavLink>
  );
}

export function Sidebar({ collapsed }: { collapsed: boolean }) {
  const { data: auth } = useAuthStatus();
  const loc = useLocation();
  const isAdmin = auth.loggedIn && auth.role === 'admin';

  // 当前路由所在组（默认展开），其余收起。
  const activeGroupKey = ADMIN_GROUPS.find((g) => g.items.some((i) => loc.pathname === i.to))?.key;
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    activeGroupKey ? { [activeGroupKey]: true } : { overview: true },
  );
  const toggleGroup = (key: string) => setOpenGroups((s) => ({ ...s, [key]: !s[key] }));

  const flatNav = !auth.loggedIn ? GUEST_NAV : !isAdmin ? USER_NAV : null;

  return (
    <aside
      className={cn(
        'group/sidebar hidden md:flex flex-col gap-1 border-r border-[var(--color-hairline)] bg-[var(--color-surface-soft)]/60 backdrop-blur',
        'transition-[width] duration-200',
        collapsed ? 'w-[68px]' : 'w-[244px]',
      )}
    >
      <div className="flex items-center gap-2 px-4 py-5">
        <span className="grid size-9 place-items-center rounded-[var(--radius-md)] bg-[var(--color-primary)] text-[var(--color-on-primary)] shadow-[var(--shadow-glow-soft)]">
          <Zap className="size-5" strokeWidth={2.5} />
        </span>
        {!collapsed && (
          <div className="leading-tight">
            <div className="font-semibold text-[var(--color-ink)] tracking-tight">FreeLLM</div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--color-muted)]">
              网关 · 管理台
            </div>
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
        {/* 首页（始终独立顶部） */}
        <NavLink
          to="/"
          end
          title="首页"
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-[var(--radius-md)] py-2 text-sm transition-colors',
              collapsed ? 'justify-center px-2' : 'px-3',
              'text-[var(--color-body)] hover:bg-[var(--color-surface-card)] hover:text-[var(--color-ink)]',
              isActive && 'text-[var(--color-primary)] bg-[var(--color-surface-card)]',
            )
          }
        >
          <ClipboardList className="size-4 shrink-0" />
          {!collapsed && <span>首页</span>}
        </NavLink>

        {/* 访客 / 普通用户：平铺；管理员：分组折叠（窄边栏时平铺图标） */}
        {flatNav
          ? flatNav.map((item) => <NavItemLink key={item.to} item={item} collapsed={collapsed} />)
          : collapsed
            ? // 窄边栏：admin 全部项平铺图标 + tooltip
              ADMIN_GROUPS.flatMap((g) => g.items)
                .concat(ADMIN_TOOLS)
                .map((item) => <NavItemLink key={item.to} item={item} collapsed />)
            : // 展开：分组折叠
              ADMIN_GROUPS.map((g) => {
                const isOpen = !!openGroups[g.key];
                const hasActive = g.items.some((i) => loc.pathname === i.to);
                return (
                  <div key={g.key} className="pt-1">
                    <button
                      onClick={() => toggleGroup(g.key)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-[var(--radius-md)] px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider transition-colors',
                        hasActive
                          ? 'text-[var(--color-primary)]'
                          : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]',
                      )}
                    >
                      <g.Icon className="size-3.5 shrink-0" />
                      <span className="flex-1 text-left normal-case tracking-normal">{g.label}</span>
                      <ChevronDown
                        className={cn(
                          'size-3.5 shrink-0 transition-transform duration-200',
                          isOpen ? 'rotate-0' : '-rotate-90',
                        )}
                      />
                    </button>
                    {isOpen && (
                      <div className="mt-0.5 space-y-0.5">
                        {g.items.map((item) => (
                          <NavItemLink key={item.to} item={item} collapsed={false} indent />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

        {/* admin 底部工具（展开态独立显示） */}
        {isAdmin && !collapsed && (
          <div className="mt-2 border-t border-[var(--color-hairline)] pt-2">
            {ADMIN_TOOLS.map((item) => (
              <NavItemLink key={item.to} item={item} collapsed={false} />
            ))}
          </div>
        )}
      </nav>

      <div className="border-t border-[var(--color-hairline)] px-3 py-3 text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
        {!collapsed ? (
          <div className="space-y-2">
            <div>
              {auth.loggedIn
                ? `${auth.role === 'admin' ? 'admin · ' : 'user · '}${auth.username ?? ''}`
                : '未登录 · 仅查看模式'}
            </div>
            {!auth.loggedIn && (
              <NavLink
                to="/signin"
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-primary)]/40 bg-[var(--color-primary)]/10 px-2.5 py-1.5 text-[11px] font-medium normal-case tracking-normal text-[var(--color-primary)] hover:bg-[var(--color-primary)]/20"
              >
                去登录 →
              </NavLink>
            )}
          </div>
        ) : auth.loggedIn ? (
          '✓'
        ) : (
          <NavLink to="/signin" title="去登录" className="block text-center text-[var(--color-primary)]">
            →
          </NavLink>
        )}
      </div>
    </aside>
  );
}
