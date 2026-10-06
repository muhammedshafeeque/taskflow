import { stripQuotedReply, ticketEmailSubject } from './emailInbound';

describe('email → ticket helpers', () => {
  it('adds the thread ref once', () => {
    expect(ticketEmailSubject('Login broken', 'ab12cd34')).toBe('Login broken [TKT-ab12cd34]');
    expect(ticketEmailSubject('Re: Login broken [TKT-ab12cd34]', 'ab12cd34')).toBe('Re: Login broken [TKT-ab12cd34]');
  });

  it('strips quoted history from replies', () => {
    const reply = 'Still failing on Safari.\n\nOn Mon, 5 Oct 2026 at 10:00, Support <s@x.com> wrote:\n> We fixed it';
    expect(stripQuotedReply(reply)).toBe('Still failing on Safari.');
    expect(stripQuotedReply('Thanks!\n> old')).toBe('Thanks!');
    expect(stripQuotedReply('No quote here')).toBe('No quote here');
  });
});
