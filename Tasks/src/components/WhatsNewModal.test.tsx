import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AppUpdateItem } from '../lib/api';

const mockUseAuth = jest.fn();
const mockGetUnseen = jest.fn();
const mockAcknowledge = jest.fn();

jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('../lib/api', () => ({
  updatesApi: {
    getUnseen: (...args: unknown[]) => mockGetUnseen(...args),
    acknowledge: (...args: unknown[]) => mockAcknowledge(...args),
  },
}));

import { WhatsNewChecker, WhatsNewModal } from './WhatsNewModal';

const SAMPLE_UPDATES: AppUpdateItem[] = [
  {
    updateId: 'UPD-0002',
    date: '2026-11-26',
    type: 'feature',
    title: "What's New Modal",
    details: 'Added changelog sync ; Added bullet point formatting',
  },
  {
    updateId: 'UPD-0001',
    date: '2026-11-25',
    type: 'fix',
    title: 'Filter Alignment',
    details: 'Fixed mobile spacing on filters',
  },
];

describe('WhatsNewModal', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders nothing when closed or empty', () => {
    const { container } = render(
      <WhatsNewModal open={false} updates={SAMPLE_UPDATES} onDismiss={jest.fn()} />
    );
    expect(container).toBeEmptyDOMElement();

    render(<WhatsNewModal open={true} updates={[]} onDismiss={jest.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders title, badges, dates, and semicolon-separated details as bullet points', () => {
    render(<WhatsNewModal open={true} updates={SAMPLE_UPDATES} onDismiss={jest.fn()} />);

    expect(screen.getByRole('dialog', { name: /what's new/i })).toBeInTheDocument();
    expect(screen.getByText('Feature')).toBeInTheDocument();
    expect(screen.getByText('Fix')).toBeInTheDocument();
    expect(screen.getByText("What's New Modal")).toBeInTheDocument();
    expect(screen.getByText('2026-11-26')).toBeInTheDocument();
    expect(screen.getByText('Added changelog sync')).toBeInTheDocument();
    expect(screen.getByText('Added bullet point formatting')).toBeInTheDocument();
    expect(screen.getByText('Fixed mobile spacing on filters')).toBeInTheDocument();
  });

  it('calls onDismiss on Got it button, Close button, overlay click, and Escape', () => {
    const onDismiss = jest.fn();
    render(<WhatsNewModal open={true} updates={SAMPLE_UPDATES} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole('button', { name: /got it/i }));
    fireEvent.click(screen.getByRole('button', { name: /close what's new/i }));
    fireEvent.click(screen.getByTestId('whats-new-overlay'));
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onDismiss).toHaveBeenCalledTimes(4);
  });
});

describe('WhatsNewChecker', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    mockUseAuth.mockReset();
  });

  it('fetches unseen updates once per session and acknowledges all shown IDs on close', async () => {
    mockUseAuth.mockReturnValue({
      token: 'jwt-token',
      loading: false,
      user: { id: 'user-1', email: 'a@b.com', name: 'Alice', role: 'user', userType: 'taskflow' },
    });

    mockGetUnseen.mockResolvedValue({ success: true, data: SAMPLE_UPDATES });
    mockAcknowledge.mockResolvedValue({
      success: true,
      data: { acknowledged: ['UPD-0002', 'UPD-0001'] },
    });

    render(<WhatsNewChecker />);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    expect(mockGetUnseen).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /got it/i }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(mockAcknowledge).toHaveBeenCalledWith(['UPD-0002', 'UPD-0001'], 'jwt-token');
  });

  it('closes modal and logs error if acknowledge fails', async () => {
    mockUseAuth.mockReturnValue({
      token: 'jwt-token',
      loading: false,
      user: { id: 'user-2', email: 'a@b.com', name: 'Bob', role: 'user', userType: 'taskflow' },
    });

    mockGetUnseen.mockResolvedValue({ success: true, data: SAMPLE_UPDATES });
    mockAcknowledge.mockRejectedValue(new Error('Network error'));
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    render(<WhatsNewChecker />);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(errorSpy).toHaveBeenCalled();
  });

  it('does not fetch for customer portal users', () => {
    mockUseAuth.mockReturnValue({
      token: 'jwt-token',
      loading: false,
      user: { id: 'cust-1', email: 'c@b.com', name: 'Client', role: 'customer_user', userType: 'customer' },
    });

    render(<WhatsNewChecker />);

    expect(mockGetUnseen).not.toHaveBeenCalled();
  });
});
