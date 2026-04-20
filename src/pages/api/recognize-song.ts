import type { NextApiRequest, NextApiResponse } from "next";

type RecognitionResponse = {
  title: string;
  artist: string;
  album: string | null;
  releaseDate: string | null;
  confidence: number | null;
};

function parseBase64Payload(value: string) {
  if (value.includes(",")) {
    return value.split(",")[1] || "";
  }
  return value;
}

function normalizeString(value: unknown) {
  return String(value || "").trim();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auddToken = process.env.AUDD_API_TOKEN;
  if (!auddToken) {
    return res.status(500).json({
      error: "Listening Mode is not configured. Set AUDD_API_TOKEN in your environment.",
    });
  }

  const { audioBase64, mimeType } = req.body || {};
  const base64Raw = normalizeString(audioBase64);

  if (!base64Raw) {
    return res.status(400).json({ error: "Missing audioBase64 payload" });
  }

  try {
    const base64 = parseBase64Payload(base64Raw);
    const audioBuffer = Buffer.from(base64, "base64");

    if (!audioBuffer.length) {
      return res.status(400).json({ error: "Invalid or empty audio payload" });
    }

    if (audioBuffer.length > 5 * 1024 * 1024) {
      return res.status(400).json({ error: "Audio payload too large. Keep clips under 5MB." });
    }

    const form = new FormData();
    form.append("api_token", auddToken);
    form.append("return", "apple_music,spotify");
    form.append(
      "file",
      new Blob([audioBuffer], { type: normalizeString(mimeType) || "audio/webm" }),
      "listening-mode-sample.webm"
    );

    const auddRes = await fetch("https://api.audd.io/", {
      method: "POST",
      body: form,
    });

    if (!auddRes.ok) {
      const details = (await auddRes.text()).slice(0, 300);
      return res.status(auddRes.status).json({ error: "Song recognition provider failed", details });
    }

    const payload = await auddRes.json();
    const result = payload?.result;

    if (!result) {
      return res.status(404).json({ error: "No match found. Try recording a clearer snippet." });
    }

    const response: RecognitionResponse = {
      title: normalizeString(result.title),
      artist: normalizeString(result.artist),
      album: normalizeString(result.album) || null,
      releaseDate: normalizeString(result.release_date) || null,
      confidence: typeof result.score === "number" ? result.score : null,
    };

    return res.status(200).json(response);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Unexpected recognition error" });
  }
}
