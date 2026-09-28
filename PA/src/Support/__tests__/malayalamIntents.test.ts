import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { analyzeMessage } from '../../MessageAnalyzer';

describe('Malayalam rule intents (voice transcripts)', () => {
  const cases: Array<[string, string]> = [
    ['ഹലോ', 'greeting'],
    ['നമസ്കാരം', 'greeting'],
    ['എനിക്ക് ഒരു ആപ്പ് വേണം', 'requirement'],
    ['ബില്ലിംഗ് സോഫ്റ്റ്‌വെയർ വേണം', 'requirement'],
    ['ലോഗിൻ വർക്ക് ചെയ്യുന്നില്ല', 'requirement'],
    ['സ്റ്റാറ്റസ് എന്താണ്?', 'support'],
  ];
  for (const [text, type] of cases) {
    it(`${text} → ${type}`, () => {
      const r = analyzeMessage(text);
      assert.equal(r.type, type);
      assert.equal(r.shouldReply, true);
    });
  }

  it('replies to inflected problem reports (ആപ്പിന്, പ്രശ്നം)', () => {
    assert.equal(analyzeMessage('ഞങ്ങളുടെ ആപ്പിന് ഒരു പ്രശ്നം ഉണ്ട്').shouldReply, true);
  });

  it('handles Whisper spelling variants', () => {
    for (const t of [
      'എനുക്ക് എണ്ടെ കഡെക്ക് ഒരു ബില്ലിംഗ് ആപ് വേന്നു.',
      'നെങ്ങോളുടെ വെബ്സൈട് ഇന്നലേ മുദല് തുരകുന്ന് ല്ലൾ.',
      'ലോഗിണ് ചേയുംപോല എര്രവരന്നു, ഒന്നു നോകാമോ.',
    ]) {
      assert.equal(analyzeMessage(t).shouldReply, true, t);
    }
  });

  it('still ignores unrelated Malayalam small talk without history', () => {
    assert.equal(analyzeMessage('ഇന്ന് നല്ല മഴയാണ്').shouldReply, false);
  });
});
