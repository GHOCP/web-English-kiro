import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { buildSearchHref } from './SearchBar';

/**
 * SearchBar component tests (Task 13).
 *
 * `next/navigation`'s `useRouter` is mocked so we can assert the debounced
 * input navigates to `/search?q=` and that submitting bypasses the debounce.
 * We drive the input with `fireEvent` (not `userEvent`) so it composes cleanly
 * with fake timers used to advance the debounce window deterministically.
 *
 * Requirements: 6.1, 11.5, NFR 2.1, NFR 2.2, NFR 2.4
 */

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

import { SearchBar } from './SearchBar';

beforeEach(() => {
  push.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('buildSearchHref', () => {
  it('trims and URL-encodes the query', () => {
    expect(buildSearchHref('  hello world  ')).toBe('/search?q=hello%20world');
    expect(buildSearchHref('a&b')).toBe('/search?q=a%26b');
  });
});

describe('SearchBar', () => {
  it('renders an accessible search landmark and labelled input', () => {
    render(<SearchBar />);
    expect(screen.getByRole('search')).toBeInTheDocument();
    expect(
      screen.getByRole('searchbox', { name: /search the lexical collection/i }),
    ).toBeInTheDocument();
  });

  it('navigates to the search route after the debounce window', () => {
    vi.useFakeTimers();
    render(<SearchBar debounceMs={250} />);

    const input = screen.getByRole('searchbox', {
      name: /search the lexical collection/i,
    });
    fireEvent.change(input, { target: { value: 'provoke' } });

    // Nothing yet — still within the debounce window.
    expect(push).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(push).toHaveBeenCalledWith('/search?q=provoke');
  });

  it('debounces rapid typing into a single navigation', () => {
    vi.useFakeTimers();
    render(<SearchBar debounceMs={250} />);

    const input = screen.getByRole('searchbox', {
      name: /search the lexical collection/i,
    });
    fireEvent.change(input, { target: { value: 'pro' } });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    fireEvent.change(input, { target: { value: 'provoke' } });
    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('/search?q=provoke');
  });

  it('navigates immediately on submit, bypassing the debounce', () => {
    render(<SearchBar />);

    const input = screen.getByRole('searchbox', {
      name: /search the lexical collection/i,
    });
    fireEvent.change(input, { target: { value: 'incite' } });
    fireEvent.submit(input);

    expect(push).toHaveBeenCalledWith('/search?q=incite');
  });

  it('does not navigate for an empty/whitespace query on submit', () => {
    render(<SearchBar />);

    const input = screen.getByRole('searchbox', {
      name: /search the lexical collection/i,
    });
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.submit(input);

    expect(push).not.toHaveBeenCalled();
  });
});
