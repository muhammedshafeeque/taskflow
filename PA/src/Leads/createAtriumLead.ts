import mongoose from 'mongoose';
import type { LeadAssessment } from './assessLeadReady';
import { pushToDevices } from '../Push/expoPush';

const localLeadSchema = new mongoose.Schema(
  {
    chatId: { type: String, required: true, index: true },
    title: { type: String, required: true },
    summary: { type: String, required: true },
    contactPhone: { type: String },
    contactName: { type: String },
    companyName: { type: String },
    industry: { type: String },
    serviceInterest: { type: [String], default: [] },
    transcript: { type: String },
    crmLeadId: { type: String },
    source: { type: String, default: 'whatsapp_pa' },
  },
  { timestamps: true }
);

export const LocalWhatsappLead = mongoose.model(
  'WhatsappLead',
  localLeadSchema
);

export type CreatedLeadResult = {
  localId: string;
  crmLeadId?: string;
};

function normalizePhone(raw: string): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  // Keep international digits; prefix + for CRM readability
  return `+${digits}`;
}

function leadPayload(input: {
  assessment: LeadAssessment;
  contactPhone: string;
  contactName?: string;
  notes: string;
}) {
  return {
    title: input.assessment.title,
    source: 'other',
    status: 'new',
    contactPhone: input.contactPhone,
    contactName: input.contactName || undefined,
    companyName: input.assessment.companyName,
    industry: input.assessment.industry,
    serviceInterest: input.assessment.serviceInterest ?? ['custom_dev'],
    notes: input.notes,
    tags: ['whatsapp', 'pa-bot', 'evorix'],
    campaign: 'whatsapp_pa',
  };
}

/**
 * Persist lead locally always; push to Taskflow CRM via ingest secret (preferred) or JWT.
 */
export async function createAtriumLead(input: {
  chatId: string;
  assessment: LeadAssessment;
  transcript: string;
  /** Real WhatsApp mobile of the customer who messaged */
  contactPhone: string;
  contactName?: string;
}): Promise<CreatedLeadResult> {
  const contactPhone =
    normalizePhone(input.contactPhone) ||
    normalizePhone(input.chatId.replace(/@.*/, '')) ||
    input.chatId;

  const notes = [
    input.assessment.summary,
    '',
    '--- Contact ---',
    `Mobile: ${contactPhone}`,
    input.contactName ? `Name: ${input.contactName}` : null,
    `WhatsApp chatId: ${input.chatId}`,
    '',
    '--- WhatsApp transcript ---',
    input.transcript.slice(-3500),
  ]
    .filter((line) => line != null)
    .join('\n');

  const local = await LocalWhatsappLead.create({
    chatId: input.chatId,
    title: input.assessment.title,
    summary: input.assessment.summary,
    contactPhone,
    contactName: input.contactName,
    companyName: input.assessment.companyName,
    industry: input.assessment.industry,
    serviceInterest: input.assessment.serviceInterest ?? ['custom_dev'],
    transcript: input.transcript.slice(-5000),
  });

  let crmLeadId: string | undefined;

  const apiUrl = process.env.TASKFLOW_API_URL?.trim().replace(/\/$/, '');
  const ingestSecret = process.env.TASKFLOW_INGEST_SECRET?.trim();
  const orgId = process.env.TASKFLOW_ORG_ID?.trim();
  const token = process.env.TASKFLOW_API_TOKEN?.trim();
  const payload = leadPayload({
    assessment: input.assessment,
    contactPhone,
    contactName: input.contactName,
    notes,
  });

  if (apiUrl && ingestSecret) {
    try {
      const res = await fetch(`${apiUrl}/api/crm/ingest/whatsapp-lead`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-pa-ingest-secret': ingestSecret,
          ...(orgId ? { 'x-organization-id': orgId } : {}),
        },
        body: JSON.stringify({
          ...payload,
          ...(orgId ? { organizationId: orgId } : {}),
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        console.error('CRM ingest failed', res.status, body.slice(0, 300));
      } else {
        const json = (await res.json()) as { data?: { _id?: string } };
        crmLeadId = json.data?._id ? String(json.data._id) : undefined;
        console.log('Atrium CRM lead created (ingest)', {
          crmLeadId,
          title: input.assessment.title,
          contactPhone,
        });
      }
    } catch (err) {
      console.error('CRM ingest API error:', err);
    }
  } else if (apiUrl && token) {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      };
      if (orgId) headers['x-organization-id'] = orgId;

      const res = await fetch(`${apiUrl}/api/crm/leads`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.text();
        console.error('CRM lead create failed', res.status, body.slice(0, 300));
      } else {
        const json = (await res.json()) as { data?: { _id?: string } };
        crmLeadId = json.data?._id ? String(json.data._id) : undefined;
        console.log('Atrium CRM lead created', {
          crmLeadId,
          title: input.assessment.title,
          contactPhone,
        });
      }
    } catch (err) {
      console.error('CRM lead API error:', err);
    }
  } else {
    console.warn(
      'TASKFLOW_INGEST_SECRET (or TASKFLOW_API_TOKEN) not set — lead saved locally only',
      { localId: String(local._id) }
    );
  }

  if (crmLeadId) {
    await LocalWhatsappLead.updateOne(
      { _id: local._id },
      { $set: { crmLeadId } }
    );
  }

  void pushToDevices('lead', {
    title: `🧲 New lead${input.contactName ? `: ${input.contactName}` : ''}`,
    body: (input.assessment.summary || contactPhone).slice(0, 180),
    data: { chatId: input.chatId, leadId: String(local._id) },
  });

  return { localId: String(local._id), crmLeadId };
}

/**
 * Push new useful details onto an existing CRM + local WhatsApp lead.
 */
export async function updateAtriumLead(input: {
  chatId: string;
  crmLeadId?: string;
  localLeadId?: string;
  assessment: {
    title?: string;
    summary: string;
    companyName?: string;
    industry?: string;
    serviceInterest?: string[];
  };
  transcript: string;
}): Promise<void> {
  const notes = [
    input.assessment.summary,
    '',
    '--- WhatsApp transcript (updated) ---',
    input.transcript.slice(-3500),
    '',
    `WhatsApp chatId: ${input.chatId}`,
  ].join('\n');

  const patch: Record<string, unknown> = {
    notes,
  };
  if (input.assessment.title) patch.title = input.assessment.title;
  if (input.assessment.companyName) patch.companyName = input.assessment.companyName;
  if (input.assessment.industry) patch.industry = input.assessment.industry;
  if (input.assessment.serviceInterest?.length) {
    patch.serviceInterest = input.assessment.serviceInterest;
  }

  if (input.localLeadId) {
    await LocalWhatsappLead.updateOne(
      { _id: input.localLeadId },
      {
        $set: {
          summary: input.assessment.summary,
          ...(input.assessment.title ? { title: input.assessment.title } : {}),
          ...(input.assessment.companyName
            ? { companyName: input.assessment.companyName }
            : {}),
          ...(input.assessment.industry
            ? { industry: input.assessment.industry }
            : {}),
          ...(input.assessment.serviceInterest?.length
            ? { serviceInterest: input.assessment.serviceInterest }
            : {}),
          transcript: input.transcript.slice(-5000),
        },
      }
    );
  } else {
    await LocalWhatsappLead.updateOne(
      { chatId: input.chatId },
      {
        $set: {
          summary: input.assessment.summary,
          transcript: input.transcript.slice(-5000),
        },
      }
    );
  }

  const apiUrl = process.env.TASKFLOW_API_URL?.trim().replace(/\/$/, '');
  const ingestSecret = process.env.TASKFLOW_INGEST_SECRET?.trim();
  const orgId = process.env.TASKFLOW_ORG_ID?.trim();
  const token = process.env.TASKFLOW_API_TOKEN?.trim();

  if (!input.crmLeadId || !apiUrl) return;

  if (ingestSecret) {
    try {
      const res = await fetch(
        `${apiUrl}/api/crm/ingest/whatsapp-lead/${input.crmLeadId}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'x-pa-ingest-secret': ingestSecret,
            ...(orgId ? { 'x-organization-id': orgId } : {}),
          },
          body: JSON.stringify({
            ...patch,
            ...(orgId ? { organizationId: orgId } : {}),
          }),
        }
      );
      if (!res.ok) {
        const body = await res.text();
        console.error('CRM lead update failed', res.status, body.slice(0, 300));
      } else {
        console.log('Atrium CRM lead updated', {
          crmLeadId: input.crmLeadId,
          title: input.assessment.title,
        });
      }
    } catch (err) {
      console.error('CRM lead update API error:', err);
    }
    return;
  }

  if (token) {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      };
      if (orgId) headers['x-organization-id'] = orgId;
      const res = await fetch(`${apiUrl}/api/crm/leads/${input.crmLeadId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = await res.text();
        console.error('CRM lead update failed', res.status, body.slice(0, 300));
      } else {
        console.log('Atrium CRM lead updated', { crmLeadId: input.crmLeadId });
      }
    } catch (err) {
      console.error('CRM lead update API error:', err);
    }
  }
}

export function handoffThanksMessage(lang: 'ml' | 'en'): string {
  return lang === 'ml'
    ? 'വിശദാംശങ്ങൾക്ക് നന്ദി. ഐവോറിക്സ് സെയിൽസ് ടീം ഉടൻ നിങ്ങളെ ബന്ധപ്പെടും. കൂടുതൽ വിവരങ്ങളുണ്ടെങ്കിൽ ഇവിടെ പറയാം.'
    : 'Thanks for the details. Our Ivorix sales team will connect with you shortly. You can share more details here anytime.';
}
