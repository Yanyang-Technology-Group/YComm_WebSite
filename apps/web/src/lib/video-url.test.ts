import { describe, expect, it } from 'vitest';
import { videoUrls } from './video-url';

describe('uploaded video playback URLs', () => {
  it('gives local videos a fresh stream URL and server cover', () => {
    expect(videoUrls('/api/uploads/videos/abcdefgh.mp4?old=1')).toEqual({
      playback: '/api/uploads/videos/abcdefgh.mp4/playback', poster: '/api/uploads/videos/abcdefgh.mp4/poster',
    });
  });
  it('leaves third-party media and signed query strings intact', () => {
    const source = 'https://video.example/movie.mp4?token=private';
    expect(videoUrls(source)).toEqual({ playback: source });
  });
});
