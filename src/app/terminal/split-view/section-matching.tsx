import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { css } from 'styled-system/css';
import { sectionConnector } from 'styled-system/recipes';
import { token } from 'styled-system/tokens';
import {
  CLASS_CHAT_MESSAGE,
  CLASS_CMD_SUGGESTION,
  CLASS_TERM_BLOCK,
  CLASS_TERM_CMD,
  DATA_ATTR_TERM_BLOCK,
  DATASET_TERM_BLOCK,
} from '@/app/shared/section-matching-dom-attributes';
import { useDebouncedCallback } from '@/app/shared/use-debounced-callback';
import { UpdateMatchingContext } from './context';

export interface SectionMatchingProps {}

interface Connection {
  id: string;
  d: string;
}

const STROKE = token('colors.sectionConnector');

const connectorStyle = sectionConnector();

function buildPath(startX: number, endX: number, y1: number, y2: number): string {
  const midX = (startX + endX) / 2;
  return `M ${startX} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${endX} ${y2}`;
}

export function SectionMatching() {
  const svgRef = useRef<SVGSVGElement>(null);
  const [connections, setConnections] = useState<Connection[]>([]);

  const refresh = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const container = svg.parentElement;
    if (!container) return;

    const svgRect = svg.getBoundingClientRect();

    const termElements = container.querySelectorAll<HTMLElement>(
      `.${CLASS_TERM_BLOCK}[${DATA_ATTR_TERM_BLOCK}]`,
    );
    const termBySection = new Map<string, HTMLElement>();
    for (const termEl of termElements) {
      const sectId = termEl.dataset[DATASET_TERM_BLOCK];
      if (sectId) termBySection.set(sectId, termEl);
      termEl.classList.remove(connectorStyle);
    }

    const cmdElements = container.querySelectorAll<HTMLElement>(
      `.${CLASS_TERM_CMD}[${DATA_ATTR_TERM_BLOCK}]`,
    );
    const cmdBySection = new Map<string, HTMLElement>();
    for (const cmdEl of cmdElements) {
      const sectId = cmdEl.dataset[DATASET_TERM_BLOCK];
      if (sectId) cmdBySection.set(sectId, cmdEl);
      cmdEl.classList.remove(connectorStyle);
    }

    const chatElements = container.querySelectorAll<HTMLElement>(
      `.${CLASS_CHAT_MESSAGE}[${DATA_ATTR_TERM_BLOCK}]`,
    );

    const cmdSuggElements = container.querySelectorAll<HTMLElement>(
      `.${CLASS_CMD_SUGGESTION}[${DATA_ATTR_TERM_BLOCK}]`,
    );

    const next: Connection[] = [];

    addConnections(next, svgRect, termBySection, chatElements, 'cn');
    addConnections(next, svgRect, cmdBySection, cmdSuggElements, 'cn-cmd');

    setConnections(next);
  }, []);

  const debouncedRefresh = useDebouncedCallback(refresh, 0);
  useUpdateMatchingListener(debouncedRefresh);

  const paths = useMemo(
    () =>
      connections.map((conn) => (
        <path key={conn.id} d={conn.d} stroke={STROKE} strokeWidth={2} strokeDasharray="2 2" />
      )),
    [connections],
  );

  return (
    <svg
      ref={svgRef}
      aria-hidden="true"
      fill="none"
      className={css({
        pointerEvents: 'none',
        position: 'absolute',
        width: 'full',
        height: 'full',
      })}
    >
      {paths}
    </svg>
  );
}

function addConnections(
  out: Connection[],
  svgRect: DOMRect,
  sourceBySection: ReadonlyMap<string, HTMLElement>,
  targets: Iterable<HTMLElement>,
  idPrefix: string,
): void {
  for (const targetEl of targets) {
    const sectId = targetEl.dataset[DATASET_TERM_BLOCK];
    if (!sectId) continue;

    const sourceEl = sourceBySection.get(sectId);
    if (!sourceEl) continue;

    const sourceRect = sourceEl.getBoundingClientRect();
    const startX = sourceRect.right - svgRect.left + 1;
    const sourceY = sourceRect.top - svgRect.top + 1;

    if (sourceY < 0 || sourceY > svgRect.height) continue;

    const targetRect = targetEl.getBoundingClientRect();
    const endX = targetRect.left - svgRect.left - 1;
    const targetY = targetRect.top - svgRect.top + 1;
    out.push({
      id: `${idPrefix}:${sectId}`,
      d: buildPath(startX, endX, sourceY, targetY),
    });

    sourceEl.classList.add(connectorStyle);
  }
}

export function useUpdateMatchingListener(callback: () => void): void {
  const ctx = useContext(UpdateMatchingContext);
  useEffect(() => {
    if (!ctx) return;
    return ctx.subscribe(callback);
  }, [ctx, callback]);
}
