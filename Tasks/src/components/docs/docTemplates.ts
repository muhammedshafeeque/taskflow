/** Starter content offered when creating a page. Plain structure only, no company-specific wording. */
export interface DocTemplate {
  id: string;
  name: string;
  emoji: string;
  description: string;
  title: string;
  labels?: string[];
  content: string;
}

const today = () => new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export function docTemplates(): DocTemplate[] {
  return [
    {
      id: 'blank',
      name: 'Blank page',
      emoji: '',
      description: 'Start from an empty page.',
      title: 'Untitled',
      content: '',
    },
    {
      id: 'meeting',
      name: 'Meeting notes',
      emoji: '🗓️',
      description: 'Agenda, attendees, decisions and action items.',
      title: `Meeting notes – ${today()}`,
      labels: ['meeting-notes'],
      content: `<h2>Details</h2><table><tbody><tr><th>Date</th><td>${today()}</td></tr><tr><th>Attendees</th><td></td></tr><tr><th>Goal</th><td></td></tr></tbody></table><h2>Agenda</h2><ul><li><p></p></li></ul><h2>Discussion</h2><p></p><h2>Decisions</h2><ul><li><p></p></li></ul><h2>Action items</h2><ul><li><p>Owner – task – due date</p></li></ul>`,
    },
    {
      id: 'requirements',
      name: 'Product requirements',
      emoji: '📋',
      description: 'Problem, goals, user stories, scope and open questions.',
      title: 'Product requirements: ',
      labels: ['requirements'],
      content: `<table><tbody><tr><th>Status</th><td>Draft</td></tr><tr><th>Owner</th><td></td></tr><tr><th>Epic / issues</th><td>Type issue keys such as ABC-12 to link them</td></tr><tr><th>Target release</th><td></td></tr></tbody></table><h2>Problem</h2><p>What problem are we solving, and for whom?</p><h2>Goals</h2><ul><li><p></p></li></ul><h2>Non-goals</h2><ul><li><p></p></li></ul><h2>User stories</h2><table><tbody><tr><th>#</th><th>As a…</th><th>I want to…</th><th>So that…</th><th>Priority</th></tr><tr><td>1</td><td></td><td></td><td></td><td></td></tr></tbody></table><h2>Design</h2><p>Links to mock-ups or screenshots.</p><h2>Success metrics</h2><ul><li><p></p></li></ul><h2>Open questions</h2><table><tbody><tr><th>Question</th><th>Answer</th><th>Date</th></tr><tr><td></td><td></td><td></td></tr></tbody></table>`,
    },
    {
      id: 'tech-design',
      name: 'Technical design',
      emoji: '🛠️',
      description: 'Context, proposal, alternatives, risks and rollout.',
      title: 'Technical design: ',
      labels: ['design'],
      content: `<h2>Context</h2><p>Background and the current state of the system.</p><h2>Proposal</h2><p></p><h3>Data model</h3><p></p><h3>API</h3><pre><code>GET /example</code></pre><h2>Alternatives considered</h2><ul><li><p></p></li></ul><h2>Risks and mitigations</h2><table><tbody><tr><th>Risk</th><th>Impact</th><th>Mitigation</th></tr><tr><td></td><td></td><td></td></tr></tbody></table><h2>Rollout plan</h2><ol><li><p></p></li></ol><h2>Related issues</h2><p></p>`,
    },
    {
      id: 'decision',
      name: 'Decision record',
      emoji: '⚖️',
      description: 'Capture a decision, the options and why one was chosen.',
      title: 'Decision: ',
      labels: ['decision'],
      content: `<table><tbody><tr><th>Status</th><td>Proposed</td></tr><tr><th>Decider</th><td></td></tr><tr><th>Date</th><td>${today()}</td></tr></tbody></table><h2>Context</h2><p></p><h2>Options</h2><table><tbody><tr><th>Option</th><th>Pros</th><th>Cons</th></tr><tr><td>A</td><td></td><td></td></tr><tr><td>B</td><td></td><td></td></tr></tbody></table><h2>Decision</h2><p></p><h2>Consequences</h2><p></p>`,
    },
    {
      id: 'retro',
      name: 'Retrospective',
      emoji: '🔁',
      description: 'What went well, what to improve, and actions.',
      title: `Retrospective – ${today()}`,
      labels: ['retrospective'],
      content: `<p><strong>Sprint / period:</strong> </p><h2>What went well</h2><ul><li><p></p></li></ul><h2>What could be better</h2><ul><li><p></p></li></ul><h2>Ideas</h2><ul><li><p></p></li></ul><h2>Actions</h2><table><tbody><tr><th>Action</th><th>Owner</th><th>Due</th></tr><tr><td></td><td></td><td></td></tr></tbody></table>`,
    },
    {
      id: 'how-to',
      name: 'How-to guide',
      emoji: '📘',
      description: 'Step-by-step instructions for a task.',
      title: 'How to ',
      labels: ['how-to'],
      content: `<p>Use this guide to …</p><h2>Before you start</h2><ul><li><p></p></li></ul><h2>Steps</h2><ol><li><p></p></li><li><p></p></li><li><p></p></li></ol><blockquote><p>Tip: add screenshots by pasting them into the page.</p></blockquote><h2>Troubleshooting</h2><p></p><h2>Related pages</h2><p></p>`,
    },
    {
      id: 'release',
      name: 'Release notes',
      emoji: '🚀',
      description: 'New features, fixes and known issues for a release.',
      title: 'Release notes – ',
      labels: ['release-notes'],
      content: `<table><tbody><tr><th>Version</th><td></td></tr><tr><th>Release date</th><td>${today()}</td></tr></tbody></table><h2>Highlights</h2><p></p><h2>New features</h2><ul><li><p></p></li></ul><h2>Improvements</h2><ul><li><p></p></li></ul><h2>Bug fixes</h2><ul><li><p></p></li></ul><h2>Known issues</h2><ul><li><p></p></li></ul>`,
    },
    {
      id: 'runbook',
      name: 'Runbook',
      emoji: '🧯',
      description: 'Operational steps for a service or incident type.',
      title: 'Runbook: ',
      labels: ['runbook'],
      content: `<table><tbody><tr><th>Service</th><td></td></tr><tr><th>Owners</th><td></td></tr><tr><th>Dashboards</th><td></td></tr></tbody></table><h2>Symptoms</h2><ul><li><p></p></li></ul><h2>Diagnosis</h2><ol><li><p></p></li></ol><h2>Resolution</h2><ol><li><p></p></li></ol><h2>Escalation</h2><p></p>`,
    },
  ];
}
