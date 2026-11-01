import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import App from '../../App';
import { initialState } from '../store';

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
    expect(html).toContain('Agent');
  });

  it('ships the three skill packs enabled', () => {
    // The composer keeps the row sparse and only reports the count.
    const html = renderToStaticMarkup(React.createElement(App));
    expect(html).toContain('3 skills');
    expect(initialState().skillIds).toEqual(['caveman', 'rea', 'openrouter']);
  });

  it('starts on the seeded local model', () => {
    const html = renderToStaticMarkup(React.createElement(App));
    expect(html).toContain('treyleo16/claude-oss');
  });
});
