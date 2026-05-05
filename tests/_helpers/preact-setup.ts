// Test setup for Preact component tests (loaded via setupFiles in
// vitest.config.ts when env=jsdom). Wires @testing-library/jest-dom
// matchers (toBeInTheDocument, toHaveClass, ...) into vitest's expect and
// installs an afterEach cleanup so DOM state doesn't leak between tests.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/preact';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
