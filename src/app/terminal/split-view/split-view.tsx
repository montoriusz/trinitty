import { useRef } from 'react';
import { Splitter } from '@/ui/primitives';
import { type TerminalHandle, TerminalPane } from '..';
import { useSelectedView } from '../selected-view-store';
import { ChatPane } from './chat-pane';
import { SectionMatching } from './section-matching';
import { UpdateMatchingProvider } from './update-matching-provider';
import { useEmitUpdateMatching } from './use-emit-update-matching';
import { useEnterSplitView } from './use-enter-view';

const PANELS: Splitter.PanelData[] = [
  { id: 'terminal', minSize: '30rem' },
  { id: 'chat', minSize: '18rem', maxSize: '50%' },
];

export function SplitViewInner() {
  const splitterRootRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<TerminalHandle>(null);
  const emitUpdateMatching = useEmitUpdateMatching();
  // TODO: refactor - move to an useEffect in TerminalWindow
  const viewValue = useSelectedView((s) => s.viewValue);
  // §3: entering split view — rebuild the buffer from committed raws + live.
  useEnterSplitView(viewValue);

  return (
    <Splitter.Root
      ref={splitterRootRef}
      panels={PANELS}
      variant="full"
      defaultSize={[5, 3]}
      orientation="horizontal"
      h="screen"
      w="screen"
      position="relative"
      onResizeEnd={() => {
        terminalRef.current?.fit();
        emitUpdateMatching();
      }}
    >
      <Splitter.Panel id="terminal" h="full">
        <TerminalPane ref={terminalRef} />
      </Splitter.Panel>
      <Splitter.ResizeTrigger id="terminal:chat" aria-label="Resize panes">
        <Splitter.ResizeTriggerIndicator />
      </Splitter.ResizeTrigger>
      <Splitter.Panel id="chat" h="full" borderWidth="0">
        <ChatPane />
      </Splitter.Panel>
      <SectionMatching />
    </Splitter.Root>
  );
}

export function SplitView() {
  return (
    <UpdateMatchingProvider>
      <SplitViewInner />
    </UpdateMatchingProvider>
  );
}
