import type { Comparison, ComparisonDimension } from './types';

export const comparisonDimensions: Record<ComparisonDimension, string> = {
  overall: 'Overall style',
  spacing: 'Spacing',
  typography: 'Typography',
  color: 'Color',
  alignment: 'Alignment',
};

export function validateComparison(
  value: unknown,
  targetCount: number,
): Comparison {
  const c = value as Comparison | null;
  if (
    !c ||
    targetCount !== 2 ||
    !Number.isInteger(c.changeTarget) ||
    !Number.isInteger(c.referenceTarget) ||
    c.changeTarget < 0 ||
    c.changeTarget > 1 ||
    c.referenceTarget < 0 ||
    c.referenceTarget > 1 ||
    c.changeTarget === c.referenceTarget ||
    !Object.hasOwn(comparisonDimensions, c.dimension)
  )
    throw new Error(
      'A comparison needs two distinct targets and a supported match dimension.',
    );
  return {
    changeTarget: c.changeTarget,
    referenceTarget: c.referenceTarget,
    dimension: c.dimension,
  };
}

export function comparisonSummary(c: Comparison): string {
  return `Change target ${c.changeTarget + 1} to match target ${c.referenceTarget + 1} · ${comparisonDimensions[c.dimension]}`;
}

export function comparisonMarkdown(c?: Comparison): string[] {
  return c
    ? [
        '**Match reference**',
        '',
        `Change this: Target ${c.changeTarget + 1}.`,
        `Use as reference: Target ${c.referenceTarget + 1}. Keep the reference unchanged.`,
        `Match: ${comparisonDimensions[c.dimension]}.`,
        '',
      ]
    : [];
}
