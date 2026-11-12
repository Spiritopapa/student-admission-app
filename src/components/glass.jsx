import { useCallback, useRef, useState } from 'react';
import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from 'framer-motion';

/* ------------------------------------------------------------------
   Staggered reveal
   ------------------------------------------------------------------ */

export const revealContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1, delayChildren: 0.1 },
  },
};

export const revealItem = {
  hidden: { opacity: 0, y: 26, filter: 'blur(10px)', scale: 0.98 },
  visible: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    scale: 1,
    transition: { type: 'spring', stiffness: 340, damping: 30 },
  },
};

export function Reveal({ children, className = '', ...props }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={reduced ? { opacity: 1 } : 'hidden'}
      animate="visible"
      variants={revealContainer}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}

export function RevealItem({ children, className = '', delay = 0, ...props }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={reduced ? { opacity: 1 } : 'hidden'}
      animate="visible"
      variants={revealItem}
      transition={{ ...revealItem.visible.transition, delay }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}

/* ------------------------------------------------------------------
   Pointer-reactive 3D glass tile
   Tracks the cursor and tilts the surface in 3D using transform-only
   updates (GPU composited, no layout/paint thrash). Falls back to a
   gentle CSS hover when reduced motion is requested.
   ------------------------------------------------------------------ */

export function GlassTile({
  children,
  className = '',
  tilt = 7,
  scale = 1.02,
  elevation = 'md',
  ...props
}) {
  const ref = useRef(null);
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const reduced = useReducedMotion();

  const handleMove = useCallback(
    (event) => {
      if (reduced || !ref.current) return;
      const rect = ref.current.getBoundingClientRect();
      const mx = (event.clientX - rect.left) / rect.width - 0.5;
      const my = (event.clientY - rect.top) / rect.height - 0.5;
      setPointer({ x: mx * 2, y: my * 2 });
    },
    [reduced],
  );

  const lifts = { sm: 'shadow-soft', md: 'shadow-glass', lg: 'shadow-card' };
  const shadow = lifts[elevation] ?? 'shadow-glass';

  return (
    <motion.div
      ref={ref}
      onMouseMove={handleMove}
      onMouseLeave={() => setPointer({ x: 0, y: 0 })}
      animate={{
        rotateX: reduced ? 0 : -pointer.y * tilt,
        rotateY: reduced ? 0 : pointer.x * tilt,
        scale: reduced ? 1 : scale,
      }}
      transition={{
        type: 'spring',
        stiffness: 340,
        damping: 24,
        mass: 0.9,
      }}
      whileTap={{ scale: reduced ? 1 : 0.97 }}
      style={{ transformStyle: 'preserve-3d', perspective: 900 }}
      className={`
        relative overflow-hidden rounded-2xl border
        bg-white/60 backdrop-blur-md border-white/50
        ${shadow}
        transition-shadow duration-300
        hover:shadow-card
        ${className}
      `}
      {...props}
    >
      <div className="tilt-layer p-6 isolate">
        {children}
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------
   Elevated glass sheet (section cards, panels)
   ------------------------------------------------------------------ */

export function GlassSheet({
  children,
  className = '',
  elevation = 'lg',
  hoverLift = true,
  ...props
}) {
  const reduced = useReducedMotion();
  const lifts = { sm: 'shadow-soft', md: 'shadow-glass', lg: 'shadow-card', xl: 'shadow-2xl' };
  const shadow = lifts[elevation] ?? 'shadow-card';

  return (
    <motion.div
      whileHover={
        hoverLift && !reduced
          ? { y: -4, transition: { type: 'spring', stiffness: 400, damping: 24 } }
          : false
      }
      whileTap={{ y: -2 }}
      className={`
        relative rounded-2xl border
        bg-white/60 backdrop-blur-md border-white/50
        ${shadow}
        transition-all duration-300
        hover:shadow-card
        ${className}
      `}
      {...props}
    >
      {children}
    </motion.div>
  );
}

/* ------------------------------------------------------------------
   Route transition wrapper
   Swaps route content with a spring-driven fade/slide. Keyed by the
   current location so framer-motion unmounts the old page before
   mounting the new one (poplar mode = exit + entry overlap).
   ------------------------------------------------------------------ */

export const pageVariants = {
  initial: { opacity: 0, y: 18 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring', stiffness: 420, damping: 30 },
  },
  exit: {
    opacity: 0,
    y: -10,
    transition: { duration: 0.16, ease: 'easeIn' },
  },
};

export function PageTransition({ children, locationKey }) {
  const reduced = useReducedMotion();
  return (
    <AnimatePresence mode="poplar">
      <motion.div
        key={locationKey}
        initial={reduced ? { opacity: 1 } : 'initial'}
        animate="animate"
        exit={reduced ? false : 'exit'}
        variants={pageVariants}
        className="min-h-full"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
