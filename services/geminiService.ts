import type { GoogleGenAI } from "@google/genai";
import { decodeBase64, decodeAudioData } from "./audioUtils";
import { GroundingChunk, LandmarkIdentification, ChatMessage, NearbyPlace, LandmarkMeta } from "../types";

// Lazily load the heavy @google/genai SDK so Vite code-splits it into its own
// chunk that is only fetched when the user first triggers an AI call, keeping
// the initial bundle small.
type GenAIModule = typeof import("@google/genai");
let sdkPromise: Promise<GenAIModule> | null = null;
const loadSdk = (): Promise<GenAIModule> => {
  if (!sdkPromise) sdkPromise = import("@google/genai");
  return sdkPromise;
};

let aiInstance: GoogleGenAI | null = null;

const getAI = async (): Promise<GoogleGenAI> => {
  if (!aiInstance) {
    const { GoogleGenAI } = await loadSdk();
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
      console.error("API Key is missing. Please check your .env file or GitHub Secrets.");
      // Initialize with empty string to allow UI to load, but calls will fail gracefully
      aiInstance = new GoogleGenAI({ apiKey: '' });
    } else {
      aiInstance = new GoogleGenAI({ apiKey: apiKey });
    }
  }
  return aiInstance;
};

// Retry helper for transient server errors (503 Service Unavailable / 500 /
// "overloaded"). We deliberately DO NOT retry 429 / quota errors: on the free
// tier those reset per-minute or per-day, so retrying within a few seconds just
// fails again and burns more of the already-limited quota. Fail fast instead and
// let the caller show the "wait a minute" message.
async function retryOperation<T>(operation: () => Promise<T>, retries = 3, delay = 1000): Promise<T> {
  try {
    return await operation();
  } catch (error: any) {
    const shouldRetry =
      error.status === 503 ||
      error.status === 500 ||
      error.message?.includes('503') ||
      error.message?.includes('500') ||
      error.message?.includes('overloaded');

    if (retries > 0 && shouldRetry) {
      console.warn(`API Error (${error.status || 'Unknown'}). Retrying in ${delay}ms... (${retries} retries left)`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return retryOperation(operation, retries - 1, delay * 2);
    }
    throw error;
  }
}

// Grounded calls (identify + details) run on gemini-2.5-flash-lite: it shares the 2.5
// family's free Google Search grounding (~1,500 RPD) AND has a far higher general daily
// request cap than gemini-2.5-flash (~20/day free), and is faster. gemini-3.1-flash-lite has NO free
// grounding quota, so grounded 3.1 calls return 429 immediately. If even the 2.5
// grounding quota is exhausted (429), retry the SAME request WITHOUT the googleSearch
// tool, so identification/details keep working (model knowledge / vision only, no live
// web sources) instead of hard-failing the scan.
const GROUNDED_MODEL = 'gemini-2.5-flash-lite';

async function generateContentWithGroundingFallback(ai: GoogleGenAI, params: any): Promise<any> {
  try {
    return await ai.models.generateContent(params);
  } catch (error: any) {
    const is429 =
      error?.status === 429 ||
      error?.message?.includes('429') ||
      error?.message?.includes('RESOURCE_EXHAUSTED');
    if (is429 && Array.isArray(params?.config?.tools)) {
      console.warn('Search grounding quota exhausted (429); retrying without grounding.');
      const configWithoutTools = { ...params.config };
      delete configWithoutTools.tools;
      return await ai.models.generateContent({ ...params, config: configWithoutTools });
    }
    throw error;
  }
}

// 1. Identify the landmark using gemini-2.5-flash with Google Search Grounding for ACCURACY
export async function identifyLandmarkFromImage(base64Image: string, mimeType: string, language: string, coords?: { lat: number; lng: number }): Promise<LandmarkIdentification> {
  return retryOperation(async () => {
    try {
      const ai = await getAI();
      const response = await generateContentWithGroundingFallback(ai, {
        model: GROUNDED_MODEL,
        contents: {
          parts: [
            {
              inlineData: {
                data: base64Image,
                mimeType: mimeType,
              },
            },
            {
              text: `Identify this landmark precisely using Google Search to verify visual features.
              ${coords ? `Context: the photo was taken near GPS coordinates ${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}. Use this ONLY to disambiguate between landmarks that genuinely match what is visible in the image. Do NOT name a place merely because it is near these coordinates: if the image itself does not clearly show a landmark / monument / notable place (e.g. an everyday object, a TV or screen, a person, food, a plain interior), it is "not a landmark" regardless of the location.` : ''}
              Look for specific architectural details, signage, or unique characteristics to ensure accuracy.
              
              Return a STRICT JSON object (do not use Markdown code blocks) with the following structure:
              {
                "name": "Name of the landmark (City, Country)",
                "confidence": 0.0 to 1.0,
                "alternatives": ["Alternative Name 1", "Alternative Name 2"]
              }
              
              If the image is NOT a recognizable landmark / monument / notable place, set "name" to an empty string "", "confidence" to 0, and "alternatives" to []. Otherwise put your single best guess in "name" and 2-4 distinct, plausible real alternatives in "alternatives" so the user can pick the right one from the photo.
              Translate the names to ${language}.`,
            },
          ],
        },
        config: {
          // We enable Google Search for higher accuracy
          tools: [{ googleSearch: {} }],
        }
      });

      const text = response.text;
      if (!text) throw new Error("Could not identify landmark");
      
      // Clean up the response to ensure we get valid JSON
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        // Normalize so callers never receive undefined fields (prevents render crash in LandmarkSelector).
        return {
          name: typeof data?.name === 'string' ? data.name : '',
          confidence: (typeof data?.confidence === 'number' && Number.isFinite(data.confidence)) ? data.confidence : 0,
          alternatives: Array.isArray(data?.alternatives) ? data.alternatives.filter((a: unknown) => typeof a === 'string') : [],
        };
      } else {
        throw new Error("Invalid response format from AI");
      }

    } catch (error) {
      console.error("Error identifying landmark:", error);
      throw error;
    }
  });
}

// 2. Get detailed history using gemini-2.5-flash with Google Search (Search Grounding)
export async function getLandmarkDetails(landmarkName: string, language: string): Promise<{ text: string; sources: GroundingChunk[] }> {
  return retryOperation(async () => {
    try {
      const ai = await getAI();
      const response = await generateContentWithGroundingFallback(ai, {
        model: GROUNDED_MODEL,
        contents: `Write a concise, factual overview of ${landmarkName} in ${language}: what it is, its key history, and 2-3 genuinely interesting facts, as one or two short flowing paragraphs.
Tone: natural, human and knowledgeable — informative but understated. NOT theatrical.
Do NOT address the reader (no "dear friends"), no greetings, no exclamations, no filler like "stand here before the grandeur" or "a timeless masterpiece". Start directly with the substance.
Plain text only: no markdown, no asterisks, no headings, no bullet or numbered lists.
Keep it tight: about 90-110 words.`,
        config: {
          tools: [{ googleSearch: {} }],
        },
      });

      const text = response.text || "No details available.";
      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks as GroundingChunk[] || [];

      return { text, sources: chunks };
    } catch (error) {
      console.error("Error fetching details:", error);
      throw error;
    }
  });
}

// 3. Generate speech using gemini-2.5-flash-preview-tts (TTS)
export async function generateNarrationAudio(text: string): Promise<AudioBuffer | null> {
  // Cap length as a safety net against runaway generations. The details text is now
  // concise (~90-110 words), so a 1500-char limit comfortably covers the WHOLE text
  // in every language — the audio no longer cuts off mid-way (the old 500 cap did).
  const safeText = text.length > 1500 ? text.substring(0, 1500) + "..." : text;

  // Wrap in retryOperation to handle instability in the preview model
  return retryOperation(async () => {
    try {
      const ai = await getAI();
      const { Modality } = await loadSdk();
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: safeText }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) {
          console.warn("No audio data returned from API");
          return null;
      }

      // Per-call OfflineAudioContext for decoding; avoids a never-closed realtime AudioContext leak.
      // decodeAudioData only calls createBuffer, which works on an OfflineAudioContext.
      const audioContext = new (window.OfflineAudioContext || (window as any).webkitOfflineAudioContext)(1, 1, 24000);

      const audioBuffer = await decodeAudioData(
        decodeBase64(base64Audio),
        // decodeAudioData only uses createBuffer (a BaseAudioContext member); OfflineAudioContext suffices.
        audioContext as unknown as AudioContext,
        24000,
        1
      );

      return audioBuffer;
    } catch (error: any) {
      // Specifically handle the "SyntaxError: JSON Parse error" which happens when the binary payload breaks the SDK
      if (error.message && (
          error.message.includes("deserializing") || 
          error.message.includes("SyntaxError") || 
          error.message.includes("JSON Parse error")
      )) {
          console.warn("Audio generation failed due to SDK deserialization error (likely binary size). Skipping audio.");
          return null;
      }
      
      // If we are getting a 500/503/429, we log it and retry, but if it ultimately fails, we return null
      // so the App can fallback to Native TTS
      console.warn("Audio generation warning:", error.message);
      throw error; 
    }
  }, 2, 1000); // Reduce retries to 2 to fail faster to native fallback
}

// 4. Chat with the guide
export async function getChatResponse(landmarkName: string, history: ChatMessage[], question: string, language: string): Promise<string> {
  // Construct context from previous messages
  const context = history.map(msg => `${msg.sender === 'user' ? 'User' : 'Guide'}: ${msg.text}`).join('\n');

  const prompt = `
      You are a knowledgeable local guide at ${landmarkName}. Answer the visitor's question directly and helpfully in ${language}.
      Tone: natural and human, like a real person talking — NOT theatrical. No flowery openings, no exclamations, no "dear friends" or "welcome, fellow adventurers". Get straight to the point.
      Keep it short (under 45 words). Plain text, no markdown. If asked about prices or opening hours, give a useful estimate based on typical values.

      Conversation so far:
      ${context}

      Visitor: ${question}
    `;

  // Let errors propagate; the caller (ChatView) shows a localized t.chatError.
  const ai = await getAI();
  const response = await ai.models.generateContent({
    model: "gemini-3.1-flash-lite",
    contents: prompt,
  });

  return response.text ?? '';
}

// 5. Get nearby places recommendations
// In-memory cache keyed by landmark+language: TourCard refetches on every mount
// (re-opening a saved item, deep link, after a chat round-trip), so without this the
// same Gemini call fires repeatedly and burns quota.
const nearbyCache = new Map<string, NearbyPlace[]>();

export async function getNearbyPlaces(landmarkName: string, language: string): Promise<NearbyPlace[]> {
  const cacheKey = `${landmarkName}|${language}`;
  const cached = nearbyCache.get(cacheKey);
  if (cached) return cached;
  try {
    const ai = await getAI();
    const { Type } = await loadSdk();
    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite",
      contents: `List 5 interesting places to visit near ${landmarkName}. Provide the name and a short description (under 10 words) for each in ${language}.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              description: { type: Type.STRING }
            },
            required: ["name", "description"]
          }
        }
      }
    });

    if (response.text) {
      const places = JSON.parse(response.text) as NearbyPlace[];
      nearbyCache.set(cacheKey, places);
      return places;
    }
    return [];
  } catch (error) {
    console.warn("Failed to get nearby places:", error);
    return [];
  }
}

// 6. Structured "useful info" about a landmark — powers the Useful Info card AND the
// metadata behind the visited map (coordinates), passport stamps and history filters
// (country / category). Runs on gemini-3.1-flash-lite with a JSON response schema (no
// grounding, so it uses a separate quota bucket from the grounded scan calls). Returns
// null on any failure so the scan never breaks because of it.
export async function getLandmarkInfo(landmarkName: string, language: string): Promise<LandmarkMeta | null> {
  try {
    const ai = await getAI();
    const { Type } = await loadSdk();
    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite",
      contents: `Provide structured facts about the landmark "${landmarkName}".
Return values in ${language} EXCEPT countryCode and website.
- country: country name (in ${language}).
- countryCode: ISO 3166-1 alpha-2 code, lowercase (e.g. "fr", "gr", "us"). "" if unknown.
- city: city/area (in ${language}).
- category: a short type label in ${language} (e.g. Monument, Museum, Religious site, Park/Nature, Square, Castle, Bridge, Archaeological site). "" if unknown.
- lat / lng: the landmark's approximate decimal coordinates. Use 0 only if genuinely unknown.
- openingHours: typical visiting hours in one short phrase (in ${language}), or "Open 24h" / "" if not applicable or unknown.
- ticket: typical entry cost in one short phrase (in ${language}), e.g. an approximate price or "Free". "" if unknown.
- bestTime: best time of day or season to visit, one short phrase (in ${language}). "" if not applicable.
- website: the official website URL, or "" if you are not confident it is correct. Do NOT invent URLs.
Be accurate. Leave a field empty ("") rather than guessing.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            country: { type: Type.STRING },
            countryCode: { type: Type.STRING },
            city: { type: Type.STRING },
            category: { type: Type.STRING },
            lat: { type: Type.NUMBER },
            lng: { type: Type.NUMBER },
            openingHours: { type: Type.STRING },
            ticket: { type: Type.STRING },
            bestTime: { type: Type.STRING },
            website: { type: Type.STRING },
          },
          required: ["country", "countryCode", "city", "category", "lat", "lng", "openingHours", "ticket", "bestTime", "website"],
        },
      },
    });

    if (!response.text) return null;
    const raw = JSON.parse(response.text);
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    // Treat 0/0 and out-of-range numbers as "unknown" (model's null sentinel).
    const coord = (v: unknown, max: number): number | null => {
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(n) || n === 0 || Math.abs(n) > max) return null;
      return n;
    };
    let website = str(raw?.website);
    if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;
    return {
      country: str(raw?.country),
      countryCode: str(raw?.countryCode).toLowerCase().slice(0, 2),
      city: str(raw?.city),
      category: str(raw?.category),
      lat: coord(raw?.lat, 90),
      lng: coord(raw?.lng, 180),
      openingHours: str(raw?.openingHours),
      ticket: str(raw?.ticket),
      bestTime: str(raw?.bestTime),
      website,
    };
  } catch (error) {
    console.warn("Failed to get landmark info:", error);
    return null;
  }
}

// 7. "Near me now": famous landmarks around the user's current location, WITHOUT a photo.
// Reuses the same details/chat pipeline once the user picks one. Non-grounded JSON call.
export async function getNearbyLandmarks(coords: { lat: number; lng: number }, language: string): Promise<NearbyPlace[]> {
  try {
    const ai = await getAI();
    const { Type } = await loadSdk();
    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite",
      contents: `List 6 famous, recognizable landmarks or notable attractions a tourist would want to visit near GPS coordinates ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}.
Order them by how close and how famous they are (closest/most iconic first).
For each provide:
- name: the landmark name including its city (in ${language}).
- description: what it is, under 12 words (in ${language}).
Only include real, well-known places that genuinely exist near these coordinates.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              description: { type: Type.STRING },
            },
            required: ["name", "description"],
          },
        },
      },
    });

    if (response.text) {
      const list = JSON.parse(response.text);
      if (Array.isArray(list)) {
        return list
          .filter((p) => p && typeof p.name === 'string' && p.name.trim())
          .map((p) => ({ name: String(p.name).trim(), description: String(p.description ?? '').trim() }));
      }
    }
    return [];
  } catch (error) {
    console.warn("Failed to get nearby landmarks:", error);
    return [];
  }
}
