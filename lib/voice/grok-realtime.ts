"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const SAMPLE_RATE = 24000;

export type GrokVoiceSession = {
  token: string;
  url: string;
  voice: string;
  instructions: string;
};

type SessionCallbacks = {
  onOpen: () => void;
  onSpeaking: (speaking: boolean) => void;
  onError: (message: string) => void;
  onClose: () => void;
};

type ConversationOptions = {
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: string) => void;
};

export function useGrokConversation(options: ConversationOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const sessionRef = useRef<GrokRealtimeSession | null>(null);
  const [status, setStatus] = useState<"disconnected" | "connecting" | "connected">("disconnected");
  const [isSpeaking, setIsSpeaking] = useState(false);

  const endSession = useCallback(() => {
    const active = sessionRef.current;
    sessionRef.current = null;
    active?.stop();
    setStatus("disconnected");
    setIsSpeaking(false);
    if (active) optionsRef.current.onDisconnect?.();
  }, []);

  const startSession = useCallback(async (session: GrokVoiceSession) => {
    sessionRef.current?.stop();
    setStatus("connecting");
    setIsSpeaking(false);
    const active = new GrokRealtimeSession(session, {
      onOpen: () => {
        setStatus("connected");
        optionsRef.current.onConnect?.();
      },
      onSpeaking: setIsSpeaking,
      onError: (message) => optionsRef.current.onError?.(message),
      onClose: () => {
        if (sessionRef.current !== active) return;
        sessionRef.current = null;
        setStatus("disconnected");
        setIsSpeaking(false);
        optionsRef.current.onDisconnect?.();
      },
    });
    sessionRef.current = active;
    try {
      await active.start();
    } catch (error) {
      active.stop();
      if (sessionRef.current === active) sessionRef.current = null;
      setStatus("disconnected");
      const message = error instanceof Error ? error.message : "Could not start Grok voice.";
      optionsRef.current.onError?.(message);
      throw error;
    }
  }, []);

  useEffect(() => () => {
    sessionRef.current?.stop();
    sessionRef.current = null;
  }, []);

  return { status, isSpeaking, startSession, endSession };
}

class GrokRealtimeSession {
  private socket: WebSocket | null = null;
  private captureContext: AudioContext | null = null;
  private playbackContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private stream: MediaStream | null = null;
  private sources: AudioBufferSourceNode[] = [];
  private nextPlayTime = 0;
  private greeted = false;
  private configured = false;
  private stopped = false;

  constructor(
    private readonly session: GrokVoiceSession,
    private readonly callbacks: SessionCallbacks,
  ) {}

  async start() {
    const [stream, playback] = await Promise.all([
      navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      }),
      createAudioContext(),
    ]);
    if (this.stopped) {
      stream.getTracks().forEach((track) => track.stop());
      await playback.close();
      return;
    }
    this.stream = stream;
    this.playbackContext = playback;
    this.captureContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    await this.captureContext.resume();
    const source = this.captureContext.createMediaStreamSource(stream);
    const processor = this.captureContext.createScriptProcessor(4096, 1, 1);
    const silence = this.captureContext.createGain();
    silence.gain.value = 0;
    processor.onaudioprocess = (event) => this.sendInput(event.inputBuffer.getChannelData(0));
    source.connect(processor);
    processor.connect(silence);
    silence.connect(this.captureContext.destination);
    this.processor = processor;

    await new Promise<void>((resolve, reject) => {
      let opened = false;
      const socket = new WebSocket(this.session.url, [`xai-client-secret.${this.session.token}`]);
      this.socket = socket;
      socket.onopen = () => {
        opened = true;
        socket.send(JSON.stringify({
          type: "session.update",
          session: {
            voice: this.session.voice,
            instructions: this.session.instructions,
            turn_detection: { type: "server_vad" },
            audio: {
              input: { format: { type: "audio/pcm", rate: SAMPLE_RATE } },
              output: { format: { type: "audio/pcm", rate: SAMPLE_RATE } },
            },
          },
        }));
        this.callbacks.onOpen();
        resolve();
      };
      socket.onmessage = (message) => this.handleMessage(String(message.data));
      socket.onerror = () => {
        if (opened) this.callbacks.onError("Grok voice connection failed.");
        else reject(new Error("Grok voice connection failed."));
      };
      socket.onclose = () => {
        if (this.stopped || !opened) return;
        this.callbacks.onClose();
      };
    });
  }

  stop() {
    this.stopped = true;
    this.stopPlayback();
    this.processor?.disconnect();
    this.processor = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.socket?.close();
    this.socket = null;
    void this.captureContext?.close();
    void this.playbackContext?.close();
    this.captureContext = null;
    this.playbackContext = null;
  }

  private sendInput(samples: Float32Array) {
    if (!this.configured || !this.socket || this.socket.readyState !== WebSocket.OPEN || !this.captureContext) return;
    const resampled = resample(samples, this.captureContext.sampleRate, SAMPLE_RATE);
    const pcm = floatToPcm16(resampled);
    this.socket.send(JSON.stringify({
      type: "input_audio_buffer.append",
      audio: bytesToBase64(new Uint8Array(pcm.buffer)),
    }));
  }

  private handleMessage(raw: string) {
    let event: { type?: string; delta?: string; error?: { message?: string }; message?: string };
    try {
      event = JSON.parse(raw) as typeof event;
    } catch {
      return;
    }
    if (event.type === "error") {
      this.callbacks.onError(event.error?.message ?? event.message ?? "Grok voice returned an error.");
      return;
    }
    if (event.type === "session.updated" && !this.greeted) {
      this.configured = true;
      this.greeted = true;
      this.socket?.send(JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{
            type: "input_text",
            text: "The listener just opened the notes. Greet them in one short sentence and invite a question.",
          }],
        },
      }));
      this.socket?.send(JSON.stringify({ type: "response.create" }));
      return;
    }
    if (event.type === "input_audio_buffer.speech_started") {
      this.stopPlayback();
      return;
    }
    if (event.type === "response.output_audio.delta" && event.delta) {
      this.enqueuePcm(event.delta);
    }
  }

  private enqueuePcm(base64Audio: string) {
    const playback = this.playbackContext;
    if (!playback) return;
    const pcm = base64ToPcm16(base64Audio);
    const samples = new Float32Array(pcm.length);
    for (let index = 0; index < pcm.length; index += 1) samples[index] = pcm[index] / 32768;
    const buffer = playback.createBuffer(1, samples.length, SAMPLE_RATE);
    buffer.copyToChannel(samples, 0);
    const source = playback.createBufferSource();
    source.buffer = buffer;
    source.connect(playback.destination);
    const startAt = Math.max(playback.currentTime + 0.02, this.nextPlayTime);
    source.start(startAt);
    this.nextPlayTime = startAt + buffer.duration;
    this.sources.push(source);
    this.callbacks.onSpeaking(true);
    source.onended = () => {
      this.sources = this.sources.filter((item) => item !== source);
      if (this.sources.length === 0) this.callbacks.onSpeaking(false);
    };
  }

  private stopPlayback() {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // The buffer may already have finished.
      }
    }
    this.sources = [];
    this.nextPlayTime = 0;
    this.callbacks.onSpeaking(false);
  }
}

function createAudioContext() {
  const context = new AudioContext({ sampleRate: SAMPLE_RATE });
  return context.resume().then(() => context);
}

function resample(input: Float32Array, fromRate: number, toRate: number) {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const length = Math.max(1, Math.floor(input.length / ratio));
  const output = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const fraction = position - left;
    const start = input[left] ?? 0;
    const end = input[left + 1] ?? start;
    output[index] = start + (end - start) * fraction;
  }
  return output;
}

function floatToPcm16(samples: Float32Array) {
  const pcm = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return pcm;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x2000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function base64ToPcm16(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
}
