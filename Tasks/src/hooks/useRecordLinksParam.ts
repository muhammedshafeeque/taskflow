import { useSearchParams } from 'react-router-dom';

/** Which record's links drawer is open, kept in `?<param>=<id>` — the URL the record graph links to. */
export function useRecordLinksParam(param: string): [string | null, (id: string | null) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const id = searchParams.get(param);
  const set = (next: string | null) =>
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (next) p.set(param, next);
        else p.delete(param);
        return p;
      },
      { replace: true }
    );
  return [id, set];
}
