import { useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { materialLight, tomorrow } from 'react-syntax-highlighter/dist/esm/styles/prism';
import remarkGfm from 'remark-gfm';
import { cx } from 'styled-system/css';
import { Box } from 'styled-system/jsx';
import { prose } from 'styled-system/recipes';
import { useIsDarkMode } from '@/app/shared/dark-mode-provider';
import { Code } from '@/ui/primitives';

const remarkPlugins = [remarkGfm];

export interface MarkdownProps {
  content: string;
  className?: string;
}

export function Markdown({ content, className }: MarkdownProps) {
  const isDark = useIsDarkMode();

  const components: Components = useMemo(
    () => ({
      code({
        node,
        className,
        children,
        ref: _ref,
        style: _style,
        translate: _translate,
        color: _color,
        ...props
      }) {
        const match = /language-(\w+)/.exec(className || '');
        const inline = 'inline' in props ? !!props.inline : false;
        return !inline && match ? (
          <SyntaxHighlighter
            style={isDark ? tomorrow : materialLight}
            language={match[1]}
            PreTag="div"
            {...props}
          >
            {String(children).replace(/\n$/, '')}
          </SyntaxHighlighter>
        ) : (
          <Code className={className} {...props} block={true} variant="subtle" colorPalette="gray">
            {children}
          </Code>
        );
      },
      a(props) {
        return <a target="_blank" rel="noopener noreferrer" {...props} />;
      },
      // Customize other elements (h1, p, etc.)
    }),
    [isDark],
  );

  return (
    <Box className={cx(prose(), className)}>
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
        {content}
      </ReactMarkdown>
    </Box>
  );
}
