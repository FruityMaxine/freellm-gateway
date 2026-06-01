import { Activity, BookOpen, Github } from 'lucide-react';
import { Link } from 'react-router-dom';

// Tick 52 v1.7.24.0：3 个按钮接真链接。
// 组 4 Tick 3：版本号改为 build 时从根 VERSION 文件注入（__APP_VERSION__，vite define），
// 禁止硬编码，符合 CLAUDE.md 版本号 single-source 规则。
declare const __APP_VERSION__: string;
const VERSION = __APP_VERSION__;
const GITHUB_URL = 'https://github.com/your-org/freellm'; // private repo, 仅作者可见
const DOCS_URL = 'https://github.com/your-org/freellm/tree/main/docs';

export function Footer() {
  return (
    <footer className="border-t border-[var(--color-hairline)] py-8 text-xs text-[var(--color-muted)]">
      <div className="mx-auto flex max-w-7xl flex-col items-start gap-3 px-6 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2 font-mono tracking-wide">
          <span className="grid size-5 place-items-center rounded bg-[var(--color-primary)] text-[var(--color-on-primary)] text-[9px] font-bold">
            F
          </span>
          FreeLLM v{VERSION} · 多模型 LLM 控制台 · {new Date().getFullYear()}
        </div>
        <div className="flex items-center gap-4 text-[var(--color-body)]">
          <a
            className="inline-flex items-center gap-1.5 hover:text-[var(--color-primary)]"
            href={DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            title="项目文档（docs/ 目录）"
          >
            <BookOpen className="size-3.5" /> 文档
          </a>
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-1.5 hover:text-[var(--color-primary)]"
            title="系统状态 / 健康度"
          >
            <Activity className="size-3.5" /> 状态
          </Link>
          <a
            className="inline-flex items-center gap-1.5 hover:text-[var(--color-primary)]"
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            title="GitHub 源码"
          >
            <Github className="size-3.5" /> 源码
          </a>
        </div>
      </div>
    </footer>
  );
}
