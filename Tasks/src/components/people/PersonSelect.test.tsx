import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { PersonMultiSelect, PersonSelect } from './PersonSelect';

const people = [
  { id: 'u1', name: 'Asha Rao', hint: 'asha@acme.test' },
  { id: 'u2', name: 'Ben Ortiz', hint: 'ben@acme.test' },
  { id: 'u3', name: 'Chen Li', hint: 'chen@acme.test' },
];

function Single() {
  const [v, setV] = useState('');
  return (
    <>
      <PersonSelect value={v} onChange={setV} people={people} specialOptions={[{ value: '', label: 'Unassigned' }]} aria-label="Assignee" />
      <output data-testid="value">{v}</output>
    </>
  );
}

describe('PersonSelect', () => {
  it('filters by name or email as you type and picks with Enter', () => {
    render(<Single />);
    const input = screen.getByRole('combobox', { name: 'Assignee' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'ben@' } });
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('Ben Ortiz');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('value')).toHaveTextContent('u2');
  });

  it('moves through options with arrow keys', () => {
    render(<Single />);
    const input = screen.getByRole('combobox', { name: 'Assignee' });
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('value')).toHaveTextContent('u2');
  });

  it('shows a helpful message when nobody matches', () => {
    render(<Single />);
    const input = screen.getByRole('combobox', { name: 'Assignee' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'zzz' } });
    expect(screen.getByText(/No one matches/)).toBeInTheDocument();
  });
});

describe('PersonMultiSelect', () => {
  it('adds chips and removes the last one with Backspace', () => {
    function Multi() {
      const [v, setV] = useState<string[]>([]);
      return (
        <>
          <PersonMultiSelect values={v} onChange={setV} people={people} aria-label="People" />
          <output data-testid="values">{v.join(',')}</output>
        </>
      );
    }
    render(<Multi />);
    const input = screen.getByRole('combobox', { name: 'People' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'chen' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.change(input, { target: { value: 'asha' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('values')).toHaveTextContent('u3,u1');
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(screen.getByTestId('values')).toHaveTextContent('u3');
  });
});
