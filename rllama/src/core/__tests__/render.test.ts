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
  it('renders the top bar, greeting and composer', () => {
    const html = renderToStaticMarkup(React.createElement(App));
    expect(html).toContain('Hey! What are you up to today?');
    expect(html).toContain('New chat');
    expect(html).toContain('Ask anything');
    expect(html).toContain('Pick a model');
    expect(html).toContain('Medium effort');
  });

  it('ships the three skill packs enabled', () => {
    const html = renderToStaticMarkup(React.createElement(App));
    for (const skill of ['Caveman', 'REA', 'OpenRouter']) {
      expect(html).toContain(skill);
    }
    // Enabled chips carry the `on` class.
    expect(html).toMatch(/class="pill skill-pill on"/);
  });

  it('starts on the seeded local model', () => {
    const html = renderToStaticMarkup(React.createElement(App));
    expect(html).toContain('treyleo16/claude-oss');
  });
});
