import { GoogleGenAI, Modality, Type } from "@google/genai";
import { decodeBase64, decodeAudioData } from "./audioUtils";
import { GroundingChunk, LandmarkIdentification } from "../types";

let aiInstance: GoogleGenAI | null = null;

const getAI = () => {
  if (!aiInstance) {
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

// 1. Identify the landmark using gemini-2.5-flash (Faster Vision) with JSON Schema
export async function identifyLandmarkFromImage(base64Image: string, mimeType: string, language: string): Promise<LandmarkIdentification> {
  try {
    const response = await getAI().models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          {
            inlineData: {
              data: base64Image,
              mimeType: mimeType,
            },
          },
          {
            text: `Identify this landmark. Return a JSON object with the name of the landmark (including city/country), a confidence score between 0.0 and 1.0 (where 1.0 is absolute certainty), and a list of up to 3 alternative landmark names if there is any ambiguity. If confident, alternatives can be empty. Translate all names to ${language}.`,
          },
        ],
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            confidence: { type: Type.NUMBER, description: "A score between 0.0 and 1.0 indicating certainty" },
            alternatives: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ['name', 'confidence', 'alternatives']
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("Could not identify landmark");
    
    // Parse JSON response
    const data = JSON.parse(text) as LandmarkIdentification;
    return data;
  } catch (error) {
    console.error("Error identifying landmark:", error);
    throw error;
  }
}

// 2. Get detailed history using gemini-2.5-flash with Google Search (Search Grounding)
export async function getLandmarkDetails(landmarkName: string, language: string): Promise<{ text: string; sources: GroundingChunk[] }> {
  try {
    const response = await getAI().models.generateContent({
      model: "gemini-2.5-flash",
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
}

// 3. Generate speech using gemini-2.5-flash-preview-tts (TTS)
export async function generateNarrationAudio(text: string): Promise<AudioBuffer | null> {
  try {
    const response = await getAI().models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: text }] }],
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
    if (!base64Audio) return null;

    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    const audioBuffer = await decodeAudioData(
      decodeBase64(base64Audio),
      audioContext,
      24000,
      1
    );

    return audioBuffer;
  } catch (error) {
    console.error("Error generating audio:", error);
    return null;
  }
}