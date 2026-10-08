export function videoUrls(source: string): { playback: string; poster?: string } {
  // External media keeps its own transport and poster rules.
  const match = /^(\/api\/uploads\/videos\/[A-Za-z0-9_-]{8,64}\.(?:mp4|webm|mov))(?:[?#].*)?$/i.exec(source);
  return match ? { playback: `${match[1]}/playback`, poster: `${match[1]}/poster` } : { playback: source };
}
