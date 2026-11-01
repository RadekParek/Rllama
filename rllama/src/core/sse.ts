/**
 * Server-sent-events parsing that survives chunk boundaries.
 *
 * Providers are not consistent: OpenAI sends `data: {...}` frames, Anthropic
 * sends `event: x` + `data: {...}`, and both may arrive split across arbitrary
 * network chunks. This parser buffers until a blank line, as the SSE spec says.
 */

export interface SseEvent {
  event: string;
  data: string;
}

export interface SseParser {
  push(chunk: string): void;
  /** Call once when the stream ends; flushes a trailing frame. */
  flush(): void;
  /** True once a `[DONE]` sentinel or an explicit stop was seen. */
  readonly done: boolean;
}

export function createSseParser(
  onEvent: (event: SseEvent) => void,
  options: { stopOnDone?: boolean } = {},
): SseParser {
  let buffer = '';
  let done = false;
  const stopOnDone = options.stopOnDone !== false;

  const dispatch = (rawFrame: string) => {
    if (done) {
      return;
    }
    const lines = rawFrame.split(/\r?\n/);
    let event = '';
    const dataLines: string[] = [];
    for (const line of lines) {
      if (!line || line.startsWith(':')) {
        continue;
      }
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) {
        value = value.slice(1);
      }
      if (field === 'event') {
        event = value;
      } else if (field === 'data') {
        dataLines.push(value);
      }
    }
    if (dataLines.length === 0) {
      return;
    }
    const data = dataLines.join('\n');
    if (stopOnDone && data.trim() === '[DONE]') {
      done = true;
      return;
    }
    onEvent({ event, data });
  };

  return {
    push(chunk: string) {
      if (done) {
        return;
      }
      buffer += chunk;
      // Frames are separated by a blank line.
      let index = buffer.search(/\r?\n\r?\n/);
      while (index !== -1) {
        const frame = buffer.slice(0, index);
        buffer = buffer.slice(index).replace(/^\r?\n\r?\n/, '');
        dispatch(frame);
        if (done) {
          buffer = '';
          return;
        }
        index = buffer.search(/\r?\n\r?\n/);
      }
    },
    flush() {
      if (done || !buffer.trim()) {
        buffer = '';
        return;
      }
      dispatch(buffer);
      buffer = '';
    },
    get done() {
      return done;
    },
  };
}

/**
 * Splits newline-delimited JSON (the Ollama native stream) across chunks.
 */
export interface NdjsonParser {
  push(chunk: string): void;
  flush(): void;
}

export function createNdjsonParser(onObject: (value: unknown) => void): NdjsonParser {
  let buffer = '';
  const emit = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    try {
      onObject(JSON.parse(trimmed));
    } catch {
      // A partial or malformed line is ignored; the stream continues.
    }
  };
  return {
    push(chunk: string) {
      buffer += chunk;
      let index = buffer.indexOf('\n');
      while (index !== -1) {
        emit(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf('\n');
      }
    },
    flush() {
      emit(buffer);
      buffer = '';
    },
  };
}
