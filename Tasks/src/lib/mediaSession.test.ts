import { act, renderHook } from '@testing-library/react';
import { closeMediaSession, openMediaSession, useMediaSessionReady } from './mediaSession';
import { mediaSessionApi } from './api';

jest.mock('./api', () => ({
  mediaSessionApi: { open: jest.fn(), close: jest.fn() },
}));

const open = mediaSessionApi.open as jest.Mock;
const close = mediaSessionApi.close as jest.Mock;

describe('mediaSession', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    close.mockResolvedValue(undefined);
  });
  afterEach(() => act(() => closeMediaSession()));

  it('holds media back until the session request has settled', async () => {
    let finish!: () => void;
    open.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    const { result } = renderHook(() => useMediaSessionReady());
    let opening!: Promise<void>;
    act(() => {
      opening = openMediaSession('t');
    });
    expect(result.current).toBe(false);
    await act(async () => {
      finish();
      await opening;
    });
    expect(result.current).toBe(true);
  });

  it('still releases media when the request fails', async () => {
    open.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useMediaSessionReady());
    await act(() => openMediaSession('t'));
    expect(result.current).toBe(true);
  });

  it('holds media back again after sign-out', async () => {
    open.mockResolvedValue(undefined);
    const { result } = renderHook(() => useMediaSessionReady());
    await act(() => openMediaSession('t'));
    act(() => closeMediaSession());
    expect(result.current).toBe(false);
    expect(close).toHaveBeenCalled();
  });
});
