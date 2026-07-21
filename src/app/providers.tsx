import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkModeProvider } from './shared/dark-mode-provider';

const queryClient = new QueryClient();

export function CommonProviders({ children }: React.PropsWithChildren) {
  return (
    <DarkModeProvider>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </DarkModeProvider>
  );
}
