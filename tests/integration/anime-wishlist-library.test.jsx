import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import MediaLibrary from '../../src/components/MediaLibrary';
afterEach(cleanup);
it('shows saved anime inside the Library Wishlist tab and opens the selected title', () => {
  const open = vi.fn();
  render(<MediaLibrary library={{ items: [], persistent: true }} animeFavorites={{ items: [{ id: 'ap_naruto', title: 'Naruto' }], status: 'guest', remove: vi.fn() }} onOpenAnime={open} />);
  expect(screen.queryByRole('button', { name: 'Open Naruto' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Wishlist', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Open Naruto' })); expect(open).toHaveBeenCalledWith('ap_naruto');
});
