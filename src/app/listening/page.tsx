"use client";

import React, { useEffect, useRef, useState } from "react";
import { TopPageSelector } from "../../components/TopPageSelector";
import { addListeningEntry } from "../../lib/collectionExtras";

type RecognitionResult = {
  title: string;
  artist: string;
  album: string | null;
  releaseDate: string | null;
  confidence: number | null;
};

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read recorded audio"));
    reader.readAsDataURL(blob);
  });
}

export default function ListeningModePage() {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const autoStopRef = useRef<number | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recognized, setRecognized] = useState<RecognitionResult | null>(null);

  useEffect(() => {
    return () => {
      if (autoStopRef.current) {
        window.clearTimeout(autoStopRef.current);
      }

      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const stopRecording = () => {
    if (autoStopRef.current) {
      window.clearTimeout(autoStopRef.current);
      autoStopRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    setIsRecording(false);
  };

  const startListening = async () => {
    setError(null);
    setRecognized(null);
    setStatusMessage("Listening for 12 seconds...");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : undefined,
      });

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        if (!chunksRef.current.length) {
          setError("No audio captured. Try again with louder audio.");
          return;
        }

        setIsRecognizing(true);
        setStatusMessage("Recognizing song and album...");

        try {
          const mimeType = chunksRef.current[0]?.type || "audio/webm";
          const blob = new Blob(chunksRef.current, { type: mimeType });
          const audioBase64 = await blobToBase64(blob);

          const res = await fetch("/api/recognize-song", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audioBase64, mimeType }),
          });

          const data = (await res.json()) as RecognitionResult | { error?: string };

          if (!res.ok) {
            throw new Error("error" in data ? data.error || "Recognition failed" : "Recognition failed");
          }

          const match = data as RecognitionResult;
          setRecognized(match);

          const albumOrSong = match.album || match.title || "Unknown title";
          addListeningEntry({
            recordId: null,
            title: albumOrSong,
            artist: match.artist || "Unknown artist",
          });

          setStatusMessage(`Recognized and auto-logged: ${albumOrSong}.`);
        } catch (err: any) {
          setError(err?.message || "Could not recognize audio.");
          setStatusMessage(null);
        } finally {
          setIsRecognizing(false);
          chunksRef.current = [];
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);

      autoStopRef.current = window.setTimeout(() => {
        stopRecording();
      }, 12000);
    } catch (err: any) {
      setError(err?.message || "Microphone access failed.");
      setStatusMessage(null);
      setIsRecording(false);
    }
  };

  return (
    <main className="flex flex-col flex-1 page-shell fade-in">
      <div className="hero-card px-4 py-5 md:px-6 md:py-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-3 mb-3">
              <span className="h-10 w-[3px] bg-red-500 rounded" />
              <p className="text-xs md:text-sm uppercase tracking-[0.35em] subtle">Auto Detect</p>
            </div>
            <h1 className="hero-title">
              Listening <span className="hero-accent">Mode</span>
            </h1>
            <p className="text-sm subtle mt-2">
              Capture a short audio snippet, recognize what is playing, and auto-add the album to listening history.
            </p>
          </div>
          <TopPageSelector currentPage="listening" />
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            onClick={startListening}
            disabled={isRecording || isRecognizing}
            className="btn btn-primary"
          >
            {isRecording ? "Listening..." : "Start listening"}
          </button>
          <button
            onClick={stopRecording}
            disabled={!isRecording}
            className="btn btn-secondary"
          >
            Stop now
          </button>
        </div>

        <p className="text-xs subtle mt-3">Tip: Hold your device close to the speaker for a clean 10-12 second sample.</p>

        {statusMessage && <p className="text-sm text-green-300 mt-3">{statusMessage}</p>}
        {error && <p className="text-sm text-red-400 mt-3">{error}</p>}
      </div>

      <section className="mt-4 panel p-4">
        <h2 className="text-lg font-semibold">Latest recognition</h2>
        {!recognized ? (
          <p className="subtle mt-2 text-sm">No recognition yet in this session.</p>
        ) : (
          <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
            <p className="font-semibold">Album: {recognized.album || "Unknown"}</p>
            <p className="text-sm subtle mt-1">Song: {recognized.title || "Unknown"}</p>
            <p className="text-sm subtle">Artist: {recognized.artist || "Unknown"}</p>
            <p className="text-xs subtle mt-1">Released: {recognized.releaseDate || "Unknown"}</p>
            {recognized.confidence !== null && (
              <p className="text-xs subtle">Match score: {recognized.confidence}</p>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
