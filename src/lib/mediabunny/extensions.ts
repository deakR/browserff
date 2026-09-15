import type { CodecExtensionInfo } from '../../types';

export const EXTENSIONS: Array<Omit<CodecExtensionInfo, 'state' | 'error'>> = [
  { id: 'ac3', label: 'AC-3 / E-AC-3 decoder + encoder', pkg: '@mediabunny/ac3', sizeMB: 5.4, codecs: ['ac3', 'eac3'], kind: 'both' },
  { id: 'dts', label: 'DTS decoder + encoder', pkg: '@mediabunny/dts', sizeMB: 7.6, codecs: ['dts'], kind: 'both' },
  { id: 'aac-encoder', label: 'AAC-LC encoder', pkg: '@mediabunny/aac-encoder', sizeMB: 4.7, codecs: ['aac'], kind: 'encoder' },
  { id: 'mp3-encoder', label: 'MP3 encoder (LAME)', pkg: '@mediabunny/mp3-encoder', sizeMB: 1.7, codecs: ['mp3'], kind: 'encoder' },
  { id: 'flac-encoder', label: 'FLAC encoder (libFLAC)', pkg: '@mediabunny/flac-encoder', sizeMB: 1.6, codecs: ['flac'], kind: 'encoder' },
  { id: 'prores', label: 'ProRes decoder (TurboRes)', pkg: '@mediabunny/prores', sizeMB: 1.1, codecs: ['prores'], kind: 'decoder' },
];

/** Lazy-load a codec extension. Separate bundle chunk; never in the initial page. */
export async function loadExtension(id: string): Promise<void> {
  switch (id) {
    case 'ac3': {
      const m = await import('@mediabunny/ac3');
      m.registerAc3Decoder();
      m.registerAc3Encoder();
      return;
    }
    case 'dts': {
      const m = await import('@mediabunny/dts');
      m.registerDtsDecoder();
      m.registerDtsEncoder();
      return;
    }
    case 'aac-encoder': {
      const m = await import('@mediabunny/aac-encoder');
      m.registerAacEncoder();
      return;
    }
    case 'mp3-encoder': {
      const m = await import('@mediabunny/mp3-encoder');
      m.registerMp3Encoder();
      return;
    }
    case 'flac-encoder': {
      const m = await import('@mediabunny/flac-encoder');
      m.registerFlacEncoder();
      return;
    }
    case 'prores': {
      const m = await import('@mediabunny/prores');
      m.registerProresDecoder();
      return;
    }
    default:
      throw new Error(`Unknown extension: ${id}`);
  }
}
