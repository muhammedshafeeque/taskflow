import { plain, tokens } from './ai.service';
import { extractJson } from '../../services/ai.service';

describe('ai helpers', () => {
  it('strips HTML to compact text', () => {
    expect(plain('<p>Hello&nbsp;<b>world</b></p><p>Line 2</p>')).toBe('Hello world\nLine 2');
  });

  it('tokenizes without stop words or short words', () => {
    expect([...tokens('Fix the login page crash on Safari')]).toEqual(['login', 'page', 'crash', 'safari']);
  });

  it('extracts JSON from fenced or chatty replies', () => {
    expect(extractJson<{ a: number }>('Sure!\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(extractJson<{ b: string }>('Here: {"b": "x"} done')).toEqual({ b: 'x' });
    expect(() => extractJson('no json here')).toThrow();
  });
});
