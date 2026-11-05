const VIDEO_FILE = /\.(mp4|webm)(?:[?#]|$)/i;

export function isVideoFileUrl(url: string): boolean {
  return VIDEO_FILE.test(url);
}

/** Older posts stored some videos as <img>, which can only ever show a broken image. */
export function videoImagesToBlocks(html: string): string {
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = /\ssrc="([^"]+)"/i.exec(tag)?.[1];
    return src && isVideoFileUrl(src) ? `<div data-video-block="true" data-url="${src}"></div>` : tag;
  });
}
