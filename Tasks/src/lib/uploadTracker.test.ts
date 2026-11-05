import { cancelScope, cancelUpload, dismissUpload, isVisibleUpload, PROGRESS_MIN_BYTES, startUpload, useUploads } from './uploadTracker';
import { renderHook, act } from '@testing-library/react';

const file = (size: number, name = 'clip.mp4') => {
  const f = new File(['x'], name);
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

describe('uploadTracker', () => {
  afterEach(() => {
    const { result } = renderHook(() => useUploads());
    act(() => result.current.forEach((u) => dismissUpload(u.id)));
  });

  it('tracks progress and removes the upload when done', () => {
    const { result } = renderHook(() => useUploads());
    let upload!: ReturnType<typeof startUpload>;
    act(() => {
      upload = startUpload(file(5 * PROGRESS_MIN_BYTES));
    });
    act(() => upload.progress(0.5));
    expect(result.current[0]).toMatchObject({ fraction: 0.5, status: 'uploading' });
    act(() => upload.processing());
    expect(result.current[0]).toMatchObject({ fraction: 1, status: 'processing' });
    act(() => upload.done());
    expect(result.current).toEqual([]);
  });

  it('keeps scoped uploads out of the tray and drops them on failure', () => {
    const tray = renderHook(() => useUploads());
    const inline = renderHook(() => useUploads('comment'));
    let upload!: ReturnType<typeof startUpload>;
    act(() => {
      upload = startUpload(file(10), 'comment');
    });
    expect(tray.result.current).toEqual([]);
    expect(inline.result.current).toHaveLength(1);
    act(() => upload.fail('nope'));
    expect(inline.result.current).toEqual([]);
  });

  it('keeps tray failures visible, even for small files', () => {
    const { result } = renderHook(() => useUploads());
    let upload!: ReturnType<typeof startUpload>;
    act(() => {
      upload = startUpload(file(10));
    });
    expect(isVisibleUpload(result.current[0])).toBe(false);
    act(() => upload.fail('Too big'));
    expect(result.current[0]).toMatchObject({ status: 'error', error: 'Too big' });
    expect(isVisibleUpload(result.current[0])).toBe(true);
  });

  it('cancels by id and by scope', () => {
    let a!: ReturnType<typeof startUpload>;
    let b!: ReturnType<typeof startUpload>;
    let id = 0;
    const { result } = renderHook(() => useUploads());
    act(() => {
      a = startUpload(file(10));
      b = startUpload(file(10), 'comment');
    });
    id = result.current[0].id;
    cancelUpload(id);
    expect(a.signal.aborted).toBe(true);
    expect(b.signal.aborted).toBe(false);
    cancelScope('comment');
    expect(b.signal.aborted).toBe(true);
    act(() => {
      a.done();
      b.done();
    });
  });
});
