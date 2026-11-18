import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Button } from './Button.tsx';

describe('Button', () => {
  it('is a real button that does not submit forms by default', () => {
    expect(renderToStaticMarkup(<Button>Cancel</Button>)).toMatch(/^<button type="button"/);
  });

  it('primary uses the action tokens', () => {
    const html = renderToStaticMarkup(<Button variant="primary">Confirm move</Button>);
    expect(html).toContain('bg-action');
    expect(html).toContain('text-on-action');
  });

  it('standard is 40 px, compact is 36 px, and both grow to 44 px on a coarse pointer', () => {
    expect(renderToStaticMarkup(<Button>Standard</Button>)).toContain('h-10');
    const compact = renderToStaticMarkup(<Button size="compact">Compact</Button>);
    expect(compact).toContain('h-9');
    expect(compact).toContain('pointer-coarse:min-h-11');
  });

  it('a disabled button keeps its reason visible as text, not only opacity', () => {
    const html = renderToStaticMarkup(<Button disabled>Unavailable</Button>);
    expect(html).toContain('disabled=""');
    expect(html).toContain('Unavailable');
    expect(html).toContain('disabled:text-text-3');
  });
});
