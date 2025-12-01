import { GoogleGenAI, Type } from "@google/genai";
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
    // Use a standard sample rate, though decodeAudioData usually handles resampling
    decodingContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
  }
  return decodingContext;
};

// Retry helper for 429 errors
async function retryOperation<T>(operation: () => Promise<T>, retries = 3, delay = 1000): Promise<T> {
  try {
    return await operation();
  } catch (error: any) {
    if (retries > 0 && (error.status === 429 || error.message?.includes('429') || error.message?.includes('quota'))) {
      console.warn(`Rate limit hit. Retrying in ${delay}ms... (${retries} retries left)`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return retryOperation(operation, retries - 1, delay * 2);
    }
    throw error;
  }
}

// 1. Identify the landmark using gemini-2.5-flash with Google Search Grounding for ACCURACY
export async function identifyLandmarkFromImage(base64Image: string, mimeType: string, language: string): Promise<LandmarkIdentification> {
  return retryOperation(async () => {
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
          // responseMimeType cannot be 'application/json' when using tools in some versions, so we parse manually
        }
      });

      const text = response.text;
      if (!text) throw new Error("Could not identify landmark");
      
      // Clean up the response to ensure we get valid JSON
      // Sometimes the model wraps JSON in ```json ... ``` or adds text before/after
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]) as LandmarkIdentification;
        return data;
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
  });
}

// 3. Generate speech using gemini-2.5-flash-preview-tts (TTS)
export async function generateNarrationAudio(text: string): Promise<AudioBuffer | null> {
  try {
    // We do NOT wrap this in retryOperation because audio failures are often due to payload size issues
    // or strict quota limits on the preview model, which retries won't fix immediately.
    
    const response = await getAI().models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: text }] }],
      config: {
        // Use string literal 'AUDIO' instead of Modality.AUDIO to avoid Vite bundling issues
        responseModalities: ['AUDIO'],
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

    // Use shared context for decoding to avoid memory leaks/limits
    const audioContext = getDecodingContext();
    
    // NOTE: We do NOT call audioContext.resume() here. 
    // Browsers block resume() if not triggered by a user gesture (click).
    // Calling it here would hang the promise indefinitely.
    // The AudioBuffer can be decoded even if the context is suspended.
    // The context will be resumed in TourCard.tsx when the user clicks "Play".

    const audioBuffer = await decodeAudioData(
      decodeBase64(base64Audio),
      audioContext,
      24000,
      1
    );

    return audioBuffer;
  } catch (error: any) {
    // Specifically handle the "SyntaxError: JSON Parse error" / "Error when deserializing response data"
    // which happens when the binary payload breaks the SDK's internal parser or backend fails.
    if (error.message && (
        error.message.includes("deserializing") || 
        error.message.includes("SyntaxError") || 
        error.message.includes("JSON Parse error") ||
        error.code === 500
    )) {
        console.warn("Audio generation failed due to SDK deserialization error (likely binary size). Skipping audio.");
        return null; // Return null gracefully so UI shows "Audio Unavailable" icon
    }

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