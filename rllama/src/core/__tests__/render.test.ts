import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import App from '../../App';

/**
 * Smoke test for the shell.
 *
 * There is no browser in CI here, so the cheapest guard against "white screen
 * after a refactor" is rendering the whole app tree once server-side: any
 * undefined component, bad hook order or missing default throws here.
 */
describe('app shell', () => {
  it('renders the sidebar, top bar and composer', () => {
    const html = renderToStaticMarkup(React.createElement(App));
    expect(html).toContain('Rllama');
    expect(html).toContain('New chat');
    expect(html).toContain('Message Rllama');
    expect(html).toContain('What are we building?');
    expect(html).toContain('Browse Ollama models');
    // The three pre-installed skill chips must be reachable straight away.
    expect(html).toContain('Caveman');
    expect(html).toContain('REA');
    expect(html).toContain('OpenRouter');
  });
});
