import { Link } from 'react-router-dom';
import { ArrowLeft, Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Aurora } from '@/components/bits/Aurora';

export function NotFound() {
  return (
    <section className="relative isolate min-h-[calc(100vh-3.5rem)] overflow-hidden">
      <Aurora />
      <div className="relative mx-auto flex max-w-2xl flex-col items-center px-6 py-32 text-center">
        <div className="grid size-14 place-items-center rounded-[var(--radius-md)] bg-[var(--color-surface-card)] text-[var(--color-primary)] ring-1 ring-[var(--color-primary)]/30">
          <Compass className="size-6" />
        </div>
        <h1 className="mt-6 text-5xl font-bold tracking-tight">404</h1>
        <p className="mt-3 max-w-md text-[var(--color-body)]">
          No route matches this URL. Check the sidebar — every admin page is one tap away.
        </p>
        <Button asChild size="lg" className="mt-8">
          <Link to="/">
            <ArrowLeft className="size-4" /> Back to landing
          </Link>
        </Button>
      </div>
    </section>
  );
}
