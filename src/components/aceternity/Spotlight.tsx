import { motion } from 'motion/react';
import { cn } from '../../lib/cn';

/** Soft radial spotlight that fades in over the hero. */
export function Spotlight({ className, fill = 'white' }: { className?: string; fill?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 1.6, ease: 'easeOut' }}
      aria-hidden
      className={cn('pointer-events-none absolute z-0 h-[42rem] w-[42rem] rounded-full opacity-0 blur-3xl', className)}
      style={{
        background: `radial-gradient(closest-side, ${fill} 0%, transparent 70%)`,
        opacity: 0.14,
      }}
    />
  );
}
