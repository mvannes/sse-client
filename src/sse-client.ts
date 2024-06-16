export type SSEvent = DataEvent | ErrorEvent | EmptyEvent

export class ErrorEvent extends MessageEvent<undefined> {
    public constructor(public readonly error: Error, public readonly response: Response | undefined) {
        super('error');
    }

}

export class DataEvent extends MessageEvent<SSEData> {
    public constructor(type: string, data: SSEData) {
        super(type, {data: data});
    }
}

// Might be a heartbeat event that is only sending a single comment to keep the connection alive.
export class EmptyEvent extends MessageEvent<undefined> {
    public constructor() {
        super('empty', {});
    }

}

export interface SSEData {
    id: string,
    event: string,
    data: string,
    retry?: number,
}


export enum SseState {
    CONNECTING = 0,
    OPEN = 1,
    CLOSED = 2,
}

export interface SseOptions {
    headers?: Record<string, string>,
    body?: BodyInit | null,
    method?: string,
}

export class SseClient extends EventTarget {
    private abortController = new AbortController();
    private readyState: SseState = SseState.CONNECTING;

    public constructor(private readonly url: string, private readonly opts: SseOptions) {
        super();
        this.init();
    }

    private async init() {
        const headers: Record<string, string> = {...this.opts.headers}
        if (!headers.accept) {
            headers.accept = 'text/event-stream';
        }
        let response: Response;
        try {
            response = await fetch(this.url, {
                signal: this.abortController.signal,
                headers: headers,
                body: this.opts.body,
                method: this.opts.method as string, // This makes no sense to me.
            });
        } catch (err) {
            // If we've aborted, this must be an AbortError
            if (this.abortController.signal.aborted) {
                return;
            }

            this.doError(
                err,
                undefined
            );
            return;
        }

        // Status is not in 200 range.
        if (!response.ok) {
            this.doError(new Error('Response status was not in 200 range'), response);
            return;
        }

        // SSE requires content type to be text/event-stream.
        if (!response.headers.get('content-type')?.startsWith('text/event-stream')) {
            this.doError(new Error('content-type in response was not "text/event-stream"'), response);
            return;
        }

        this.readyState = SseState.OPEN;

        const lineToMessageBuffer = new LineToMessageBuffer((message) => {
            // All default fields, empty event.
            if (message.data === '' && message.id === '' && message.event === '' && message.retry === undefined) {
                this.dispatch(new EmptyEvent());
                return;
            }

            const type = message.event === '' ? 'message' : message.event;
            this.dispatch(new DataEvent(type, message));
        })
        const chunkToLineBuffer = new ChunkToLineBuffer((line) => {
            // Decode with utf-8 protocol as defined by spec.
            // Then pass on to the line buffer.
            lineToMessageBuffer.handleLine(new TextDecoder('utf-8').decode(line));
        });

        const reader = response.body.getReader();
        let result: ReadableStreamReadValueResult<Uint8Array> | ReadableStreamReadDoneResult<Uint8Array>;
        try {
            while (!(result = await reader.read()).done) {
                if (result.value === undefined) {
                    continue;
                }
                // Explicitly not awaiting, we are handling all of this async.
                chunkToLineBuffer.addChunk(result.value);
            }
        } catch (err) {
            // Aborted in expected fashion, nothing to do here.
            if (this.abortController.signal.aborted) {
                return;
            }
            this.doError(err, response);
        }
    }

    public dispatchEvent(event: Event & SSEvent): boolean {
        // Nasty cast happening here.
        return super.dispatchEvent(event as Event);
    }

    public dispatch(event: SSEvent): boolean {
        return this.dispatchEvent(event);
    }

    public addEventListener<
        T extends SSEvent['type'],
        E extends SSEvent & { type: T}
    >(type: T, listener: (event: Event & E) => boolean | null) {
        super.addEventListener(type, listener);
    }

    public removeEventListener(type: SSEvent['type']) {
        super.removeEventListener(type, null as EventListenerOrEventListenerObject | null);
    }

    private doError(err: Error, response: Response | undefined) {
        this.dispatch(new ErrorEvent(err, response));
        this.close();
    }

    public close() {
        this.abortController.abort();
        this.readyState = SseState.CLOSED;
    }
}

class LineToMessageBuffer {
    // Always initialize to empty message.
    private message: SSEData = this.emptyMessage();

    public constructor(private messageComplete: (message: SSEData) => void) {
    }

    public handleLine(line: string) {
        // Empty line denotes end of message, send and remake.
        if (line.length === 0) {
            this.messageComplete(this.message);
            this.message = this.emptyMessage();
            return;
        }
        const messagePartDelimiterPos =  line.indexOf(':');
        // First position, without name indicates a comment, do nothing.
        if (messagePartDelimiterPos === 0) {
            return;
        }

        const typePart = line.substring(0, messagePartDelimiterPos);
        // +1 To skip the colon delimiter itself.
        const dataPart = line.substring(messagePartDelimiterPos +1 , line.length);
        switch (typePart) {
            case 'event':
                this.message.event = dataPart;
                break;
            case 'id':
                this.message.id = dataPart;
                break;
            case 'retry':
                // Check if only ascii digits, then set. else ignore.
                break;
            case 'data':
                this.message.data += dataPart;
            default:
                // Any other event is unsupported, so ignore them.
                break;
        }
    }

    private emptyMessage(): SSEData {
        return {
            id: '',
            event: '',
            data: '',
            retry: undefined
        };
    }
}

class ChunkToLineBuffer {
    private buffer: Uint8Array | undefined;

    public constructor(private lineComplete: (line: Uint8Array) => void) {
    }

    public async addChunk(chunk: Uint8Array) {
        if (this.buffer === undefined) {
            this.buffer = chunk;
        } else {
            // If we are still in the process of parsing, just append to the buffer
            const newBuffer = new Uint8Array(this.buffer.length + chunk.length);
            newBuffer.set(this.buffer);
            newBuffer.set(chunk, this.buffer.length);
            this.buffer = newBuffer;
        }
        // Another explicit async task that is not handled by awaiting.
        this.drainBuffer();
    }

    public async drainBuffer() {
        if (this.buffer === undefined) {
            return;
        }

        let position = 0;
        let bufferLength = this.buffer.length;
        while(position < bufferLength) {
            const char = this.buffer[position];
            // 13 = \r
            // 10 = \n
            // If we are handling a carriage return followed by a line feed character, we handle them as a single
            // newline-like.
            if (char === 13 && this.buffer[position + 1] === 10) {
                position++;
                continue;
            }
            // Both line feed and carriage return must be handled as new lines.
            if (char === 10 || char === 13) {
                // We submit the line without the newline.
                // this makes for easier string checking of empty lines / easier parsing.
                const line = this.buffer.subarray(0, position);
                this.lineComplete(line);
                // Drain the buffer as well.
                // Note the +1 here, because we do want to remove the current newline from parsing to ensure we don't end
                // up in an infinite loop.
                this.buffer = this.buffer.subarray(position + 1);
                position = 0;
                bufferLength = this.buffer.length;
                continue;
            }
            position++
        }
    }

}