import { useRef, useState } from 'react';
import { cn } from '../../lib/cn';

export function BentoGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('grid gap-2.5 md:grid-cols-3', className)}>{children}</div>;
}

export function BentoCard(props: {
  title: string;
  description: string;
  meta?: string;
  accent?: string;
  span?: boolean;
  onClick?: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [glow, setGlow] = useState({ x: -400, y: -400 });
  return (
    <button
      ref={ref}
      onClick={props.onClick}
      onMouseMove={(e) => {
        const r = ref.current?.getBoundingClientRect();
        if (r) setGlow({ x: e.clientX - r.left, y: e.clientY - r.top });
      }}
      onMouseLeave={() => setGlow({ x: -400, y: -400 })}
      className={cn(
        'group relative overflow-hidden rounded-xl border border-zinc-800/90 bg-zinc-950/70 p-4 text-left',
        'transition-colors duration-300 hover:border-zinc-600',
        props.span && 'md:col-span-2',
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{ background: `radial-gradient(320px circle at ${glow.x}px ${glow.y}px, rgba(239,68,68,0.12), transparent 65%)` }}
      />
      <div className={cn('mb-2 h-1 w-8 rounded-full', props.accent ?? 'bg-red-600')} />
      <p className="text-[13px] font-semibold text-zinc-100">{props.title}</p>
      <p className="mt-0.5 text-[12px] leading-relaxed text-zinc-500">{props.description}</p>
      {props.meta && <p className="mono mt-1.5 text-[10px] tracking-wider text-zinc-600">{props.meta}</p>}
    </button>
  );
}
