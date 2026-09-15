import { motion } from 'motion/react';
import { cn } from '../../lib/cn';

/** Word-by-word hero reveal. */
export function TextGenerate({ text, className }: { text: string; className?: string }) {
  const words = text.split(' ');
  return (
    <span className={cn('inline', className)} aria-label={text}>
      {words.map((w, i) => (
        <motion.span
          key={i}
          initial={{ opacity: 0, filter: 'blur(6px)' }}
          animate={{ opacity: 1, filter: 'blur(0px)' }}
          transition={{ duration: 0.5, delay: 0.15 + i * 0.07 }}
          className="inline-block"
        >
          {w}
          {i < words.length - 1 ? ' ' : ''}
        </motion.span>
      ))}
    </span>
  );
}
