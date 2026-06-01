import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { Footer } from './Footer';

export function AppShell() {
  const [collapsed, setCollapsed] = useState(false);
  const loc = useLocation();
  const isLanding = loc.pathname === '/' || loc.pathname === '/landing';
  return (
    <div className="flex min-h-screen w-full bg-[var(--color-canvas)] text-[var(--color-ink)]">
      {!isLanding && <Sidebar collapsed={collapsed} />}
      <div className="flex min-w-0 flex-1 flex-col">
        {!isLanding && <Topbar onToggleSidebar={() => setCollapsed((c) => !c)} />}
        <main className="flex-1 min-w-0">
          <AnimatePresence mode="wait">
            <motion.div
              key={loc.pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              className="min-h-[calc(100vh-3.5rem)]"
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
        {!isLanding && <Footer />}
      </div>
    </div>
  );
}
