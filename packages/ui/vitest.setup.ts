import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(cleanup); // Vitest globals are off, so Testing Library cannot register its own cleanup.

// jsdom has no pointer capture; Radix Toast's swipe handling calls it.
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
