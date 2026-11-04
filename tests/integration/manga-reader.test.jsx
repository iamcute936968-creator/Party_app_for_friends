import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import MangaReader from '../../src/components/MangaReader';
const id = '58be6aa6-06cb-4ca5-bd20-f1392ce451fb', chapterId = 'ff4f79de-6102-4610-8327-539904cfe549';
const chapter = { id: chapterId, mangaId: id, number: '1', title: 'A day', pageCount: 5, external: false, groups: [{ id, name: 'Example group' }] };
let observers, readingPage;
beforeEach(() => {
  observers = []; readingPage = 1;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
    if (this.getAttribute('role') === 'toolbar') return { top: 20, bottom: 80, height: 60 };
    if (this.dataset.page !== undefined) { const top = (Number(this.dataset.page) + 1 - readingPage) * 1000 + 88; return { top, bottom: top + 1000, height: 1000 }; }
    return { top: 0, bottom: 0, height: 0 };
  });
  Element.prototype.scrollIntoView = vi.fn(function () { if (this.dataset.page !== undefined) readingPage = Number(this.dataset.page) + 1; });
  vi.stubGlobal('scrollBy', vi.fn());
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe() {}
    disconnect() {}
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); delete Element.prototype.scrollIntoView; });
const notify = number => act(() => observers[0].callback([{ target: screen.getByTestId(`manga-page-${number}`), isIntersecting: true, intersectionRatio: 1 }]));
const visible = number => { fireEvent.wheel(window); readingPage = number; notify(number); };
const setup = (overrides = {}) => {
  const library = { items: [], status: 'guest', record: vi.fn() }, api = { pageUrl: vi.fn((_id, _chapter, page, attempt) => `https://proxy.example/page/${page}?attempt=${attempt}`) }, navigate = vi.fn();
  render(<MangaReader manga={{ id, title: 'Yotsuba' }} chapter={chapter} api={api} library={library} navigate={navigate} {...overrides} />);
  return { library, api, navigate };
};
it('renders the full chapter with bounded active images and saves loaded visible pages only', async () => {
  const { library, api } = setup({ chapter: { ...chapter, pageCount: 500 } });
  expect(screen.getAllByTestId(/^manga-page-/)).toHaveLength(500);
  expect(screen.getAllByRole('img')).toHaveLength(2); expect(api.pageUrl).toHaveBeenCalledTimes(2);
  fireEvent.load(screen.getByRole('img', { name: 'Page 2 of 500' })); expect(library.record).not.toHaveBeenCalled();
  visible(1); fireEvent.load(screen.getByRole('img', { name: 'Page 1 of 500' }));
  await waitFor(() => expect(library.record).toHaveBeenLastCalledWith({ id, title: 'Yotsuba', chapterId, page: 0 }));
  visible(2); await waitFor(() => expect(library.record).toHaveBeenLastCalledWith({ id, title: 'Yotsuba', chapterId, page: 1 }));
  expect(screen.getAllByRole('img')).toHaveLength(3);
  expect(screen.getByRole('link', { name: 'Example group' })).toBeTruthy(); expect(screen.getByRole('link', { name: 'MangaDex' })).toBeTruthy();
});
it('resumes and jumps without treating newly preloaded pages as read', async () => {
  const library = { items: [{ id, chapterId, page: 2 }], status: 'guest', record: vi.fn() };
  setup({ library }); expect(screen.getByText('Page 3 of 5')).toBeTruthy();
  visible(3); fireEvent.load(screen.getByRole('img', { name: 'Page 3 of 5' }));
  await waitFor(() => expect(library.record).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Go to page' }), { target: { value: '5' } });
  fireEvent.submit(screen.getByRole('form', { name: 'Jump to manga page' }));
  expect(screen.getByText('Page 5 of 5')).toBeTruthy();
  fireEvent.load(screen.getByRole('img', { name: 'Page 5 of 5' }));
  visible(5); await waitFor(() => expect(library.record).toHaveBeenLastCalledWith({ id, title: 'Yotsuba', chapterId, page: 4 }));
  expect(screen.getByRole('button', { name: 'Next page', exact: true }).disabled).toBe(true);
});
it('preserves successful progress when a visible page fails, then supports retry', async () => {
  const { library, api } = setup(); visible(1); fireEvent.load(screen.getByRole('img', { name: 'Page 1 of 5' }));
  await waitFor(() => expect(library.record).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: 'Next page', exact: true })); visible(2);
  fireEvent.error(screen.getByRole('img', { name: 'Page 2 of 5' }));
  expect(screen.getByRole('alert').textContent).toContain('could not load'); expect(library.record).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Retry page 2' }));
  expect(api.pageUrl).toHaveBeenCalledWith(id, chapterId, 1, 1);
  fireEvent.load(screen.getByRole('img', { name: 'Page 2 of 5' }));
  await waitFor(() => expect(library.record).toHaveBeenLastCalledWith({ id, title: 'Yotsuba', chapterId, page: 1 }));
});
it('times out stalled active images without changing the last good bookmark', () => {
  vi.useFakeTimers(); const { library } = setup(); visible(1);
  act(() => vi.advanceTimersByTime(30000));
  expect(screen.getAllByRole('alert').length).toBeGreaterThan(0); expect(library.record).not.toHaveBeenCalled();
});
it('navigates real adjacent chapter IDs and offers bounded chapter-feed pagination', () => {
  const next = { ...chapter, id, number: '1.5' }, onChapterPage = vi.fn();
  const { navigate } = setup({ chapterFeed: { items: [chapter, next], pageInfo: { page: 2, hasNextPage: true } }, onChapterPage });
  fireEvent.click(screen.getByRole('button', { name: 'Next chapter' })); expect(navigate).toHaveBeenCalledWith('manga', id, id);
  fireEvent.change(screen.getByRole('combobox', { name: 'Jump to chapter' }), { target: { value: id } }); expect(navigate).toHaveBeenLastCalledWith('manga', id, id);
  fireEvent.click(screen.getByRole('button', { name: 'More chapters' })); expect(onChapterPage).toHaveBeenCalledWith(3);
});
it('pins explicit jumps against stale observer entries and layout changes until intentional scrolling', async () => {
  const { library } = setup(); visible(1); fireEvent.load(screen.getByRole('img', { name: 'Page 1 of 5' }));
  await waitFor(() => expect(library.record).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Go to page' }), { target: { value: '5' } });
  fireEvent.submit(screen.getByRole('form', { name: 'Jump to manga page' }));
  notify(4); expect(screen.getByText('Page 5 of 5')).toBeTruthy();
  fireEvent.load(screen.getByRole('img', { name: 'Page 5 of 5' }));
  await waitFor(() => expect(library.record).toHaveBeenLastCalledWith({ id, title: 'Yotsuba', chapterId, page: 4 }));
  readingPage = 4; fireEvent.load(screen.getByRole('img', { name: 'Page 4 of 5' }));
  expect(screen.getByText('Page 5 of 5')).toBeTruthy(); expect(readingPage).toBe(5);
  expect(library.record).toHaveBeenCalledTimes(2);
  visible(4); await waitFor(() => expect(library.record).toHaveBeenLastCalledWith({ id, title: 'Yotsuba', chapterId, page: 3 }));
  expect(screen.getByText('Page 4 of 5')).toBeTruthy();
  expect(screen.getByRole('toolbar').contains(screen.getByRole('button', { name: 'All chapters' }))).toBe(true);
});
