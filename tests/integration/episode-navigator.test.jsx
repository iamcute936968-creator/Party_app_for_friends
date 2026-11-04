import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import EpisodeNavigator from '../../src/components/EpisodeNavigator';

afterEach(cleanup);
const episodes = Array.from({ length: 235 }, (_, index) => ({ number: index + 1, title: `Story ${index + 1}`, embeddable: true }));

describe('EpisodeNavigator component units', () => {
  it('limits each range to 100 episodes and initializes at the selected episode', () => {
    render(<EpisodeNavigator episodes={episodes} selectedNumber={205} onSelect={vi.fn()} />);
    const group = screen.getByRole('group', { name: 'Episode navigation' });
    expect(within(group).getAllByRole('button', { name: /^Watch episode / })).toHaveLength(35);
    expect(screen.getByRole('button', { name: 'Watch episode 205', exact: true }).getAttribute('aria-current')).toBe('true');
    expect(screen.getByLabelText('Episode range').value).toBe('2');
    fireEvent.change(screen.getByLabelText('Episode range'), { target: { value: '0' } });
    expect(screen.getAllByRole('button', { name: /^Watch episode / })).toHaveLength(100);
    expect(screen.queryByRole('button', { name: 'Watch episode 101', exact: true })).toBeNull();
  });

  it('sorts and deduplicates sparse episodes while retaining callback objects and titles', () => {
    const first = { number: 2, title: 'First story', embeddable: false, url: 'https://www.youtube.com/watch?v=abcdefghijk' };
    const last = { number: 400, title: 'Last story' }, onSelect = vi.fn();
    render(<EpisodeNavigator episodes={[last, first, { ...first, title: 'Duplicate' }, null, { number: -1 }]} selectedNumber={2} onSelect={onSelect} />);
    expect(screen.getAllByRole('button', { name: /^Watch episode / })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Watch episode 2', exact: true }).title).toContain('First story');
    expect(screen.getByRole('button', { name: 'Previous episode' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Next episode' }));
    expect(onSelect).toHaveBeenLastCalledWith(last);
    fireEvent.click(screen.getByRole('button', { name: 'Watch episode 2', exact: true }));
    expect(onSelect).toHaveBeenLastCalledWith(first);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('jumps to an exact available number and rejects missing or fractional episodes', () => {
    const onSelect = vi.fn();
    render(<EpisodeNavigator episodes={[{ number: 2 }, { number: 400 }]} selectedNumber={2} onSelect={onSelect} />);
    const input = screen.getByLabelText('Episode number');
    fireEvent.change(input, { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Go to episode' }));
    expect(screen.getByRole('alert').textContent).toContain('not listed');
    fireEvent.change(input, { target: { value: '2.5' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '400' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith({ number: 400 });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('updates the visible range when selection or available episodes change', () => {
    const view = render(<EpisodeNavigator episodes={episodes} selectedNumber={1} onSelect={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Episode range'), { target: { value: '1' } });
    view.rerender(<EpisodeNavigator episodes={episodes} selectedNumber={205} onSelect={vi.fn()} />);
    expect(screen.getByLabelText('Episode range').value).toBe('2');
    view.rerender(<EpisodeNavigator episodes={[{ number: 205 }]} selectedNumber={205} onSelect={vi.fn()} />);
    expect(screen.getByLabelText('Episode range').value).toBe('0');
    expect(screen.getByRole('button', { name: 'Next episode' }).disabled).toBe(true);
  });

  it('disables navigation and reports an empty episode collection', () => {
    const onSelect = vi.fn(), view = render(<EpisodeNavigator episodes={episodes} selectedNumber={2} onSelect={onSelect} disabled />);
    for (const button of screen.getAllByRole('button')) expect(button.disabled).toBe(true);
    expect(screen.getByLabelText('Episode range').disabled).toBe(true);
    expect(screen.getByLabelText('Episode number').disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Next episode' }));
    expect(onSelect).not.toHaveBeenCalled();
    view.rerender(<EpisodeNavigator episodes={[]} onSelect={onSelect} />);
    expect(screen.getByText('No episodes are available.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('EpisodeNavigator controlled parent integration', () => {
  it('keeps parent selection, sparse previous/next and jump range in agreement', () => {
    const available = [{ number: 1 }, { number: 50 }, ...episodes.filter(item => item.number > 50)];
    function Parent() {
      const [selected, setSelected] = useState(1);
      return <><output aria-label="Playing episode">{selected}</output><EpisodeNavigator episodes={available} selectedNumber={selected} onSelect={item => setSelected(item.number)} /></>;
    }
    render(<Parent />);
    fireEvent.click(screen.getByRole('button', { name: 'Next episode' }));
    expect(screen.getByLabelText('Playing episode').textContent).toBe('50');
    fireEvent.change(screen.getByLabelText('Episode number'), { target: { value: '220' } });
    fireEvent.click(screen.getByRole('button', { name: 'Go to episode' }));
    expect(screen.getByLabelText('Playing episode').textContent).toBe('220');
    expect(screen.getByRole('button', { name: 'Watch episode 220', exact: true }).getAttribute('aria-current')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Previous episode' }));
    expect(screen.getByLabelText('Playing episode').textContent).toBe('219');
  });
});
