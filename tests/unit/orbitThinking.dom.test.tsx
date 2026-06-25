import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OrbitThinking from '@/renderer/components/chat/observability/OrbitThinking';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

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

describe('OrbitThinking', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders a rotating phrase and the orbit glyph when processing with no label', () => {
    const { container } = render(<OrbitThinking isProcessing />);

    // No "Loaded context" line - it was removed per feedback.
    expect(screen.queryByText('Loaded context')).toBeNull();

    // Active label is one of the rotating phrases (no currentLabel).
    const label = screen.getByTestId('orbit-thinking-label');
    expect(PHRASES).toContain(label.textContent);

    // OrbitGlyph renders an aria-hidden svg with orbit elements (no extra check svg now).
    const svgs = container.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThanOrEqual(1);
    expect(container.querySelector('circle')).not.toBeNull();
  });

  it('shows the real currentLabel verbatim instead of a phrase', () => {
    render(<OrbitThinking isProcessing currentLabel='Searching the web…' />);

    const label = screen.getByTestId('orbit-thinking-label');
    expect(label.textContent).toBe('Searching the web…');
    expect(PHRASES).not.toContain(label.textContent);
  });

  it('reveals the elapsed timer only after >= 2 seconds', () => {
    render(<OrbitThinking isProcessing />);

    // Before 2s: no elapsed indicator.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByText(/^\d+s$/)).toBeNull();

    // After 2s: elapsed appears.
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.getByText(/^\d+s$/)).toBeInTheDocument();
  });

  it('fades then renders the 20px spacer when processing stops', () => {
    const { rerender, container } = render(<OrbitThinking isProcessing />);
    expect(screen.getByTestId('orbit-thinking')).toBeInTheDocument();

    // Stop processing -> fading state, still mounted.
    rerender(<OrbitThinking isProcessing={false} />);
    expect(screen.getByTestId('orbit-thinking')).toHaveAttribute('data-fading', 'true');

    // After the 200ms fade -> unmounts to the spacer.
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByTestId('orbit-thinking')).toBeNull();
    const spacer = container.firstChild as HTMLElement;
    expect(spacer).not.toBeNull();
    expect(spacer.style.minHeight).toBe('20px');
  });
});
