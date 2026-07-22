import { ArrowUpIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Box } from 'styled-system/jsx';
import { IconButton, TextareaSlot } from '@/ui/primitives';
import { ModelMenu } from './model-menu';
import { useChat } from './use-chat';

export interface PromptInputProps {
  onValueEmptyChange?: (isEmpty: boolean) => void;
}

export function PromptInput({ onValueEmptyChange }: PromptInputProps) {
  const { selectedModel, isGenerating, send } = useChat();

  const [input, setInput] = useState('');

  const isEmpty = input.trim().length === 0;
  useEffect(() => {
    onValueEmptyChange?.(isEmpty);
  }, [isEmpty, onValueEmptyChange]);

  const handleSubmit = useCallback(() => {
    const text = input.trim();
    if (!text || isGenerating) return;
    setInput('');
    send(text);
  }, [input, isGenerating, send]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  return (
    <Box p="2">
      <TextareaSlot.Root>
        <TextareaSlot.Input
          autoresize
          placeholder="Message the assistant"
          maxH="40"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <TextareaSlot.Footer justifyContent="end">
          <ModelMenu />
          <IconButton
            size="xs"
            borderRadius="full"
            disabled={!selectedModel || isGenerating || !input.trim()}
            title={!selectedModel ? 'Select a model first' : 'Send message'}
            onClick={handleSubmit}
          >
            <ArrowUpIcon />
          </IconButton>
        </TextareaSlot.Footer>
      </TextareaSlot.Root>
    </Box>
  );
}
