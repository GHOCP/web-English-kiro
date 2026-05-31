import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * ThemeToggle component tests (Task 13).
 *
 * `next-themes`' `useTheme` is mocked so we can assert the toggle reads the
 * resolved theme, renders an accessible labelled button, and calls `setTheme`
 * with the opposite theme on click — switching dark ↔ light.
 *
 * Requirements: 5.x (theme toggle), NFR 2.2, NFR 2.4
 */

const setTheme = vi.fn();
let resolvedTheme = 'dark';

vi.mock('next-themes', () => ({
  useTheme: () => ({ resolvedTheme, setTheme }),
}));

import { ThemeToggle } from './ThemeToggle';

beforeEach(() => {
  setTheme.mockClear();
  resolvedTheme = 'dark';
});

describe('ThemeToggle', () => {
  it('renders an accessible button labelled for switching to light from dark', () => {
    resolvedTheme = 'dark';
    render(<ThemeToggle />);
    expect(
      screen.getByRole('button', { name: /switch to light theme/i }),
    ).toBeInTheDocument();
  });

  it('switches to light when currently dark', async () => {
    resolvedTheme = 'dark';
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(
      screen.getByRole('button', { name: /switch to light theme/i }),
    );
    expect(setTheme).toHaveBeenCalledWith('light');
  });

  it('switches to dark when currently light', async () => {
    resolvedTheme = 'light';
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(
      screen.getByRole('button', { name: /switch to dark theme/i }),
    );
    expect(setTheme).toHaveBeenCalledWith('dark');
  });

  it('reflects the active theme via aria-pressed', () => {
    resolvedTheme = 'dark';
    render(<ThemeToggle />);
    expect(
      screen.getByRole('button', { name: /switch to light theme/i }),
    ).toHaveAttribute('aria-pressed', 'true');
  });
});
