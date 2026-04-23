import nodemailer from 'nodemailer';
import { env } from '../config/env';

// ── SMTP transport ────────────────────────────────────────────────────────────

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (transporter) return transporter;
  if (!env.smtpHost || !env.smtpPort) {
    console.warn('[email] SMTP not configured (SMTP_HOST, SMTP_PORT). Emails will not be sent.');
    return null;
  }
  transporter = nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpPort === 465,
    auth: env.smtpUser && env.smtpPass ? { user: env.smtpUser, pass: env.smtpPass } : undefined,
  });
  return transporter;
}

async function sendViaSMTP(to: string, subject: string, html: string): Promise<void> {
  const transport = getTransporter();
  if (!transport) return;
  await transport.sendMail({ from: env.mailFrom, to, subject, html });
}

// ── Azure Graph API transport ─────────────────────────────────────────────────

interface GraphTokenCache {
  accessToken: string;
  expiresAt: number; // ms
}

let graphTokenCache: GraphTokenCache | null = null;

async function getGraphAccessToken(): Promise<string> {
  const now = Date.now();
  if (graphTokenCache && graphTokenCache.expiresAt > now + 60_000) {
    return graphTokenCache.accessToken;
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: env.azureGraphClientId,
    client_secret: env.azureGraphClientSecret,
    scope: 'https://graph.microsoft.com/.default',
  });

  const response = await fetch(env.azureGraphTokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`[email] Graph token fetch failed [${response.status}]: ${errorText}`);
  }

  const data = await response.json() as { access_token: string; expires_in: number };
  graphTokenCache = { accessToken: data.access_token, expiresAt: now + data.expires_in * 1000 };
  return graphTokenCache.accessToken;
}

async function sendViaGraph(to: string, subject: string, html: string): Promise<void> {
  const accessToken = await getGraphAccessToken();
  console.log('accessToken', accessToken);
  const fromEmail = env.azureGraphFromEmail;

  const payload = {
    message: {
      subject,
      body: { contentType: 'HTML', content: html },
      toRecipients: [{ emailAddress: { address: to } }],
    },
    saveToSentItems: false,
  };

  const response = await fetch(
    `https://graph.microsoft.com/v1.0/users/${fromEmail}/sendMail`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  );

  // Graph returns 202 Accepted on success
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`[email] Graph sendMail failed [${response.status}]: ${errorText}`);
  }
}

// ── Unified dispatcher ────────────────────────────────────────────────────────

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  console.log('sendEmail', to, subject, html);
  const { isSmtpEnabled, isAzureGraphEnabled } = env;

  if (isSmtpEnabled && isAzureGraphEnabled) {
    console.warn('[email] Both IS_SMTP_ENABLED and IS_AZURE_GRAPH_ENABLED are true — SMTP takes precedence.');
  }

  if (!isSmtpEnabled && !isAzureGraphEnabled) {
    console.warn('[email] No transport enabled (IS_SMTP_ENABLED, IS_AZURE_GRAPH_ENABLED). Email skipped.');
    return;
  }

  if (isSmtpEnabled) return sendViaSMTP(to, subject, html);
  return sendViaGraph(to, subject, html);
}

export interface InviteEmailParams {
  name: string;
  email: string;
  password: string;
  appUrl: string;
}

export function renderInviteEmail(params: InviteEmailParams): string {
  const { name, email, password, appUrl } = params;
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Your TaskFlow account</title></head>
<body style="font-family: system-ui, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #4f46e5;">Welcome to TaskFlow</h2>
  <p>Hi ${escapeHtml(name)},</p>
  <p>Your TaskFlow account has been created. Use the credentials below to sign in:</p>
  <p><strong>Email:</strong> ${escapeHtml(email)}<br><strong>Password:</strong> <code style="background: #f1f5f9; padding: 2px 6px; border-radius: 4px;">${escapeHtml(password)}</code></p>
  <p>Please change your password after your first login (from your profile or Forgot password).</p>
  <p><a href="${escapeHtml(appUrl)}/login" style="color: #4f46e5;">Sign in to TaskFlow</a></p>
  <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
  <p style="font-size: 12px; color: #64748b;">This is an automated message. Do not reply.</p>
</body>
</html>
  `.trim();
}

export interface ForgotPasswordEmailParams {
  name: string;
  appUrl: string;
  resetLink: string;
}

export function renderForgotPasswordEmail(params: ForgotPasswordEmailParams): string {
  const { name, resetLink } = params;
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Reset your password</title></head>
<body style="font-family: system-ui, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #4f46e5;">Reset your TaskFlow password</h2>
  <p>Hi ${escapeHtml(name)},</p>
  <p>You requested a password reset. Click the link below to set a new password:</p>
  <p><a href="${escapeHtml(resetLink)}" style="color: #4f46e5;">Reset password</a></p>
  <p>If you didn't request this, you can ignore this email.</p>
  <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
  <p style="font-size: 12px; color: #64748b;">This link will expire in 1 hour.</p>
</body>
</html>
  `.trim();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function sendInviteEmail(params: InviteEmailParams): Promise<void> {
  await sendEmail(params.email, 'Your TaskFlow account', renderInviteEmail(params));
}

export async function sendForgotPasswordEmail(to: string, params: ForgotPasswordEmailParams): Promise<void> {
  await sendEmail(to, 'Reset your TaskFlow password', renderForgotPasswordEmail(params));
}

export interface ProjectInviteEmailParams {
  projectName: string;
  inviterName: string;
  appUrl: string;
}

export function renderProjectInviteEmail(params: ProjectInviteEmailParams): string {
  const { projectName, inviterName, appUrl } = params;
  const inboxUrl = `${appUrl}/inbox`;
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Project invitation</title></head>
<body style="font-family: system-ui, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #4f46e5;">Project invitation</h2>
  <p>You've been invited to the project <strong>${escapeHtml(projectName)}</strong> by ${escapeHtml(inviterName)}.</p>
  <p>Open your inbox in TaskFlow to accept or decline the invitation.</p>
  <p><a href="${escapeHtml(inboxUrl)}" style="color: #4f46e5;">Open inbox</a></p>
  <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
  <p style="font-size: 12px; color: #64748b;">This is an automated message. Do not reply.</p>
</body>
</html>
  `.trim();
}

export async function sendProjectInviteEmail(to: string, params: ProjectInviteEmailParams): Promise<void> {
  await sendEmail(to, `Project invitation: ${params.projectName}`, renderProjectInviteEmail(params));
}

export interface WatcherNotificationParams {
  type: string;
  title: string;
  body?: string;
  issueKey: string;
  issueUrl: string;
}

export function renderWatcherNotificationEmail(params: WatcherNotificationParams): string {
  const { title, body, issueUrl } = params;
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="font-family: system-ui, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #4f46e5;">${escapeHtml(title)}</h2>
  ${body ? `<p>${escapeHtml(body)}</p>` : ''}
  <p><a href="${escapeHtml(issueUrl)}" style="color: #4f46e5;">View issue</a></p>
  <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
  <p style="font-size: 12px; color: #64748b;">This is an automated message. Do not reply.</p>
</body>
</html>
  `.trim();
}

export async function sendWatcherNotificationEmail(to: string, params: WatcherNotificationParams): Promise<void> {
  await sendEmail(to, params.title, renderWatcherNotificationEmail(params));
}

// ── Customer Portal request emails (shared layout) ─────────────────────────

function crDetailTable(rows: { label: string; value: string }[]): string {
  const body = rows
    .map(
      (r) => `
    <tr>
      <td style="padding:10px 14px;border:1px solid #e2e8f0;background:#f1f5f9;color:#64748b;font-size:12px;font-weight:600;vertical-align:top;width:34%;">${escapeHtml(r.label)}</td>
      <td style="padding:10px 14px;border:1px solid #e2e8f0;font-size:14px;color:#0f172a;vertical-align:top;line-height:1.5;">${
        r.value ? escapeHtml(r.value) : '—'
      }</td>
    </tr>`
    )
    .join('');
  return `<table role="presentation" style="width:100%;border-collapse:collapse;border-radius:10px;overflow:hidden;margin:18px 0;">${body}</table>`;
}

function crCtaBlock(url: string, label: string): string {
  return `<p style="margin:20px 0 8px 0;">
  <a href="${escapeHtml(url)}" style="display:inline-block;background:#4f46e5;color:#fff !important;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;font-size:14px;box-shadow:0 2px 6px rgba(79,70,229,0.35);">${escapeHtml(label)}</a>
</p>
<p style="font-size:12px;color:#64748b;margin:0;">or copy: <a href="${escapeHtml(url)}" style="color:#4f46e5;word-break:break-all;">${escapeHtml(url)}</a></p>`;
}

function crNextStepsBox(title: string, lines: string[]): string {
  if (lines.length === 0) return '';
  const items = lines
    .map(
      (line) => `<li style="margin:0 0 6px 0; padding-left:2px; line-height:1.5;">${escapeHtml(line)}</li>`
    )
    .join('');
  return `<div style="background:linear-gradient(180deg,#f8fafc 0%,#f1f5f9 100%);border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin:20px 0;">
  <p style="margin:0 0 8px 0; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:#475569;">${escapeHtml(title)}</p>
  <ul style="margin:0; padding-left:18px; color:#334155; font-size:14px;">${items}</ul>
</div>`;
}

function crBodyWrap(inner: string, accent: 'indigo' | 'green' | 'red' = 'indigo'): string {
  const top =
    accent === 'green'
      ? 'linear-gradient(90deg, #16a34a, #22c55e)'
      : accent === 'red'
        ? 'linear-gradient(90deg, #b91c1c, #ef4444)'
        : 'linear-gradient(90deg, #4f46e5, #7c3aed)';
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width" /></head>
<body style="margin:0;padding:0;background:#f1f5f9;">
  <div style="max-width:600px;margin:0 auto;padding:24px 16px 40px;font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;">
    <div style="background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,0.08);border:1px solid #e2e8f0;">
      <div style="height:5px;background:${top};"></div>
      <div style="padding:28px 24px 32px; color:#0f172a; line-height:1.6;">
        ${inner}
        <p style="margin:28px 0 0; padding-top:20px; border-top:1px solid #e2e8f0; font-size:12px; color:#64748b;">This is an automated message from TaskFlow. Please do not reply to this email.</p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

export interface CustomerRequestSubmittedParams {
  requesterName: string;
  requestTitle: string;
  orgName: string;
  appUrl: string;
  requestId: string;
  projectLabel: string;
  typeLabel: string;
  priorityLabel: string;
  /** What happens next (org admin path vs direct to TaskFlow) */
  routingMessage: string;
}

export function renderCustomerRequestSubmittedEmail(p: CustomerRequestSubmittedParams): string {
  const detailUrl = `${p.appUrl}/portal/requests/${p.requestId}`;
  const inner = `<p style="font-size:15px; margin:0 0 8px; color:#334155;">Hi ${escapeHtml(p.requesterName)},</p>
<p style="font-size:16px; font-weight:600; margin:0 0 16px; color:#0f172a;">We’ve received your request and pulled it into the queue.</p>
<p style="margin:0 0 4px; color:#475569; font-size:14px;">You’ll get another email when the status changes. Here’s a snapshot of what you sent:</p>
${crDetailTable([
  { label: 'Title', value: p.requestTitle },
  { label: 'Organisation', value: p.orgName },
  { label: 'Project', value: p.projectLabel },
  { label: 'Type', value: p.typeLabel },
  { label: 'Priority', value: p.priorityLabel },
])}
${crNextStepsBox('What happens next', [p.routingMessage, 'You can add comments and track every step in the customer portal.'])}
${crCtaBlock(detailUrl, 'View request in portal')}`;
  return crBodyWrap(inner, 'indigo');
}

export interface CustomerRequestApprovedByOrgParams {
  requesterName: string;
  requestTitle: string;
  orgName: string;
  appUrl: string;
  requestId: string;
  projectLabel: string;
  typeLabel: string;
  priorityLabel: string;
  reviewerName: string;
  adminNote?: string;
}

export function renderCustomerRequestApprovedByOrgAdminEmail(p: CustomerRequestApprovedByOrgParams): string {
  const detailUrl = `${p.appUrl}/portal/requests/${p.requestId}`;
  const noteBlock =
    p.adminNote && p.adminNote.trim()
      ? `<div style="border-left:4px solid #4f46e5;padding:10px 14px;margin:16px 0;background:#eef2ff;border-radius:0 8px 8px 0;">
        <p style="margin:0; font-size:12px; font-weight:600; color:#4338ca;">Note from your organisation</p>
        <p style="margin:6px 0 0; font-size:14px; color:#312e81; white-space:pre-wrap;">${escapeHtml(p.adminNote.trim())}</p>
      </div>`
      : '';
  const inner = `<p style="font-size:15px; margin:0 0 8px; color:#334155;">Hi ${escapeHtml(p.requesterName)},</p>
<p style="font-size:16px; font-weight:600; margin:0 0 12px; color:#16a34a;">Your organisation has approved this request</p>
<p style="margin:0 0 16px; color:#475569; font-size:14px;">It’s been forwarded to the <strong>TaskFlow</strong> team for technical review. You don’t need to do anything for now — we’ll notify you if we need more information or when work begins.</p>
${crDetailTable([
  { label: 'Title', value: p.requestTitle },
  { label: 'Organisation', value: p.orgName },
  { label: 'Project', value: p.projectLabel },
  { label: 'Type / Priority', value: `${p.typeLabel} · ${p.priorityLabel}` },
  { label: 'Approved by', value: p.reviewerName },
])}
${noteBlock}
${crNextStepsBox('What happens next', [
  'TaskFlow reviewers will accept or decline the work based on scope and capacity.',
  'If accepted, a ticket is created in the project and you’ll receive the ticket key by email.',
])}
${crCtaBlock(detailUrl, 'Open request in portal')}`;
  return crBodyWrap(inner, 'green');
}

export interface CustomerRequestRejectedByOrgParams {
  requesterName: string;
  requestTitle: string;
  orgName: string;
  appUrl: string;
  requestId: string;
  projectLabel: string;
  typeLabel: string;
  priorityLabel: string;
  reason: string;
  adminNote?: string;
}

export function renderCustomerRequestRejectedEmail(p: CustomerRequestRejectedByOrgParams): string {
  const listUrl = `${p.appUrl}/portal/requests`;
  const reasonBlock = p.reason.trim()
    ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px 16px;margin:16px 0;">
        <p style="margin:0; font-size:12px; font-weight:700; text-transform:uppercase; color:#b91c1c;">Reason provided</p>
        <p style="margin:8px 0 0; font-size:14px; color:#7f1d1d; white-space:pre-wrap;">${escapeHtml(p.reason.trim())}</p>
      </div>`
    : '';
  const noteBlock =
    p.adminNote && p.adminNote.trim()
      ? `<p style="margin:12px 0 0; font-size:13px; color:#64748b;"><strong>Additional note:</strong> ${escapeHtml(
          p.adminNote.trim()
        )}</p>`
      : '';
  const inner = `<p style="font-size:15px; margin:0 0 8px; color:#334155;">Hi ${escapeHtml(p.requesterName)},</p>
<p style="font-size:16px; font-weight:600; margin:0 0 12px; color:#b91c1c;">This request was not approved at your organisation</p>
<p style="margin:0 0 16px; color:#475569; font-size:14px;">Your organisation admin decided not to send this to TaskFlow. You can submit a new request with more detail, or ask your admin if you have questions about this decision.</p>
${crDetailTable([
  { label: 'Request', value: p.requestTitle },
  { label: 'Project', value: p.projectLabel },
  { label: 'Type / Priority', value: `${p.typeLabel} · ${p.priorityLabel}` },
  { label: 'Organisation', value: p.orgName },
])}
${reasonBlock}
${noteBlock}
${crCtaBlock(listUrl, 'View all your requests')}`;
  return crBodyWrap(inner, 'red');
}

export interface CustomerTicketCreatedEmailParams {
  recipientName: string;
  requestTitle: string;
  issueKey: string;
  orgName: string;
  appUrl: string;
  requestId: string;
  projectLabel: string;
  typeLabel: string;
  priorityLabel: string;
}

export function renderTicketCreatedEmail(p: CustomerTicketCreatedEmailParams): string {
  const detailUrl = `${p.appUrl}/portal/requests/${p.requestId}`;
  const inner = `<p style="font-size:15px; margin:0 0 8px; color:#334155;">Hi ${escapeHtml(p.recipientName)},</p>
<p style="font-size:16px; font-weight:600; margin:0 0 12px; color:#16a34a;">Your work is officially on the board</p>
<p style="margin:0 0 16px; color:#475569; font-size:14px;">TaskFlow approved your request and created a <strong>ticket</strong> in the project. The team can track, estimate, and discuss it with the same tools they use for all internal work.</p>
${crDetailTable([
  { label: 'Ticket', value: p.issueKey },
  { label: 'From request', value: p.requestTitle },
  { label: 'Project', value: p.projectLabel },
  { label: 'Type / Priority', value: `${p.typeLabel} · ${p.priorityLabel}` },
  { label: 'Organisation', value: p.orgName },
])}
${crNextStepsBox('What you can do', [
  'Watch this request in the portal for status updates and comments from the team.',
  'You can add portal comments; mention @issue if a comment should sync to the ticket for engineers.',
])}
${crCtaBlock(detailUrl, 'View request in portal')}`;
  return crBodyWrap(inner, 'green');
}

export interface CustomerTfRejectedEmailParams {
  requesterName: string;
  requestTitle: string;
  orgName: string;
  appUrl: string;
  requestId: string;
  projectLabel: string;
  typeLabel: string;
  priorityLabel: string;
  reason: string;
  teamNote?: string;
}

export function renderTfRejectedEmail(p: CustomerTfRejectedEmailParams): string {
  const listUrl = `${p.appUrl}/portal/requests`;
  const teamNoteBlock =
    p.teamNote && p.teamNote.trim()
      ? `<p style="margin:14px 0 0; font-size:14px; color:#334155; white-space:pre-wrap; border-left:3px solid #e2e8f0; padding-left:12px;">${escapeHtml(
          p.teamNote.trim()
        )}</p>`
      : '';
  const reasonBlock = p.reason.trim()
    ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px 16px;margin:16px 0;">
        <p style="margin:0; font-size:12px; font-weight:700; text-transform:uppercase; color:#b91c1c;">Decline reason</p>
        <p style="margin:8px 0 0; font-size:14px; color:#7f1d1d; white-space:pre-wrap;">${escapeHtml(p.reason.trim())}</p>
      </div>`
    : '';
  const inner = `<p style="font-size:15px; margin:0 0 8px; color:#334155;">Hi ${escapeHtml(p.requesterName)},</p>
<p style="font-size:16px; font-weight:600; margin:0 0 12px; color:#b91c1c;">The TaskFlow team could not take this request forward</p>
<p style="margin:0 0 16px; color:#475569; font-size:14px;">This isn’t a reflection on you — the team may decline when work is out of scope, duplicates existing effort, or can’t be scheduled right now. You can refine the description and try again, or work with your organisation on another approach.</p>
${crDetailTable([
  { label: 'Request', value: p.requestTitle },
  { label: 'Project', value: p.projectLabel },
  { label: 'Type / Priority', value: `${p.typeLabel} · ${p.priorityLabel}` },
  { label: 'Organisation', value: p.orgName },
])}
${reasonBlock}
${teamNoteBlock}
${crCtaBlock(listUrl, 'Back to your requests')}`;
  return crBodyWrap(inner, 'red');
}

// ── Customer Portal Email Templates (invites) ────────────────────────────────

export function renderCustomerOrgAdminInviteEmail(
  name: string,
  email: string,
  password: string,
  orgName: string,
  appUrl: string
): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Welcome to ${escapeHtml(orgName)} Customer Portal</title></head>
<body style="font-family: system-ui, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #4f46e5;">Welcome to ${escapeHtml(orgName)} on TaskFlow</h2>
  <p>Hi ${escapeHtml(name)},</p>
  <p>Your customer portal account has been created as the Organization Admin for <strong>${escapeHtml(orgName)}</strong>. Use the credentials below to sign in:</p>
  <p><strong>Email:</strong> ${escapeHtml(email)}<br><strong>Temporary Password:</strong> <code style="background: #f1f5f9; padding: 2px 6px; border-radius: 4px;">${escapeHtml(password)}</code></p>
  <p>Please change your password after your first login.</p>
  <p><a href="${escapeHtml(appUrl)}/portal/login" style="color: #4f46e5;">Sign in to Customer Portal</a></p>
  <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
  <p style="font-size: 12px; color: #64748b;">This is an automated message. Do not reply.</p>
</body>
</html>
  `.trim();
}

export function renderCustomerMemberInviteEmail(
  name: string,
  email: string,
  password: string,
  orgName: string,
  appUrl: string
): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>You've been invited to ${escapeHtml(orgName)}</title></head>
<body style="font-family: system-ui, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #4f46e5;">You've been invited to ${escapeHtml(orgName)}</h2>
  <p>Hi ${escapeHtml(name)},</p>
  <p>You've been invited to join the <strong>${escapeHtml(orgName)}</strong> customer portal. Use the credentials below to sign in:</p>
  <p><strong>Email:</strong> ${escapeHtml(email)}<br><strong>Temporary Password:</strong> <code style="background: #f1f5f9; padding: 2px 6px; border-radius: 4px;">${escapeHtml(password)}</code></p>
  <p>Please change your password after your first login.</p>
  <p><a href="${escapeHtml(appUrl)}/portal/login" style="color: #4f46e5;">Sign in to Customer Portal</a></p>
  <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
  <p style="font-size: 12px; color: #64748b;">This is an automated message. Do not reply.</p>
</body>
</html>
  `.trim();
}

export function renderTicketClosedEmail(
  requesterName: string,
  requestTitle: string,
  issueKey: string,
  orgName: string,
  appUrl: string
): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Ticket Closed</title></head>
<body style="font-family: system-ui, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #4f46e5;">Ticket Closed: ${escapeHtml(issueKey)}</h2>
  <p>Hi ${escapeHtml(requesterName)},</p>
  <p>Your ticket <strong>${escapeHtml(issueKey)}</strong> for request <strong>${escapeHtml(requestTitle)}</strong> from <strong>${escapeHtml(orgName)}</strong> has been resolved and closed.</p>
  <p>Thank you for your patience!</p>
  <p><a href="${escapeHtml(appUrl)}/portal/requests" style="color: #4f46e5;">View your requests</a></p>
  <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
  <p style="font-size: 12px; color: #64748b;">This is an automated message. Do not reply.</p>
</body>
</html>
  `.trim();
}

export async function sendCustomerEmail(to: string, subject: string, html: string): Promise<void> {
  await sendEmail(to, subject, html);
}
