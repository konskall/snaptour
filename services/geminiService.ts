import type { GoogleGenAI } from "@google/genai";
import { decodeBase64, decodeAudioData } from "./audioUtils";
import { GroundingChunk, LandmarkIdentification, ChatMessage, NearbyPlace } from "../types";

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

// Grounded calls (identify + details) run on gemini-2.5-flash, which HAS a free-tier
// Google Search grounding allowance (~1,500 RPD). gemini-3.1-flash-lite has NO free
// grounding quota, so grounded 3.1 calls return 429 immediately. If even the 2.5
// grounding quota is exhausted (429), retry the SAME request WITHOUT the googleSearch
// tool, so identification/details keep working (model knowledge / vision only, no live
// web sources) instead of hard-failing the scan.
const GROUNDED_MODEL = 'gemini-2.5-flash';

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
export async function identifyLandmarkFromImage(base64Image: string, mimeType: string, language: string): Promise<LandmarkIdentification> {
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
              Look for specific architectural details, signage, or unique characteristics to ensure accuracy.
              
              Return a STRICT JSON object (do not use Markdown code blocks) with the following structure:
              {
                "name": "Name of the landmark (City, Country)",
                "confidence": 0.0 to 1.0,
                "alternatives": ["Alternative Name 1", "Alternative Name 2"]
              }
              
              If the image is not a landmark, set confidence to 0.
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
        contents: `Tell me the history and 3 interesting hidden facts about ${landmarkName} in ${language}. Keep the tone engaging, like a passionate tour guide. Limit to 150 words.`,
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
  // Truncate text to 500 characters to avoid API Quota/Timeout limits on the preview model
  const safeText = text.length > 500 ? text.substring(0, 500) + "..." : text;

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
      You are an expert tour guide at ${landmarkName}.
      Context of conversation:
      ${context}

      User asks: ${question}

      Answer in ${language}. Keep it concise (under 50 words), friendly, and helpful. If asked about prices or opening hours, use your knowledge base or estimate based on typical values for such places.
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
export async function getNearbyPlaces(landmarkName: string, language: string): Promise<NearbyPlace[]> {
  try {
    const ai = await getAI();
    const { Type } = await loadSdk();
    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite",
      contents: `List 3 interesting places to visit near ${landmarkName}. Provide the name and a short description (under 10 words) for each in ${language}.`,
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
      return JSON.parse(response.text) as NearbyPlace[];
    }
    return [];
  } catch (error) {
    console.warn("Failed to get nearby places:", error);
    return [];
  }
}
