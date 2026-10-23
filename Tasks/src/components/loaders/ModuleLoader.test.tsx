import { render, screen } from '@testing-library/react';
import { ModuleLoader } from './ModuleLoader';
import { ModuleLoaderContext } from './moduleLoaderContext';

describe('ModuleLoader', () => {
  it('picks the module from the surrounding layout', () => {
    render(
      <ModuleLoaderContext.Provider value="accounts">
        <ModuleLoader label="Loading invoices…" />
      </ModuleLoaderContext.Provider>
    );
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('data-module', 'accounts');
    expect(screen.getByText('Loading invoices…')).toBeInTheDocument();
    expect(screen.getByText('Balancing the books')).toBeInTheDocument();
  });

  it('lets an explicit module override the layout', () => {
    render(
      <ModuleLoaderContext.Provider value="crm">
        <ModuleLoader module="monitor" />
      </ModuleLoaderContext.Provider>
    );
    expect(screen.getByRole('status')).toHaveAttribute('data-module', 'monitor');
  });

  it('falls back to the app loader outside any module', () => {
    render(<ModuleLoader size="inline" label="Restoring your session…" />);
    expect(screen.getByRole('status')).toHaveAttribute('data-module', 'app');
  });
});
