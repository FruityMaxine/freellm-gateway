import { useEffect, useState } from 'react';

/** Cycles through `phrases`, typing each one character-by-character. */
export function TypingText({
  phrases,
  speed = 60,
  pause = 1800,
  className,
}: {
  phrases: string[];
  speed?: number;
  pause?: number;
  className?: string;
}) {
  const [index, setIndex] = useState(0);
  const [text, setText] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const current = phrases[index % phrases.length] ?? '';
    if (!deleting && text === current) {
      const t = setTimeout(() => setDeleting(true), pause);
      return () => clearTimeout(t);
    }
    if (deleting && text === '') {
      setDeleting(false);
      setIndex((i) => i + 1);
      return;
    }
    const t = setTimeout(
      () => {
        setText((prev) => (deleting ? prev.slice(0, -1) : current.slice(0, prev.length + 1)));
      },
      deleting ? speed / 2 : speed,
    );
    return () => clearTimeout(t);
  }, [text, deleting, index, phrases, speed, pause]);

  return (
    <span className={className} aria-live="polite">
      {text}
      <span className="inline-block w-[2px] -mb-[2px] h-[1em] bg-[var(--color-primary)] animate-pulse ml-1" />
    </span>
  );
}
