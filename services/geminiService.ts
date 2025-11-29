import { GoogleGenAI, Modality, Type } from "@google/genai";
import { decodeBase64, decodeAudioData } from "./audioUtils";
import { GroundingChunk, LandmarkIdentification, ChatMessage, NearbyPlace } from "../types";

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

// Singleton AudioContext for decoding to prevent "Max AudioContexts" error
let decodingContext: AudioContext | null = null;
const getDecodingContext = () => {
  if (!decodingContext) {
    decodingContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
  }
  return decodingContext;
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

    // Use shared context for decoding to avoid memory leaks/limits
    const audioContext = getDecodingContext();
    
    // Ensure context is running (sometimes browsers suspend it)
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

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

// 4. Chat with the guide
export async function getChatResponse(landmarkName: string, history: ChatMessage[], question: string, language: string): Promise<string> {
  try {
    // Construct context from previous messages
    const context = history.map(msg => `${msg.sender === 'user' ? 'User' : 'Guide'}: ${msg.text}`).join('\n');
    
    const prompt = `
      You are an expert tour guide at ${landmarkName}. 
      Context of conversation:
      ${context}
      
      User asks: ${question}
      
      Answer in ${language}. Keep it concise (under 50 words), friendly, and helpful. If asked about prices or opening hours, use your knowledge base or estimate based on typical values for such places.
    `;

    const response = await getAI().models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    return response.text || "I'm not sure about that, sorry.";
  } catch (error) {
    console.error("Chat error:", error);
    return "I'm having trouble connecting to the guide service right now.";
  }
}

// 5. Get nearby places with Google Search Grounding for accuracy
export async function getNearbyPlaces(landmarkName: string, language: string): Promise<NearbyPlace[]> {
  try {
    // Use Google Search tool to ensure real places are found
    const response = await getAI().models.generateContent({
      model: "gemini-2.5-flash",
      contents: `List 3 real and interesting tourist attractions near ${landmarkName}. 
      Return the response STRICTLY as a JSON array of objects. 
      Each object must have exactly two fields: "name" (string) and "description" (string). 
      The "description" must be extremely short, maximum 15 words.
      Translate the output to ${language}.`,
      config: {
        tools: [{ googleSearch: {} }],
        // responseMimeType cannot be used with tools in some SDK versions/models, so we parse manually
      }
    });

    const text = response.text || "[]";
    
    // Attempt to clean and find JSON array in the text (since search tool might add extra text)
    const jsonMatch = text.match(/\[.*\]/s);
    if (jsonMatch) {
      const places = JSON.parse(jsonMatch[0]) as NearbyPlace[];
      
      // Enforce short description client-side to be safe
      return places.map(p => ({
        name: p.name,
        description: p.description.split(' ').slice(0, 15).join(' ') + (p.description.split(' ').length > 15 ? '...' : '')
      }));
    }
    
    return [];
  } catch (error: any) {
    // If it's a quota error, silence it to avoid alarming console logs for non-critical features
    if (error.message?.includes("429") || error.status === 429) {
       console.warn("Nearby places skipped due to rate limit.");
    } else {
       console.error("Nearby error:", error);
    }
    return [];
  }
}
