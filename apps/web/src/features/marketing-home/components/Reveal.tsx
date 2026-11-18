'use client';

import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { caseEase } from '../domain/hero.ts';

export type RevealProps = {
  children: ReactNode;
  /** Position in its group: each item starts one 120 ms step after the one before. */
  index?: number;
  as?: 'div' | 'li';
  className?: string;
};

/**
 * Rises into place the first time it scrolls into view. marketing.css keeps it visible under reduced motion and
 * without JavaScript, so the reveal is never needed to read the page.
 */
export function Reveal({ children, index = 0, as = 'div', className = '' }: RevealProps) {
  const Tag = as === 'li' ? motion.li : motion.div;
  return (
    <Tag
      className={`mk-reveal ${className}`}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -10% 0px' }}
      transition={{ duration: 0.6, delay: index * 0.12, ease: caseEase }}
    >
      {children}
    </Tag>
  );
}
