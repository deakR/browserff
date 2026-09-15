export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function outputFilename(inputName: string, container: 'mp4' | 'webm', suffix: string): string {
  const base = inputName.replace(/\.[^.]+$/, '') || 'output';
  return `${base}-${suffix}.${container}`;
}
