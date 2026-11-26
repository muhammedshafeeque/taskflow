import mongoose, { Schema } from 'mongoose';

/**
 * "People in this team and/or at this level get these roles" — on top of their own role. Data, per workspace:
 * which teams, levels and roles exist is the company's choice.
 */
const accessRuleSchema = new Schema(
  {
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    name: { type: String, required: true, trim: true },
    /** Members of this team (Resources > Teams); empty = any team. */
    teamId: { type: Schema.Types.ObjectId, ref: 'ResourceTeam', default: null },
    /** Employee level, as set on the employee (HR settings list the choices); empty = any level. */
    level: { type: String, trim: true, default: null },
    /** Only the lead of the team (or of any team, when no team is set). */
    leadsOnly: { type: Boolean, default: false },
    roleIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Role' }], default: [] },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const AccessRule = mongoose.model('AccessRule', accessRuleSchema);
