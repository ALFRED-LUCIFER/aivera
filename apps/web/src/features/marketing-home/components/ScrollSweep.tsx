'use client';

import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react';
import { useRef, useSyncExternalStore, type ReactNode } from 'react';

const noSubscription = () => () => {};

/**
 * The highlighter drawn across the words as they scroll up the screen. Fully drawn on the server, under reduced motion
 * and before hydration: the scroll only takes over once it is safe to.
 */
export function ScrollSweep({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const reducedMotion = useReducedMotion();
  // False on the server and while hydrating, true after: the drawn-in-full markup is what hydrates.
  const hydrated = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  const live = hydrated && reducedMotion === false;
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 90%', 'end 55%'] });
  const backgroundSize = useTransform(scrollYProgress, (p) => `${Math.round(p * 100)}% 100%`);
  return (
    <motion.mark
      ref={ref}
      className="mk-scroll-sweep rounded-tag px-1.5 text-hl-text box-decoration-clone"
      style={live ? { backgroundSize } : {}}
    >
      {children}
    </motion.mark>
  );
}
