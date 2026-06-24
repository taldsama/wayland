/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import classNames from 'classnames';
import styles from './OrbitGlyph.module.css';

type Props = {
  size?: number;
  className?: string;
};

/**
 * Animated Wayland orbit-logo "thinking" glyph. Inline SVG clone of the brand
 * mark (WaylandLogoMark) so individual sub-elements can animate: the orbit arcs
 * sweep, the electrons counter-rotate, and the nucleus breathes. Purely
 * decorative (the textual status label is rendered separately), hence aria-hidden.
 */
const OrbitGlyph: React.FC<Props> = ({ size = 22, className }) => (
  <svg
    className={classNames(styles.orbit, className)}
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    strokeWidth='2'
    strokeLinecap='round'
    strokeLinejoin='round'
    aria-hidden='true'
    focusable='false'
  >
    <g className={styles.arcs}>
      <path d='M20.341 6.484A10 10 0 0 1 10.266 21.85' />
      <path d='M3.659 17.516A10 10 0 0 1 13.74 2.152' />
    </g>
    <g className={styles.sat}>
      <circle cx='19' cy='5' r='2' />
      <circle cx='5' cy='19' r='2' />
    </g>
    <circle className={styles.nucleus} cx='12' cy='12' r='3' />
  </svg>
);

export default OrbitGlyph;
