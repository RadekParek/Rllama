import { describe, expect, it } from 'vitest';
import { createNdjsonParser, createSseParser } from '../sse';

describe('sse parser', () => {
  it('emits complete frames', () => {
    const events: string[] = [];
    const parser = createSseParser((event) => events.push(event.data));
    parser.push('data: {"a":1}\n\ndata: {"a":2}\n\n');
    expect(events).toEqual(['{"a":1}', '{"a":2}']);
  });

  it('survives a frame split across chunks', () => {
    const events: string[] = [];
    const parser = createSseParser((event) => events.push(event.data));
    parser.push('data: {"delta":"hel');
    parser.push('lo"}\n');
    parser.push('\n');
    expect(events).toEqual(['{"delta":"hello"}']);
  });

  it('handles multi-line data and event names', () => {
    const events: Array<{ event: string; data: string }> = [];
    const parser = createSseParser((event) => events.push(event));
    parser.push('event: content_block_delta\ndata: line1\ndata: line2\n\n');
    expect(events[0].event).toBe('content_block_delta');
    expect(events[0].data).toBe('line1\nline2');
  });

  it('ignores comments and stops at [DONE]', () => {
    const events: string[] = [];
    const parser = createSseParser((event) => events.push(event.data));
    parser.push(': keep-alive\n\ndata: {"ok":1}\n\ndata: [DONE]\n\ndata: {"ignored":1}\n\n');
    expect(events).toEqual(['{"ok":1}']);
    expect(parser.done).toBe(true);
  });

  it('flushes a trailing frame without a blank line', () => {
    const events: string[] = [];
    const parser = createSseParser((event) => events.push(event.data));
    parser.push('data: {"tail":true}');
    parser.flush();
    expect(events).toEqual(['{"tail":true}']);
  });

  it('handles CRLF line endings', () => {
    const events: string[] = [];
    const parser = createSseParser((event) => events.push(event.data));
    parser.push('data: {"crlf":true}\r\n\r\n');
    expect(events).toEqual(['{"crlf":true}']);
  });
});

describe('ndjson parser', () => {
  it('emits one object per line and handles partial lines', () => {
    const values: unknown[] = [];
    const parser = createNdjsonParser((value) => values.push(value));
    parser.push('{"a":1}\n{"b":');
    parser.push('2}\n');
    expect(values).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('ignores malformed lines', () => {
    const values: unknown[] = [];
    const parser = createNdjsonParser((value) => values.push(value));
    parser.push('not json\n{"ok":true}\n');
    expect(values).toEqual([{ ok: true }]);
  });
});
