import { motion } from 'motion/react';
import { useMemo } from 'react';
import { cn } from '../../lib/cn';

interface Beam {
  left: string;
  width: number;
  duration: number;
  delay: number;
  hue: string;
  opacity: number;
}

/** Diagonal light beams drifting slowly across a dark backdrop. Pure CSS + motion. */
export function BackgroundBeams({ className, count = 7 }: { className?: string; count?: number }) {
  const beams = useMemo<Beam[]>(
    () =>
      Array.from({ length: count }, (_, i) => ({
        left: `${(i / count) * 100}%`,
        width: 60 + ((i * 37) % 120),
        duration: 9 + ((i * 13) % 8),
        delay: (i * 1.7) % 6,
        hue: i % 3 === 0 ? '239,68,68' : i % 3 === 1 ? '79,143,247' : '167,139,250',
        opacity: 0.05 + ((i * 7) % 5) / 100,
      })),
    [count],
  );
  return (
    <div aria-hidden className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(239,68,68,0.08),transparent_55%),radial-gradient(ellipse_at_bottom,rgba(79,143,247,0.07),transparent_55%)]" />
      {beams.map((b, i) => (
        <motion.div
          key={i}
          className="absolute top-[-20%] h-[140%] skew-x-[-18deg] blur-2xl"
          style={{ left: b.left, width: b.width, background: `linear-gradient(to bottom, transparent, rgba(${b.hue},${b.opacity + 0.06}), transparent)` }}
          animate={{ y: ['-6%', '6%', '-6%'], opacity: [0.5, 1, 0.5] }}
          transition={{ duration: b.duration, delay: b.delay, repeat: Infinity, ease: 'easeInOut' }}
        />
      ))}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />
    </div>
  );
}
