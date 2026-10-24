// The speech-to-speech model connection. The voice gateway talks to this interface; production
// opens a WebSocket to the OpenAI Realtime API, tests plug in a scripted model.
export interface RealtimeSession {
  /** Sends a client event (session.update, input_audio_buffer.append, response.cancel, ...). */
  send(event: Record<string, unknown>): void;
  onEvent(handler: (event: Record<string, unknown>) => void): void;
  onClose(handler: (code: number) => void): void;
  close(): void;
}

export interface RealtimeConnector {
  connect(): Promise<RealtimeSession>;
}
