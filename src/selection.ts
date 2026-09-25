import { isNigeriaLocation } from './sources/common.js';
import type { JobPost } from './types.js';

/** Split target roles into unique lowercase keywords, e.g. "Machine Learning Engineer" -> machine, learning, engineer. */
export function roleKeywords(roles: string[]): string[] {
    const words = roles
        .join(' ')
        .toLowerCase()
        .split(/[^a-z0-9+#]+/)
        .filter((w) => w.length > 2);
    return [...new Set(words)];
}

const LOCAL_PREFERENCE = /\b(nigeria|lagos|abuja|port harcourt|ibadan|kano|hybrid|onsite|on-site)\b/i;

/**
 * Cheap pre-LLM relevance. Title hits count triple, description hits once, and
 * jobs based in Nigeria get a boost when the seeker prefers Nigeria or a Nigerian city.
 */
export function relevance(job: JobPost, keywords: string[], preferredLocations: string[] = []): number {
    const title = job.title.toLowerCase();
    const body = `${job.company} ${job.rawText}`.toLowerCase();
    let score = 0;
    for (const k of keywords) {
        if (title.includes(k)) score += 3;
        else if (body.includes(k)) score += 1;
    }

    const wantsLocal = preferredLocations.some((l) => LOCAL_PREFERENCE.test(l));
    if (wantsLocal) {
        if (isNigeriaLocation(job.location)) score += 4;
        if (job.sourceCategory === 'nigerian-board') score += 2;
    }
    return score;
}

export interface DiversityOptions {
    /** No single source may supply more than this share of the selection (default 30%). */
    maxShare?: number;
}

/**
 * Pick up to `limit` jobs, best first, without letting one site dominate.
 *
 *  1. Take the best job from every source category, so breadth comes first.
 *  2. Fill the rest best-first, skipping any source already at its cap.
 *  3. Only if categories ran dry, top up from capped sources rather than return fewer jobs.
 */
export function selectDiverse(
    jobs: JobPost[],
    limit: number,
    scoreOf: (job: JobPost) => number,
    options: DiversityOptions = {}
): JobPost[] {
    const cap = Math.max(1, Math.ceil(limit * (options.maxShare ?? 0.3)));
    const ranked = jobs
        .map((job) => ({ job, score: scoreOf(job) }))
        .sort((a, b) => b.score - a.score)
        .map((x) => x.job);

    const picked: JobPost[] = [];
    const chosen = new Set<JobPost>();
    const perSource = new Map<string, number>();

    const take = (job: JobPost, enforceCap: boolean): boolean => {
        if (chosen.has(job) || picked.length >= limit) return false;
        const used = perSource.get(job.source) ?? 0;
        if (enforceCap && used >= cap) return false;
        chosen.add(job);
        picked.push(job);
        perSource.set(job.source, used + 1);
        return true;
    };

    // 1. Best job from each category.
    const seenCategory = new Set<string>();
    for (const job of ranked) {
        const category = job.sourceCategory ?? 'other';
        if (seenCategory.has(category)) continue;
        if (take(job, true)) seenCategory.add(category);
    }
    // 2. Best-first, respecting the per-source cap.
    for (const job of ranked) take(job, true);
    // 3. Top up if there was not enough variety to fill the list.
    for (const job of ranked) take(job, false);

    return picked.sort((a, b) => scoreOf(b) - scoreOf(a));
}
