export interface AuthPayload {
  id: string;
  email: string;
  name: string;
  role: string;
  roleId?: string;
  permissions: string[];
  mustChangePassword: boolean;
  /** Distinguishes staff JWT from customer-portal JWT when both use authMiddleware. */
  userType?: 'taskflow' | 'customer';
}

export interface CustomerAuthPayload {
  id: string;
  email: string;
  name: string;
  orgId: string;
  isOrgAdmin: boolean;
  permissions: string[];
  mustChangePassword: boolean;
}

/** Who the first-party WhatsApp PA is acting for on an internal request. */
export type PaActor = 'owner' | 'client' | 'system';

export interface PaRequestContext {
  actor: PaActor;
  organizationId: string;
  /** The PA service account (non-human actor) for this workspace. */
  serviceAccountId: string;
  /** Owner context: the signed-in human the PA app is acting for. */
  onBehalfOf?: string;
  chatId?: string;
  senderPhone?: string;
  /** Client context: server-resolved client and projects. */
  scope?: import('../modules/internal/paScope').ClientScope;
}

declare global {
  namespace Express {
    /** TaskFlow JWT user (passport-compatible name) */
    interface User extends AuthPayload {}
    interface Request {
      customerUser?: CustomerAuthPayload;
      /** Active TaskFlow workspace (set for TaskFlow JWT users). */
      activeOrganizationId?: string;
      /** Set when the WhatsApp PA calls with the internal key. */
      paContext?: PaRequestContext;
    }
  }
}

export {};
