import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import DiscoverPage from '../../src/components/DiscoverPage';
vi.mock('../../src/components/AnimePage', () => ({ default: ({ favorites, navigate }) => <section><h1>Discover anime</h1><button onClick={() => { favorites.toggle({ id: 'ap_naruto', title: 'Naruto' }); navigate('anime', 'ap_naruto'); }}>Naruto</button></section> }));
afterEach(cleanup);
it('defaults to anime discovery and keeps the existing movie flow behind its own tab', async () => {
  const favorites = { toggle: vi.fn() }, navigate = vi.fn();
  render(<DiscoverPage favorites={favorites} navigate={navigate} />);
  expect(await screen.findByRole('heading', { name: 'Discover anime' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Naruto' })); expect(favorites.toggle).toHaveBeenCalled(); expect(navigate).toHaveBeenCalledWith('anime', 'ap_naruto');
  fireEvent.click(screen.getByRole('button', { name: 'Movies & TV', exact: true }));
  expect(await screen.findByRole('heading', { name: 'Movies & TV.' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Reference search', exact: true }));
  expect(screen.getByRole('textbox', { name: 'Movie or anime title' })).toBeTruthy();
});
