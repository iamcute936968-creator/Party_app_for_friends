import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import MovieSavedList from '../../src/components/MovieSavedList';

const movie = { kind: 'movie', id: '10378', title: 'Big Buck Bunny', wishlist: true, position: 45, duration: 300, season: 0, episode: 0, lastWatchedAt: 100, completed: false };
const show = { kind: 'tv', id: '1399', title: 'The Flash', wishlist: true, position: 74, duration: 2400, season: 1, episode: 1, lastWatchedAt: 200, completed: false };

afterEach(cleanup);

it('renders red cross remove buttons for movies and TV in history, continue watching, and wishlist', async () => {
  const library = {
    items: [movie, show],
    status: 'synced',
    remove: vi.fn().mockResolvedValue(),
  };

  // 1. History mode
  const { rerender } = render(<MovieSavedList library={library} mode="History" />);
  expect(screen.getByRole('heading', { name: 'Movies & TV history' })).toBeTruthy();
  const historyRemoveBtn = screen.getByRole('button', { name: 'Remove Big Buck Bunny from history' });
  expect(historyRemoveBtn).toBeTruthy();
  expect(historyRemoveBtn.classList.contains('library-remove-btn')).toBe(true);
  expect(historyRemoveBtn.querySelector('svg')).toBeTruthy(); // Red cross icon
  fireEvent.click(historyRemoveBtn);
  await waitFor(() => expect(library.remove).toHaveBeenCalledWith(movie, { mode: 'History' }));

  // 2. Continue watching mode
  rerender(<MovieSavedList library={library} mode="Continue watching" />);
  expect(screen.getByRole('heading', { name: 'Continue movies & TV' })).toBeTruthy();
  const continueRemoveBtn = screen.getByRole('button', { name: 'Remove The Flash from continue watching' });
  expect(continueRemoveBtn).toBeTruthy();
  expect(continueRemoveBtn.classList.contains('library-remove-btn')).toBe(true);
  fireEvent.click(continueRemoveBtn);
  await waitFor(() => expect(library.remove).toHaveBeenCalledWith(show, { mode: 'Continue watching' }));

  // 3. Wishlist mode
  rerender(<MovieSavedList library={library} mode="Wishlist" />);
  expect(screen.getByRole('heading', { name: 'Movies & TV wishlist' })).toBeTruthy();
  const wishlistRemoveBtn = screen.getByRole('button', { name: 'Remove Big Buck Bunny from wishlist' });
  expect(wishlistRemoveBtn).toBeTruthy();
  expect(wishlistRemoveBtn.classList.contains('library-remove-btn')).toBe(true);
  fireEvent.click(wishlistRemoveBtn);
  await waitFor(() => expect(library.remove).toHaveBeenCalledWith(movie, { mode: 'Wishlist' }));
});

it('handles remove failure and displays an accessible error notice', async () => {
  const library = {
    items: [movie],
    status: 'synced',
    remove: vi.fn().mockRejectedValue(new Error('sync error')),
  };

  render(<MovieSavedList library={library} mode="History" />);
  const removeBtn = screen.getByRole('button', { name: 'Remove Big Buck Bunny from history' });
  fireEvent.click(removeBtn);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toContain('could not be updated');
});

