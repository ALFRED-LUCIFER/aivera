import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { contrast, resolveColour, stylesCss, tokens, type Theme } from '../test/theme.ts';
import { Button, type ButtonSize } from './Button.tsx';

const classesOf = (el: HTMLElement) => el.className.split(' ');

describe('Button', () => {
  it('is a real button that does not submit forms by default', () => {
    render(<Button>Cancel</Button>);
    expect(screen.getByRole('button', { name: 'Cancel' }).getAttribute('type')).toBe('button');
  });

  it('activates with the keyboard', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    await userEvent.tab();
    await userEvent.keyboard('{Enter} ');
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  // SAFETY: mutation check: primary text-on-action -> text-bg, and --color-on-action -> var(--bg) -> both themes failed
  describe('Scenario Outline: Controls use the token values, not literals', () => {
    it.each<[Theme, string, string]>([
      ['light', '#1B1720', '#FFFFFF'],
      ['dark', '#F4F1F6', '#1B1720'],
    ])('%s: a primary background is action %s and its text is on-action %s', (theme, action, onAction) => {
      render(<Button variant="primary">Confirm move</Button>);
      const classes = classesOf(screen.getByRole('button'));
      expect(classes).toEqual(expect.arrayContaining(['bg-action', 'text-on-action']));
      expect(resolveColour('bg-action', theme)).toBe(action);
      expect(resolveColour('text-on-action', theme)).toBe(onAction);
    });
  });

  // SAFETY: mutation check: touch h-11 -> h-10 -> the touch row failed
  describe('Scenario Outline: Control heights follow the size scale', () => {
    it.each<[ButtonSize, number]>([
      ['compact', 36],
      ['standard', 40],
      ['touch', 44],
    ])('%s is %ipx high with an 8px radius', (size, px) => {
      render(<Button size={size}>Move</Button>);
      const classes = classesOf(screen.getByRole('button'));
      expect(classes).toContain(`h-${px / 4}`); // Tailwind spacing is 4px per step
      expect(tokens.control[size]).toBe(`${px}px`);
      expect(classes).toContain('rounded-control');
      expect(stylesCss).toMatch(/--radius-control:\s*var\(--radius-control\);/);
      expect(tokens.radius['control']).toBe('8px');
    });

    it('grows to 44px on a coarse pointer at every size', () => {
      render(<Button size="compact">Move</Button>);
      expect(classesOf(screen.getByRole('button'))).toContain('pointer-coarse:min-h-11');
    });
  });

  // SAFETY: mutation check: removed aria-disabled -> failed; text-3 lightened to #8A8490 -> contrast failed
  describe('Scenario: Disabled reads as unavailable', () => {
    it('is not focusable by click or Tab and has aria-disabled', async () => {
      const onClick = vi.fn();
      render(
        <Button disabled onClick={onClick}>
          Unavailable
        </Button>,
      );
      const button = screen.getByRole('button', { name: 'Unavailable' });
      await userEvent.click(button);
      expect(onClick).not.toHaveBeenCalled();
      expect(document.activeElement).not.toBe(button);
      await userEvent.tab();
      expect(document.activeElement).not.toBe(button);
      expect(button.getAttribute('aria-disabled')).toBe('true');
    });

    it.each<Theme>(['light', 'dark'])('keeps at least 4.5:1 text contrast in %s', (theme) => {
      render(<Button disabled>Unavailable</Button>);
      const classes = classesOf(screen.getByRole('button'));
      expect(classes).toEqual(expect.arrayContaining(['disabled:text-text-3', 'disabled:bg-surface-subtle']));
      const text = resolveColour('text-text-3', theme) ?? '';
      const ground = resolveColour('bg-surface-subtle', theme) ?? '';
      expect(contrast(text, ground)).toBeGreaterThanOrEqual(4.5);
    });
  });
});
