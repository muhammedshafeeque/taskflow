import {
  candidateKeys,
  emailDomain,
  leadMatchReasons,
  normCompany,
  normDomain,
  normEmail,
  normPhone,
} from './leadDuplicates';

describe('lead duplicate keys (AUT-28)', () => {
  it('normalises emails and rejects junk', () => {
    expect(normEmail('  Omar@NorthWind.test ')).toBe('omar@northwind.test');
    expect(normEmail('not an email')).toBeUndefined();
  });

  it('compares phones by their last digits, whatever the format', () => {
    expect(normPhone('+91 98765 43210')).toBe(normPhone('098765-43210'));
    expect(normPhone('(987) 654-3210')).toBe('876543210');
    expect(normPhone('12345')).toBeUndefined();
  });

  it('ignores legal suffixes, case and punctuation in company names', () => {
    expect(normCompany('Acme Pvt. Ltd.')).toBe('acme');
    expect(normCompany('ACME')).toBe('acme');
    expect(normCompany('The Acme Group, Inc')).toBe('acme');
    expect(normCompany('Smith & Sons LLC')).toBe('smith and sons');
    expect(normCompany('Ltd')).toBeUndefined();
  });

  it('reads the domain of a website and of a work email, not of free mail', () => {
    expect(normDomain('https://www.acme.io/about?x=1')).toBe('acme.io');
    expect(normDomain('acme.io')).toBe('acme.io');
    expect(normDomain('localhost')).toBeUndefined();
    expect(emailDomain('ceo@acme.io')).toBe('acme.io');
    expect(emailDomain('someone@gmail.com')).toBeUndefined();
  });

  it('lists every shared key between two leads', () => {
    const keys = candidateKeys({
      contactEmail: 'omar@northwind.test',
      contactPhone: '+1 555 123 4567',
      companyName: 'Northwind Ltd',
      website: 'northwind.test',
    });
    expect(
      leadMatchReasons(keys, { contactEmail: 'OMAR@northwind.test', companyName: 'northwind', contactPhone: '5551234567' })
    ).toEqual(['email', 'phone', 'company', 'domain']);
    expect(leadMatchReasons(keys, { contactEmail: 'ana@other.test', companyName: 'Other' })).toEqual([]);
  });

  it('matches through extra contacts too', () => {
    const keys = candidateKeys({ contactEmail: 'ana@gmail.com' });
    expect(leadMatchReasons(keys, { additionalContacts: [{ email: 'ana@gmail.com' }] })).toEqual(['email']);
  });

  it('does not treat a shared free mailbox domain as the same company', () => {
    const keys = candidateKeys({ contactEmail: 'ana@gmail.com' });
    expect(leadMatchReasons(keys, { contactEmail: 'bob@gmail.com' })).toEqual([]);
  });
});
