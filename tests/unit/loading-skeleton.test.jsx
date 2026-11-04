import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import LoadingSkeleton from '../../src/components/LoadingSkeleton';
import PosterImage from '../../src/components/PosterImage';
afterEach(cleanup);
it('announces one busy state with decorative placeholders and no fake controls', () => {
  const { container } = render(<LoadingSkeleton label="Loading titles..." count={5} />);
  expect(screen.getByRole('status', { name: 'Loading titles...' }).getAttribute('aria-busy')).toBe('true');
  expect(container.querySelectorAll('.skeleton-card')).toHaveLength(5);
  expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy();
  expect(container.querySelector('button, a, input, img')).toBeNull();
});
it('supports detail, episode and player layouts', () => {
  for (const variant of ['detail', 'episodes', 'player']) {
    const view = render(<LoadingSkeleton variant={variant} />);
    expect(view.container.querySelector(`[data-layout="${variant}"]`)).toBeTruthy(); view.unmount();
  }
});
it('keeps the poster placeholder until load, resets for a new URL, and handles failure', () => {
  const view = render(<PosterImage src="/one.jpg" alt="Cover for One" />);
  expect(view.container.querySelector('.poster-image').getAttribute('aria-busy')).toBe('true');
  fireEvent.load(screen.getByRole('img', { name: 'Cover for One' }));
  expect(view.container.querySelector('.poster-image').getAttribute('aria-busy')).toBe('false');
  expect(view.container.querySelector('.poster-image-loading')).toBeNull();
  view.rerender(<PosterImage src="/two.jpg" alt="Cover for Two" />);
  expect(view.container.querySelector('.poster-image-loading')).toBeTruthy();
  fireEvent.error(screen.getByRole('img', { name: 'Cover for Two' }));
  expect(view.container.querySelector('img')).toBeNull();
  expect(screen.getByRole('img', { name: 'Cover for Two' })).toBeTruthy();
  expect(view.container.querySelector('.poster-image-loading')).toBeNull();
});
