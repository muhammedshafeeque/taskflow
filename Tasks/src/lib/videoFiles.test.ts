import { isVideoFileUrl, videoImagesToBlocks } from './videoFiles';

describe('isVideoFileUrl', () => {
  it.each([
    ['/api/uploads/a.mp4', true],
    ['/api/uploads/a.WEBM', true],
    ['https://x.test/a.mp4?v=1', true],
    ['/api/uploads/a.png', false],
    ['/api/uploads/mp4', false],
    ['/api/uploads/a.mp4.png', false],
  ])('%s -> %s', (url, expected) => {
    expect(isVideoFileUrl(url)).toBe(expected);
  });
});

describe('videoImagesToBlocks', () => {
  it('turns a video stored as an image into a video block', () => {
    const html = '<img class="max-w-full" src="/api/uploads/a.mp4" alt="a.mp4">';
    expect(videoImagesToBlocks(html)).toBe('<div data-video-block="true" data-url="/api/uploads/a.mp4"></div>');
  });

  it('leaves real images and surrounding text alone', () => {
    const html = '<p>hi</p><img src="/api/uploads/a.png" alt="clip.mp4">';
    expect(videoImagesToBlocks(html)).toBe(html);
  });

  it('ignores other attributes that merely end in src', () => {
    const html = '<img data-src="/a.mp4" src="/a.png">';
    expect(videoImagesToBlocks(html)).toBe(html);
  });
});
