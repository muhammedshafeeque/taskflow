const atriumUrl =
  (import.meta.env.VITE_ATRIUM_URL as string | undefined)?.trim() ||
  'http://localhost:5173'

export function AtriumPage() {
  return (
    <div className="page atrium-page">
      <header className="page-head atrium-head">
        <div>
          <h1>Atrium</h1>
          <p className="muted">
            Full Taskflow workspace — sign in inside the frame if needed
          </p>
        </div>
        <a
          className="button-link"
          href={atriumUrl}
          target="_blank"
          rel="noreferrer"
        >
          Open in new tab
        </a>
      </header>
      <div className="atrium-frame-wrap">
        <iframe
          title="Atrium"
          src={atriumUrl}
          className="atrium-frame"
          allow="clipboard-read; clipboard-write"
        />
      </div>
    </div>
  )
}
