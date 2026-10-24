/**
 * Dekodiert eine Aufnahme zu mono 16 kHz Float32 — das Eingabeformat der ASR.
 *
 * `decodeAudioData` resampelt auf die Rate des Kontexts; bei 20 Minuten Audio
 * sind das ~77 MB statt der ~460 MB, die eine Dekodierung bei 48 kHz kosten würde.
 */
export async function blobToMono16k(blob: Blob): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer();
  const context = new OfflineAudioContext(1, 1, 16_000);
  const decoded = await context.decodeAudioData(arrayBuffer);

  const channels = decoded.numberOfChannels;
  const length = decoded.length;
  const output = new Float32Array(length);

  for (let channel = 0; channel < channels; channel++) {
    const data = decoded.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      output[i] += data[i] / channels;
    }
  }

  return output;
}
