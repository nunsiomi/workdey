import { fetchAtsBoards } from './sources/ats.js';
import {
    canonicalUrl,
    isOffTopicTitle,
    qualityGate,
    roleKey,
    roleVariants
} from './sources/common.js';
import { fetchNigerianBoards } from './sources/nigerianBoards.js';
import { fetchOpportunityBlogs } from './sources/opportunity-blogs.js';
import { fetchRemoteBoards } from './sources/remoteBoards.js';
import { fetchSocialSignals } from './sources/social.js';
import type { JobPost, SourceCategory, SourceReport } from './types.js';

export interface IngestionOptions {
    includeDemoListings?: boolean;
    /** Drop listings older than this many days when the date is known. Default 30. */
    maxJobAgeDays?: number;
    skills?: string[];
    includeSocialSignals?: boolean;
    xBearerToken?: string;
}

export interface IngestionResult {
    jobs: JobPost[];
    reports: SourceReport[];
    /** Why candidate jobs were dropped, e.g. { "older than 30 days": 12 }. */
    dropped: Record<string, number>;
}

/**
 * Sources we cannot read compliantly. They are listed in every run report so a
 * gap is visible, never silent. Reasons were checked against the live sites.
 */
const NOT_COVERED: Omit<SourceReport, 'reached' | 'found'>[] = [
    { source: 'Upwork', category: 'gig', note: 'public RSS discontinued (HTTP 410); needs the official API' },
    { source: 'Fiverr', category: 'gig', note: 'no public listing feed; buyer requests are login-only' },
    { source: 'Contra', category: 'gig', note: 'no public API; listings are behind login' },
    { source: 'Wellfound', category: 'startup-community', note: 'login and bot protection; no public API' },
    { source: 'YC Work at a Startup', category: 'startup-community', note: 'listings require login' },
    { source: 'TechCabal Jobs', category: 'startup-community', note: 'no machine-readable listing found' },
    { source: 'Google Jobs', category: 'aggregator', note: 'JavaScript-rendered and blocks automated reads' },
    { source: 'Indeed', category: 'aggregator', note: 'terms forbid scraping; pointer-only source' },
    { source: 'LinkedIn Jobs', category: 'aggregator', note: 'terms forbid scraping; pointer-only source' },
    { source: 'Glassdoor', category: 'aggregator', note: 'terms forbid scraping; pointer-only source' }
];

/** When the same role is on several sites, keep the record closest to the employer. */
const ORIGIN_PRIORITY: Record<SourceCategory | 'other', number> = {
    ats: 0,
    'nigerian-board': 1,
    'remote-board': 2,
    'opportunity-blog': 3,
    'startup-community': 4,
    gig: 5,
    aggregator: 6,
    'social-signal': 7,
    other: 8
};

/** Remove the same opportunity found twice: same link, or same role at the same company. */
export function dedupeJobs(jobs: JobPost[]): JobPost[] {
    const ordered = [...jobs].sort(
        (a, b) =>
            ORIGIN_PRIORITY[a.sourceCategory ?? 'other'] - ORIGIN_PRIORITY[b.sourceCategory ?? 'other']
    );
    const seenUrl = new Set<string>();
    const seenRole = new Set<string>();
    const out: JobPost[] = [];

    for (const job of ordered) {
        const url = canonicalUrl(job.url);
        // Social leads have free-text titles, so only their link identifies them.
        const key = job.postType === 'social-signal' ? '' : roleKey(job);
        if (seenUrl.has(url) || (key && seenRole.has(key))) continue;
        seenUrl.add(url);
        if (key) seenRole.add(key);
        out.push(job);
    }
    return out;
}

/** Human-readable run log: reached sources per category, so a single-site collapse is obvious. */
export function formatRunReport(reports: SourceReport[]): string[] {
    const lines: string[] = [];
    const categories = [...new Set(reports.map((r) => r.category))];
    for (const category of categories) {
        const inCat = reports.filter((r) => r.category === category);
        const reached = inCat.filter((r) => r.reached).length;
        lines.push(`  [${category}] reached ${reached}/${inCat.length} sources`);
        for (const r of inCat) {
            const boards =
                r.attempted !== undefined ? ` (${r.reachedCount ?? 0}/${r.attempted} boards)` : '';
            const note = r.note ? ` - ${r.note}` : '';
            lines.push(`    ${r.reached ? 'OK  ' : 'MISS'} ${r.source}${boards}: ${r.found} matching${note}`);
        }
    }
    return lines;
}

export function countReached(reports: SourceReport[]): number {
    return reports.filter((r) => r.reached).length;
}

// ---------------------------------------------------------------------------
// Demo listings: SYNTHETIC scam examples, clearly labeled, opt-in only.
// They exist so the scam shield can be demonstrated. They are never real jobs.
// ---------------------------------------------------------------------------

function demoScamListings(targetRoles: string[]): JobPost[] {
    const role = targetRoles[0] || 'Software Engineer';
    const base = {
        location: 'Remote',
        url: 'https://apify.com/em07_adoz/workdey-career-agent',
        postedAt: new Date().toISOString(),
        source: 'Demo sample (synthetic)'
    };

    return [
        {
            ...base,
            id: 'demo-scam-fee',
            title: `${role} (Remote) - Start This Week`,
            company: 'Global Talent Hub (sample)',
            rawText:
                'We are hiring remote workers now. No experience needed. Earn $300 daily. ' +
                'Pay a refundable registration fee of $40 to secure your slot before you start. ' +
                'Contact us on WhatsApp to begin.'
        },
        {
            ...base,
            id: 'demo-scam-bvn',
            title: `${role} - Urgent Hiring in Lagos`,
            company: 'Prime Careers Ltd (sample)',
            rawText:
                'Urgent hiring in Lagos. To receive your signing bonus, send your BVN and bank account ' +
                'details to our HR on Telegram today. Limited slots available.'
        },
        {
            ...base,
            id: 'demo-scam-cheque',
            title: `Remote ${role} Assistant`,
            company: 'Northbridge Solutions (sample)',
            rawText:
                "Our client will send you a cashier's cheque to purchase your equipment and laptop " +
                'from our approved vendor. You will be reimbursed after the cheque clears. Apply now.'
        }
    ];
}

// ---------------------------------------------------------------------------
// Unified ingestion: sweep EVERY category, then gate, dedupe and report.
// ---------------------------------------------------------------------------

export async function fetchLiveJobsForRoles(
    targetRoles: string[],
    options: IngestionOptions = {}
): Promise<IngestionResult> {
    const { maxJobAgeDays = 30 } = options;
    console.log(`[WorkDey Ingestion] Sweeping all source categories for: "${targetRoles.join(', ')}"`);
    const variants = roleVariants(targetRoles);
    console.log(`[WorkDey Ingestion] Searching ${variants.length} role variants: ${variants.join(' | ')}`);

    const groups = await Promise.allSettled([
        fetchNigerianBoards(targetRoles, variants),
        fetchAtsBoards(variants),
        fetchRemoteBoards(targetRoles, variants),
        fetchOpportunityBlogs(variants),
        options.includeSocialSignals === false
            ? Promise.resolve({ jobs: [], reports: [] as SourceReport[] })
            : fetchSocialSignals(
                  variants,
                  options.skills ?? [],
                  options.xBearerToken?.trim() || process.env.X_BEARER_TOKEN?.trim() || undefined
              )
    ]);

    const collected: JobPost[] = [];
    const reports: SourceReport[] = [];
    for (const group of groups) {
        if (group.status === 'fulfilled') {
            collected.push(...group.value.jobs);
            reports.push(...group.value.reports);
        } else {
            console.error('[WorkDey Ingestion] A source group failed:', group.reason);
        }
    }
    for (const skipped of NOT_COVERED) {
        reports.push({ ...skipped, reached: false, found: 0, note: `skipped: ${skipped.note}` });
    }

    // Quality gates: real, current, and not obviously closed.
    const dropped: Record<string, number> = {};
    const gated = collected.filter((job) => {
        const reason =
            qualityGate(job, { maxAgeDays: maxJobAgeDays }) ??
            (job.postType !== 'social-signal' && isOffTopicTitle(job.title, targetRoles)
                ? 'teaching post, not the target role'
                : null);
        if (reason) dropped[reason] = (dropped[reason] ?? 0) + 1;
        return reason === null;
    });

    const unique = dedupeJobs(gated);
    const duplicates = gated.length - unique.length;
    if (duplicates > 0) dropped['duplicate across sites'] = duplicates;

    console.log('[WorkDey Ingestion] Run report (sources reached per category):');
    formatRunReport(reports).forEach((line) => console.log(line));
    console.log(
        `[WorkDey Ingestion] ${countReached(reports)} sources reached. ` +
            `${collected.length} candidates -> ${unique.length} unique jobs. Dropped: ${JSON.stringify(dropped)}`
    );

    if (options.includeDemoListings) {
        console.log('[WorkDey Ingestion] Adding 3 labeled synthetic demo listings.');
        unique.push(...demoScamListings(targetRoles));
    }

    return { jobs: unique, reports, dropped };
}
