import { Input, BlobSource, ALL_FORMATS } from 'mediabunny';

export async function openInput(file: Blob): Promise<Input> {
  return new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(file),
  });
}

export function describeOpenError(err: unknown): string {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes('no suitable') || msg.includes('unsupported') || err.name === 'UnsupportedInputFormatError') {
      return 'BrowserFF could not recognize this container. The file may use an unsupported container or be malformed. Try MP4, WebM, MP3, WAV, or OGG.';
    }
    return `Could not open this file: ${err.message}`;
  }
  return 'Could not open this file because the container could not be parsed.';
}
