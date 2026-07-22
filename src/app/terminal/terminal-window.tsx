import { NotebookView } from './notebook-view';
import { useSelectedView } from './selected-view-store';
import { SplitView } from './split-view/split-view';

export function TerminalWindow() {
  const selectedView = useSelectedView((s) => s.viewValue);

  if (selectedView === 'notebook') return <NotebookView />;
  return <SplitView />;
}
