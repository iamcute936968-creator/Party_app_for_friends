import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import MediaDiscovery from '../../src/components/MediaDiscovery';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const item = { id: 'Spirited_Away', title: 'Spirited Away', description: '2001 anime film', excerpt: 'A story of courage.', posterUrl: 'https://upload.wikimedia.org/a.jpg', sourceUrl: 'https://en.wikipedia.org/wiki/Spirited_Away' };
const response = body => ({ ok: true, json: async () => body });
function search(value) {
  fireEvent.change(screen.getByLabelText('Movie or anime title'), { target: { value } });
  fireEvent.submit(screen.getByRole('button', { name: 'Search titles' }).closest('form'));
}

it('encodes searches and loads a separate details panel with attribution and canonical source', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(response({ items: [item] })).mockResolvedValueOnce(response({ ...item, extract: 'A full film description.' }));
  vi.stubGlobal('fetch', fetch);
  render(<MediaDiscovery proxyUrl="https://proxy.example/" />);
  search('  Spirited & q=elsewhere  ');
  await screen.findByRole('button', { name: 'Details for Spirited Away' });
  expect(fetch.mock.calls[0][0]).toBe('https://proxy.example/api/catalog/search?q=Spirited%20%26%20q%3Delsewhere');
  expect(fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  expect(screen.getByText('Wikipedia / Wikimedia')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Details for Spirited Away' }));
  await screen.findByText('A full film description.');
  expect(fetch.mock.calls[1][0]).toBe('https://proxy.example/api/catalog/details?id=Spirited_Away');
  expect(screen.getByRole('link', { name: 'Read on Wikipedia' }).getAttribute('href')).toBe(item.sourceUrl);
  expect(screen.queryByRole('button', { name: /play|watch/i })).toBeNull();
});

it('renders hostile content as text, rejects unsafe images/source URLs and hides failed posters', async () => {
  const title = '<img src=x onerror=alert(1)>';
  const fetch = vi.fn().mockResolvedValueOnce(response({ items: [{ ...item, id: 'hostile', title, description: '<script>bad()</script>', posterUrl: 'https://evil.example/x', sourceUrl: 'javascript:alert(1)' }, item] }))
    .mockResolvedValueOnce(response({ ...item, title, extract: '<img src=x onerror=evil()>', sourceUrl: 'https://en.wikipedia.org.evil.example/wiki/Bad' }));
  vi.stubGlobal('fetch', fetch);
  const view = render(<MediaDiscovery proxyUrl="https://proxy.example" />);
  search('anime');
  await screen.findByText(title);
  expect(screen.getByText('<script>bad()</script>')).toBeTruthy();
  expect(view.container.querySelector('script')).toBeNull();
  expect(view.container.querySelectorAll('img')).toHaveLength(1);
  const poster = view.container.querySelector('img');
  fireEvent.error(poster);
  expect(poster.hidden).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: `Details for ${title}` }));
  await screen.findByText('<img src=x onerror=evil()>');
  expect(screen.queryByRole('link', { name: 'Read on Wikipedia' })).toBeNull();
});

it('prevents stale search and detail completions and aborts requests on unmount', async () => {
  let oldSearch, oldDetails;
  const fetch = vi.fn().mockImplementationOnce(() => new Promise(resolve => { oldSearch = resolve; }))
    .mockResolvedValueOnce(response({ items: [item] }))
    .mockImplementationOnce(() => new Promise(resolve => { oldDetails = resolve; }))
    .mockResolvedValueOnce(response({ items: [{ ...item, id: 'New', title: 'New result' }] }))
    .mockImplementationOnce(() => new Promise(() => {}));
  vi.stubGlobal('fetch', fetch);
  const view = render(<MediaDiscovery proxyUrl="https://proxy.example" />);
  search('old title');
  const firstSignal = fetch.mock.calls[0][1].signal;
  search('new title');
  await screen.findByText('Spirited Away');
  expect(firstSignal.aborted).toBe(true);
  await act(async () => oldSearch(response({ items: [{ ...item, title: 'Stale result' }] })));
  expect(screen.queryByText('Stale result')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Details for Spirited Away' }));
  const detailSignal = fetch.mock.calls[2][1].signal;
  search('latest title');
  await screen.findByText('New result');
  expect(detailSignal.aborted).toBe(true);
  await act(async () => oldDetails(response({ ...item, extract: 'Stale detail' })));
  expect(screen.queryByText('Stale detail')).toBeNull();
  search('pending title');
  const pendingSignal = fetch.mock.calls[4][1].signal;
  view.unmount();
  expect(pendingSignal.aborted).toBe(true);
});

it('shows configuration and validation limits, generic retryable errors and empty results', async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new Error('private upstream details')).mockResolvedValueOnce(response({ items: [] })).mockResolvedValueOnce(response({ items: 'invalid' }));
  vi.stubGlobal('fetch', fetch);
  const missing = render(<MediaDiscovery proxyUrl="" />);
  expect(screen.getByText(/Discovery is unavailable/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Search titles' }).disabled).toBe(true);
  missing.unmount();
  render(<MediaDiscovery proxyUrl="https://proxy.example" />);
  search('a');
  expect(screen.getByRole('alert').textContent).toContain('2 to 80');
  expect(fetch).not.toHaveBeenCalled();
  search('x'.repeat(81));
  expect(fetch).not.toHaveBeenCalled();
  search('anime');
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('try again'));
  expect(screen.queryByText(/private upstream/)).toBeNull();
  search('film');
  await screen.findByText('No titles found. Try another title.');
  search('other');
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('try again'));
});

it('keeps the selected cards available when details fail and permits a retry', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(response({ items: [item] }))
    .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'private provider message' }) })
    .mockResolvedValueOnce(response({ ...item, extract: 'Details after retry.' }));
  vi.stubGlobal('fetch', fetch);
  render(<MediaDiscovery proxyUrl="https://proxy.example" />);
  search('anime');
  const button = await screen.findByRole('button', { name: 'Details for Spirited Away' });
  fireEvent.click(button);
  await screen.findByRole('alert');
  expect(screen.getByRole('alert').textContent).toContain('try again');
  expect(screen.queryByText(/private provider/)).toBeNull();
  fireEvent.click(button);
  await screen.findByText('Details after retry.');
  expect(screen.queryByRole('alert')).toBeNull();
});
