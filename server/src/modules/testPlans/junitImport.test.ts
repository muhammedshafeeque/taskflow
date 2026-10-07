import { parseJUnit } from './junitImport';

describe('parseJUnit', () => {
  it('reads pass, fail, error and skipped cases', () => {
    const xml = `<?xml version="1.0"?>
<testsuites><testsuite name="s">
  <testcase classname="auth" name="logs in" time="0.12"/>
  <testcase classname="auth" name="rejects bad password"><failure message="expected 401 &amp; got 200">stack</failure></testcase>
  <testcase name="boom"><error><![CDATA[TypeError: x]]></error></testcase>
  <testcase name='later'><skipped/></testcase>
</testsuite></testsuites>`;
    const cases = parseJUnit(xml);
    expect(cases).toEqual([
      { name: 'logs in', classname: 'auth', status: 'pass', message: undefined, timeSec: 0.12 },
      { name: 'rejects bad password', classname: 'auth', status: 'fail', message: 'expected 401 & got 200', timeSec: undefined },
      { name: 'boom', classname: undefined, status: 'fail', message: 'TypeError: x', timeSec: undefined },
      { name: 'later', classname: undefined, status: 'skip', message: undefined, timeSec: undefined },
    ]);
  });
});
