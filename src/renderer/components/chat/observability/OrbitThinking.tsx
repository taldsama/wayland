/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import OrbitGlyph from './OrbitGlyph';
import styles from './OrbitThinking.module.css';

/**
 * Branded "thinking" footer for the observability rework. Rendered inline as the
 * message-list footer (Claude-style): the orbit glyph appears under the last
 * block the instant a turn is submitted, and disappears when it completes.
 *
 * One line: the animated orbit glyph + a label (the REAL current action when
 * known via `currentLabel`, else a rotating themed phrase) + an elapsed timer
 * (appears at >= 2s).
 *
 * Lifecycle: visible immediately while processing, 200ms opacity fade on stop
 * then unmount, and a fixed-height spacer when idle so the Virtuoso layout does
 * not jump. The rotating phrases are brand/personality copy, intentionally
 * English-only; the elapsed unit goes through i18n with an inline default.
 */

// Wayland-voiced status phrases - personality copy, intentionally English-only.
const PHRASES = [
  'Thinking it through...',
  'Working the problem...',
  'Lining up the approach...',
  'Connecting the dots...',
  'Reasoning carefully...',
  'Drafting the plan...',
  'Checking the details...',
  'Putting it together...',
  'Weighing the options...',
  'Tracing the path...',
  'Sharpening the answer...',
  'Almost there...',
];

type Props = {
  isProcessing: boolean;
  currentLabel?: string;
};

const OrbitThinking: React.FC<Props> = ({ isProcessing, currentLabel }) => {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [fading, setFading] = useState(false);
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const startTimeRef = useRef<number>(0);

  // Visibility: fade-out transition when isProcessing goes false.
  useEffect(() => {
    if (isProcessing) {
      setVisible(true);
      setFading(false);
    } else if (visible) {
      setFading(true);
      const timer = setTimeout(() => {
        setVisible(false);
        setFading(false);
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [isProcessing, visible]);

  // Phrase rotation: every 3 seconds while visible.
  useEffect(() => {
    if (!visible) return;
    setPhraseIndex(0);
    const interval = setInterval(() => {
      setPhraseIndex((prev) => (prev + 1) % PHRASES.length);
    }, 3000);
    return () => clearInterval(interval);
  }, [visible]);

  // Elapsed time: start tracking when visible, update every 1s.
  useEffect(() => {
    if (!visible) {
      setElapsed(0);
      return;
    }
    startTimeRef.current = Date.now();
    setElapsed(0);
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [visible]);

  // Idle: render a fixed-height spacer to preserve Virtuoso layout (no jump).
  if (!visible) return <div style={{ minHeight: 20 }} />;

  const sUnit = t('common.unit.second_short', { defaultValue: 's' });
  const hasRealLabel = typeof currentLabel === 'string' && currentLabel.length > 0;
  const label = hasRealLabel ? currentLabel : PHRASES[phraseIndex];

  return (
    <div
      className={`${styles.container} ${fading ? styles.fading : ''}`}
      data-testid='orbit-thinking'
      data-fading={fading ? 'true' : 'false'}
    >
      <div className={styles.activeStep}>
        <OrbitGlyph size={22} />
        <span
          className={`${styles.label} ${hasRealLabel ? styles.labelReal : ''}`}
          data-testid='orbit-thinking-label'
        >
          {label}
        </span>
        {elapsed >= 2 && (
          <span className={styles.elapsed}>
            {elapsed}
            {sUnit}
          </span>
        )}
      </div>
    </div>
  );
};

export default OrbitThinking;
