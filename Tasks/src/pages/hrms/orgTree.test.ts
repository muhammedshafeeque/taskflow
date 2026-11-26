import { buildOrgTree, type OrgNode, type OrgPerson } from './orgTree';

const p = (_id: string, managerId?: string, status = 'active') => ({ _id, name: _id, managerId, status });
const show = (n: OrgNode<OrgPerson>): string => n.person._id + (n.reports.length ? `(${n.reports.map(show).join(',')})` : '');

describe('buildOrgTree', () => {
  it('nests people under their managers, by name, with totals', () => {
    const tree = buildOrgTree([p('dev', 'tara'), p('tara', 'ceo'), p('ceo'), p('hana', 'ceo'), p('jo', 'dev')]);
    expect(tree.map(show)).toEqual(['ceo(hana,tara(dev(jo)))']);
    expect(tree[0].total).toBe(4);
  });

  it('leaves out leavers and lifts their reports', () => {
    expect(buildOrgTree([p('ceo'), p('old', 'ceo', 'terminated'), p('jo', 'old'), p('x', 'missing')]).map(show)).toEqual(['ceo', 'jo', 'x']);
  });

  it('keeps everyone once when old data is circular', () => {
    expect(buildOrgTree([p('a', 'b'), p('b', 'a'), p('c', 'c'), p('d', 'a')]).map(show)).toEqual(['c', 'a(b,d)']);
  });
});
