import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import MangaPage from '../../src/components/MangaPage';
const id = '58be6aa6-06cb-4ca5-bd20-f1392ce451fb', chapterId = 'ff4f79de-6102-4610-8327-539904cfe549';
const item = { id, title: 'Yotsuba', description: 'A kind story.', genres: [], authors: [] };
afterEach(cleanup);
it('loads chapter jumps for a deep-linked reader and advances by actual chapter IDs', async () => {
  const nextId = 'ff4f79de-6102-4610-8327-539904cfe550', navigate = vi.fn();
  const chapter = { id: chapterId, mangaId: id, title: '', number: '1.5', pageCount: 2, groups: [], external: false };
  const api = { details: async () => item, chapter: async () => chapter, pageUrl: () => '/page.jpg', navigation: vi.fn(async () => ({ items: [{ id: chapterId, number: '1.5', aliases: [] }, { id: nextId, number: '2.5', aliases: [] }] })) };
  render(<MangaPage api={api} mangaId={id} chapterId={chapterId} navigate={navigate} library={{ items: [], status: 'guest' }} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Next chapter', exact: true }));
  expect(api.navigation).toHaveBeenCalledWith(id, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(navigate).toHaveBeenCalledWith('manga', id, nextId);
});
it('searches the catalog and offers explicit saved-manga actions', async () => {
  const api = { list: vi.fn(async () => ({ items: [item], pageInfo: { page: 1, hasNextPage: false } })), coverUrl: () => '' }, library = { items: [], status: 'guest', toggle: vi.fn() }, navigate = vi.fn();
  render(<MangaPage api={api} library={library} navigate={navigate} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Save Yotsuba' })); await waitFor(() => expect(library.toggle).toHaveBeenCalledWith({ id, title: 'Yotsuba' }));
  fireEvent.click(screen.getByRole('button', { name: 'Details for Yotsuba' })); expect(navigate).toHaveBeenCalledWith('manga', id);
});
it('lists real chapters and opens the selected chapter through navigation', async () => {
  const navigate = vi.fn(), api = { details: vi.fn(async () => item), coverUrl: () => '', chapters: vi.fn(async () => ({ items: [{ id: chapterId, mangaId: id, title: 'A day', number: '1.5', pageCount: 5, groups: [], external: false }], pageInfo: { page: 1, hasNextPage: false } })) };
  render(<MangaPage api={api} mangaId={id} navigate={navigate} library={{ items: [], status: 'guest' }} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Read chapter 1.5' })); expect(navigate).toHaveBeenCalledWith('manga', id, chapterId);
});

it('shows an empty saved collection even while the catalog request has not completed', async () => {
  const api = { list: () => new Promise(() => {}), coverUrl: () => '' };
  render(<MangaPage api={api} library={{ items: [], status: 'guest' }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Saved manga', exact: true }));
  expect(screen.getByText('Save a manga to find it here.')).toBeTruthy();
});
