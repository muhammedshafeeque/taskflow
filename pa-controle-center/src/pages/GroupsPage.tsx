import { useEffect, useState } from 'react'
import {
  type AtriumProject,
  type WhatsappGroupRow,
  paAdmin,
} from '../api/paAdmin'

type Draft = {
  selectedIds: string[]
}

function projectsFromRow(row: WhatsappGroupRow): Array<{
  id: string
  name: string
  key?: string
}> {
  return Array.isArray(row.atriumProjects) ? row.atriumProjects : []
}

function idsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((id) => set.has(id))
}

export function GroupsPage() {
  const [rows, setRows] = useState<WhatsappGroupRow[]>([])
  const [projects, setProjects] = useState<AtriumProject[]>([])
  const [projectsHint, setProjectsHint] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busyId, setBusyId] = useState('')
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})

  async function load() {
    setError('')
    setSuccess('')
    try {
      const [groups, atrium] = await Promise.all([
        paAdmin.listGroups(),
        paAdmin.listAtriumProjects(),
      ])
      setRows(groups)
      setProjects(atrium.projects || [])
      setProjectsHint(
        atrium.available && (atrium.projects || []).length > 0
          ? ''
          : atrium.reason ||
              (atrium.available
                ? 'No Taskflow projects returned for this org'
                : 'Could not load Taskflow projects')
      )
      setDrafts(() => {
        const next: Record<string, Draft> = {}
        for (const g of groups) {
          next[g.chatId] = {
            selectedIds: projectsFromRow(g).map((p) => p.id),
          }
        }
        return next
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load groups')
    }
  }

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    if (!success) return
    const t = window.setTimeout(() => setSuccess(''), 4000)
    return () => window.clearTimeout(t)
  }, [success])

  function applyGroupUpdate(updated: WhatsappGroupRow) {
    const atriumProjects = projectsFromRow(updated)
    setRows((prev) =>
      prev.map((r) => (r.chatId === updated.chatId ? { ...r, ...updated } : r))
    )
    setDrafts((d) => ({
      ...d,
      [updated.chatId]: {
        selectedIds: atriumProjects.map((p) => p.id),
      },
    }))
  }

  async function toggleAutoReply(row: WhatsappGroupRow) {
    setBusyId(row.chatId)
    setError('')
    setSuccess('')
    try {
      const updated = await paAdmin.patchGroup(row.chatId, {
        autoReplyEnabled: !row.autoReplyEnabled,
        name: row.name,
      })
      applyGroupUpdate({
        ...row,
        ...updated,
        atriumProjects:
          updated.atriumProjects ?? projectsFromRow(row),
        autoReplyEnabled:
          typeof updated.autoReplyEnabled === 'boolean'
            ? updated.autoReplyEnabled
            : !row.autoReplyEnabled,
      })
      setSuccess(
        `${row.name}: auto-reply ${
          !row.autoReplyEnabled ? 'enabled' : 'disabled'
        }`
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setBusyId('')
    }
  }

  async function saveProject(row: WhatsappGroupRow) {
    setBusyId(row.chatId)
    setError('')
    setSuccess('')
    try {
      if (!projects.length) {
        setError('Taskflow projects are not loaded — cannot save assignment')
        return
      }
      const draft = drafts[row.chatId] || { selectedIds: [] }
      const atriumProjects = draft.selectedIds
        .map((id) => {
          const fromCatalog = projects.find((p) => p.id === id)
          if (fromCatalog) {
            return {
              id: fromCatalog.id,
              name: fromCatalog.name,
              ...(fromCatalog.key ? { key: fromCatalog.key } : {}),
            }
          }
          const fromSaved = projectsFromRow(row).find((p) => p.id === id)
          if (fromSaved) {
            return {
              id: fromSaved.id,
              name: fromSaved.name,
              ...(fromSaved.key ? { key: fromSaved.key } : {}),
            }
          }
          return null
        })
        .filter((p): p is { id: string; name: string; key?: string } =>
          Boolean(p)
        )

      const updated = await paAdmin.patchGroup(row.chatId, {
        name: row.name,
        atriumProjects,
      })

      const persisted = projectsFromRow(updated).length
        ? projectsFromRow(updated)
        : atriumProjects

      applyGroupUpdate({
        ...row,
        ...updated,
        atriumProjects: persisted,
      })

      setSuccess(
        persisted.length
          ? `${row.name}: saved ${persisted.map((p) => p.name).join(', ')}`
          : `${row.name}: cleared project assignments`
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusyId('')
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Groups</h1>
          <p className="muted">
            Assign Atrium projects and enable auto-reply to make a group the
            official project support channel — every message is processed by the
            Support Engineer (no @mention required). Groups without projects
            still require @mention when mention-only is on.
          </p>
        </div>
        <button type="button" onClick={() => void load()}>
          Refresh
        </button>
      </header>

      {projectsHint ? <p className="error">{projectsHint}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {success ? <p className="ok banner-ok">{success}</p> : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Group</th>
              <th>Auto-reply</th>
              <th>Atrium projects</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted">
                  No WhatsApp groups found. Make sure the PA WhatsApp client is
                  ready and the bot account is in the groups.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const draft = drafts[row.chatId] || { selectedIds: [] }
                const busy = busyId === row.chatId
                const saved = projectsFromRow(row)
                const savedIds = saved.map((p) => p.id)
                const dirty = !idsEqual(draft.selectedIds, savedIds)
                return (
                  <tr key={row.chatId}>
                    <td>
                      <strong>{row.name}</strong>
                      <div className="muted tiny">{row.chatId}</div>
                      {row.participantEstimate != null ? (
                        <div className="muted tiny">
                          ~{row.participantEstimate} members
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <button
                        type="button"
                        className={row.autoReplyEnabled ? '' : 'ghost'}
                        disabled={busy}
                        onClick={() => void toggleAutoReply(row)}
                      >
                        {row.autoReplyEnabled ? 'Enabled' : 'Disabled'}
                      </button>
                      <div className="muted tiny">
                        {saved.length
                          ? 'Official support group — all messages'
                          : '@mention only (no projects)'}
                      </div>
                    </td>
                    <td className="group-project-cell">
                      {projects.length === 0 ? (
                        <div className="muted tiny">No projects available</div>
                      ) : (
                        <div
                          className="project-checklist"
                          role="group"
                          aria-label={`Atrium projects for ${row.name}`}
                        >
                          {projects.map((p) => {
                            const checked = draft.selectedIds.includes(p.id)
                            return (
                              <label
                                key={p.id}
                                className={
                                  checked
                                    ? 'project-check-item is-selected'
                                    : 'project-check-item'
                                }
                              >
                                <input
                                  type="checkbox"
                                  disabled={busy}
                                  checked={checked}
                                  onChange={() => {
                                    setDrafts((d) => {
                                      const cur =
                                        d[row.chatId]?.selectedIds || []
                                      const selectedIds = checked
                                        ? cur.filter((id) => id !== p.id)
                                        : [...cur, p.id]
                                      return {
                                        ...d,
                                        [row.chatId]: { selectedIds },
                                      }
                                    })
                                    setSuccess('')
                                  }}
                                />
                                <span>
                                  {p.name}
                                  {p.key ? (
                                    <span className="muted"> [{p.key}]</span>
                                  ) : null}
                                </span>
                              </label>
                            )
                          })}
                        </div>
                      )}
                      {saved.length ? (
                        <div className="ok tiny">
                          Saved: {saved.map((p) => p.name).join(', ')}
                        </div>
                      ) : (
                        <div className="muted tiny">No projects assigned</div>
                      )}
                      {dirty ? (
                        <div className="warn tiny">Unsaved changes</div>
                      ) : null}
                    </td>
                    <td>
                      <button
                        type="button"
                        className={dirty ? '' : 'ghost'}
                        disabled={busy || projects.length === 0 || !dirty}
                        onClick={() => void saveProject(row)}
                      >
                        {busy ? 'Saving…' : dirty ? 'Save' : 'Saved'}
                      </button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
