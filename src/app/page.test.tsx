import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import HomePage from './page';

describe('HomePage', () => {
  it('renders the app title', () => {
    render(<HomePage />);
    expect(
      screen.getByRole('heading', { name: /lexical resources system/i }),
    ).toBeInTheDocument();
  });

  it('lists the four top-level categories', () => {
    render(<HomePage />);
    for (const name of ['Vocabulary', 'Accretion', 'Speaking', 'Writing']) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });
});
