// Small pieces shared by the weekly review and the Done page: the kept-promise line and "Copy as Markdown".
import type { KeptRate, ReviewData } from '../../shared/types';
import { reviewMarkdown } from '../core';
import { api, showToast, summaries } from '../model';
import { keptLine } from '../reports-logic';
import { LoopRing } from './ui';

/** "11 of 13 promises kept on time, 85%" with a small ring that fills to the rate. */
export function KeptRateLine({ rate, suffix }: { rate: KeptRate | null; suffix?: string }) {
  if (!rate) return null;
  const text = keptLine(rate);
  return (
    <div class="kept-line row-flex gap8" data-testid="kept-rate">
      <LoopRing size={16} line={2} progress={rate.rate ?? 0} />
      <span class={text ? '' : 'dim'}>{text ?? 'No promises closed in this period'}</span>
      {text && suffix && <span class="dim">{suffix}</span>}
    </div>
  );
}

export const nameMap = (): Record<string, string> => Object.fromEntries(summaries.value.map((s) => [s.person.id, s.person.name]));

export async function copyReview(r: ReviewData) {
  await api.copyText(reviewMarkdown(r, nameMap()));
  showToast('Copied the week as Markdown');
}
