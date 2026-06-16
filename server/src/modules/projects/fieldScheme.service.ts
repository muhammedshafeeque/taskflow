import type { IProjectCustomField, IFieldScheme } from './project.model';

export type ResolvedCustomField = IProjectCustomField & {
  visible: boolean;
  effectiveRequired: boolean;
  readOnly: boolean;
};

/** Resolve issue type name to id from project issue types list. */
export function resolveIssueTypeId(
  issueTypes: Array<{ id: string; name: string }>,
  issueTypeName: string
): string | undefined {
  const match = issueTypes.find((t) => t.name === issueTypeName);
  return match?.id;
}

/** Apply per-issue-type field scheme to project custom field definitions. */
export function resolveFieldsForIssueType(
  customFields: IProjectCustomField[],
  fieldSchemes: IFieldScheme[] | undefined,
  issueTypeId: string | undefined
): ResolvedCustomField[] {
  const scheme = issueTypeId
    ? fieldSchemes?.find((s) => s.issueTypeId === issueTypeId)
    : undefined;
  const ruleMap = new Map<string, { visible: boolean; required?: boolean }>();
  if (scheme) {
    for (const r of scheme.rules) {
      ruleMap.set(r.fieldKey, { visible: r.visible, required: r.required });
    }
  }

  return [...customFields]
    .sort((a, b) => a.order - b.order)
    .map((field) => {
      const isFormula = field.fieldType === 'formula';
      const rule = ruleMap.get(field.key);
      const visible = isFormula ? true : rule !== undefined ? rule.visible : true;
      const effectiveRequired =
        isFormula ? false : rule?.required !== undefined ? rule.required : field.required;
      return {
        ...field,
        visible,
        effectiveRequired,
        readOnly: isFormula,
      };
    })
    .filter((f) => f.visible);
}
