import type { JobPost, SourceReport } from '../types.js';
import { fetchJson, makeId, parseDate, rotateVariants } from './common.js';
import type { SourceOutput } from './nigerianBoards.js';

/**
 * Social-signal leads: PUBLIC posts from VERIFIED X accounts that show a hiring
 * signal or an unmet need matching the seeker's skills. Read-only.
 *
 * X is read through its official API (v2 recent search) with a bearer token the
 * user supplies. There is no login, no scraping and no page automation.
 *
 * Instagram is deliberately not read: it has no public, non-authenticated search
 * endpoint, and scraping it would break its terms of service. It is reported as
 * skipped so the gap is visible instead of silent.
 */

const CATEGORY = 'social-signal' as const;

export const HIRING_PHRASES = [
    "we're hiring",
    'now hiring',
    'join our team',
    'open role',
    'vacancy',
    'apply now',
    'DM your CV',
    'send your portfolio'
];

export const DEMAND_PHRASES = [
    'looking for someone who can',
    'does anyone know a good',
    'need help with',
    'recommend a',
    'who can build',
    'who can design',
    'who can analyse'
];

interface XTweet {
    id: string;
    text: string;
    author_id?: string;
    created_at?: string;
}
interface XUser {
    id: string;
    username: string;
    name?: string;
    verified?: boolean;
    verified_type?: string;
}
interface XResponse {
    data?: XTweet[];
    includes?: { users?: XUser[] };
}

const quote = (s: string) => `"${s.replace(/"/g, '')}"`;

/** Build a recent-search query under X's 512-character limit. */
export function buildXQuery(phrases: string[], terms: string[]): string {
    const or = (items: string[]) => `(${items.map(quote).join(' OR ')})`;
    const tail = 'is:verified -is:retweet lang:en';
    let use = terms.slice();
    let query = `${or(phrases)} ${or(use)} ${tail}`;
    while (query.length > 500 && use.length > 1) {
        use = use.slice(0, -1);
        query = `${or(phrases)} ${or(use)} ${tail}`;
    }
    return query;
}

export function tweetToLead(tweet: XTweet, user: XUser, kind: 'hiring' | 'need'): JobPost {
    const firstLine = tweet.text.replace(/\s+/g, ' ').trim();
    return {
        id: makeId('x', tweet.id),
        title: firstLine.length > 90 ? `${firstLine.slice(0, 87)}...` : firstLine,
        company: `@${user.username}${user.name ? ` (${user.name})` : ''}`,
        location: 'Not stated',
        url: `https://x.com/${user.username}/status/${tweet.id}`,
        postedAt: parseDate(tweet.created_at)?.toISOString() ?? '',
        source: 'X (social-signal)',
        sourceCategory: CATEGORY,
        postType: 'social-signal',
        verified: true,
        verifyManually: true,
        rawText:
            `[Social lead, ${kind === 'hiring' ? 'hiring signal' : 'service need'}. Verify manually before applying.]\n${ 
            `Posted by @${user.username} (verified account).\n${tweet.text}`.slice(0, 2500)}`
    };
}

async function searchX(token: string, query: string): Promise<XResponse> {
    const params = new URLSearchParams({
        query,
        max_results: '30',
        'tweet.fields': 'created_at,author_id',
        expansions: 'author_id',
        'user.fields': 'username,name,verified,verified_type'
    });
    return fetchJson<XResponse>(`https://api.twitter.com/2/tweets/search/recent?${params}`, {
        Authorization: `Bearer ${token}`
    });
}

export async function fetchSocialSignals(
    variants: string[],
    skills: string[],
    token: string | undefined
): Promise<SourceOutput> {
    const reports: SourceReport[] = [
        {
            source: 'Instagram',
            category: CATEGORY,
            reached: false,
            found: 0,
            note: 'skipped: no public unauthenticated search endpoint; scraping would breach its terms'
        }
    ];
    const xReport: SourceReport = { source: 'X (verified accounts)', category: CATEGORY, reached: false, found: 0 };
    reports.push(xReport);

    if (!token) {
        xReport.note = 'skipped: no X API bearer token supplied (input xBearerToken or env X_BEARER_TOKEN)';
        return { jobs: [], reports };
    }

    const terms = [...rotateVariants(variants, 0, 4), ...skills.slice(0, 2)];
    const jobs = new Map<string, JobPost>();
    const lower = terms.map((t) => t.toLowerCase());

    for (const [kind, phrases] of [
        ['hiring', HIRING_PHRASES],
        ['need', DEMAND_PHRASES]
    ] as const) {
        try {
            const res = await searchX(token, buildXQuery(phrases, terms));
            xReport.reached = true;
            const users = new Map((res.includes?.users ?? []).map((u) => [u.id, u]));
            for (const tweet of res.data ?? []) {
                const user = tweet.author_id ? users.get(tweet.author_id) : undefined;
                // The query asks for verified accounts, but confirm it on the returned data too.
                if (!user || !(user.verified === true || (user.verified_type && user.verified_type !== 'none'))) continue;
                const text = tweet.text.toLowerCase();
                if (!lower.some((t) => text.includes(t))) continue;
                jobs.set(tweet.id, tweetToLead(tweet, user, kind));
            }
        } catch (error) {
            // Only the status code is kept: never echo request details that could include the token.
            xReport.note = `X API request failed (${(error as Error).message})`;
        }
    }

    xReport.found = jobs.size;
    return { jobs: [...jobs.values()], reports };
}
