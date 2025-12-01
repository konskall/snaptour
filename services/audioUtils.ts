// Decodes base64 string to Uint8Array
export function decodeBase64(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Decodes PCM data into an AudioBuffer
export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number = 24000,
  numChannels: number = 1
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

// Concatenates multiple AudioBuffers into a single buffer
export function concatenateAudioBuffers(buffers: AudioBuffer[], ctx: AudioContext): AudioBuffer | null {
  if (!buffers || buffers.length === 0) return null;
  if (buffers.length === 1) return buffers[0];

  const totalLength = buffers.reduce((acc, b) => acc + b.length, 0);
  const result = ctx.createBuffer(
    buffers[0].numberOfChannels, 
    totalLength, 
    buffers[0].sampleRate
  );

  let offset = 0;
  for (const buff of buffers) {
    for (let channel = 0; channel < buff.numberOfChannels; channel++) {
      result.getChannelData(channel).set(buff.getChannelData(channel), offset);
    }
    offset += buff.length;
  }

  return result;
}
