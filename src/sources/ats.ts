import type { JobPost, SourceReport } from '../types.js';
import {
    fetchJson,
    htmlToText,
    isEligibleLocation,
    makeId,
    mapLimit,
    parseDate,
    titleMatchesRoles
} from './common.js';
import type { SourceOutput } from './nigerianBoards.js';

/**
 * Company career pages hosted on applicant tracking systems. These hold the
 * freshest roles, straight from the employer. Every slug below was checked
 * against the live API and returned open roles at the time of writing.
 *
 * A slug that later disappears is simply skipped, and the run report shows how
 * many boards of each ATS were actually reachable.
 *
 * To add a company: open its careers page, see which ATS it uses, then test
 *   greenhouse  https://boards-api.greenhouse.io/v1/boards/<slug>/jobs
 *   lever       https://api.lever.co/v0/postings/<slug>?mode=json
 *   ashby       https://api.ashbyhq.com/posting-api/job-board/<slug>
 *   workable    https://apply.workable.com/api/v1/widget/accounts/<slug>
 *   smartrecruiters  https://api.smartrecruiters.com/v1/companies/<slug>/postings
 *   bamboohr    https://<slug>.bamboohr.com/careers/list
 */
type Tier = 'african' | 'global';
interface Board {
    slug: string;
    tier: Tier;
}

const african = (...slugs: string[]): Board[] => slugs.map((slug) => ({ slug, tier: 'african' }));
const global = (...slugs: string[]): Board[] => slugs.map((slug) => ({ slug, tier: 'global' }));

const BOARDS = {
    Greenhouse: [
        ...african('moniepoint', 'carbon', 'jumia', 'grey', 'luno', 'branch'),
        ...global(
            'turing', 'gitlab', 'canonical', 'mozilla', 'elastic', 'cloudflare', 'datadog', 'mongodb',
            'twilio', 'vercel', 'duolingo', 'figma', 'gusto', 'brex', 'mercury', 'payoneer', 'wise',
            'monzo', 'givedirectly', 'givewell', 'wikimedia', 'webflow', 'stripe', 'airbnb', 'coursera',
            'lattice'
        )
    ],
    Lever: [...african('tala')],
    Ashby: [
        ...african('andela', 'lemfi'),
        ...global('zapier', 'notion', 'sentry', 'oyster', '1password', 'supabase', 'posthog', 'ramp', 'lumos', 'buffer')
    ],
    Workable: [...african('kuda', 'fairmoney')],
    SmartRecruiters: [...african('raenest', 'palmpay'), ...global('wise')],
    BambooHR: [
        ...african('chowdeck', 'cellulant', 'trove', 'yellowcard', 'paga', 'risevest'),
        ...global('givedirectly', 'coursera')
    ]
} as const;

type AtsName = keyof typeof BOARDS;

/** How many matching jobs per board we fetch full descriptions for. */
const DETAIL_LIMIT = 4;

const prettyCompany = (slug: string) =>
    slug.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

interface BoardResult {
    reached: boolean;
    jobs: JobPost[];
}

function base(
    ats: AtsName,
    slug: string,
    nativeId: string | number
): Pick<JobPost, 'id' | 'source' | 'sourceCategory' | 'postType' | 'company'> {
    return {
        id: makeId(`${ats}-${slug}`, String(nativeId)),
        source: ats,
        sourceCategory: 'ats',
        postType: 'listing',
        company: prettyCompany(slug)
    };
}

// ---------------------------------------------------------------------------
// One adapter per ATS. Each returns only jobs whose title matches the roles.
// ---------------------------------------------------------------------------

async function greenhouse(slug: string, variants: string[]): Promise<BoardResult> {
    interface Item {
        id: number;
        title: string;
        updated_at?: string;
        first_published?: string;
        absolute_url: string;
        company_name?: string;
        location?: { name?: string };
    }
    const data = await fetchJson<{ jobs?: Item[] }>(
        `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`
    );
    if (!Array.isArray(data.jobs)) return { reached: false, jobs: [] };

    const matches = data.jobs
        .filter((j) => titleMatchesRoles(j.title, variants))
        .filter((j) => isEligibleLocation(j.location?.name ?? ''));

    const jobs = await mapLimit(matches, 3, async (j, index) => {
        let text = '';
        if (index < DETAIL_LIMIT) {
            try {
                const d = await fetchJson<{ content?: string }>(
                    `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs/${j.id}`
                );
                text = htmlToText(d.content ?? '');
            } catch {
                // fall back to the summary line
            }
        }
        const location = j.location?.name || 'Not stated';
        return {
            ...base('Greenhouse', slug, j.id),
            company: j.company_name || prettyCompany(slug),
            title: j.title,
            location,
            url: j.absolute_url,
            postedAt: parseDate(j.first_published ?? j.updated_at)?.toISOString() ?? '',
            rawText: (text || `Position: ${j.title} at ${j.company_name ?? slug}. Location: ${location}.`).slice(0, 2500)
        } satisfies JobPost;
    });
    return { reached: true, jobs };
}

async function lever(slug: string, variants: string[]): Promise<BoardResult> {
    interface Item {
        id: string;
        text: string;
        hostedUrl: string;
        createdAt?: number;
        categories?: { location?: string; allLocations?: string[]; commitment?: string };
        workplaceType?: string;
        descriptionPlain?: string;
        additionalPlain?: string;
    }
    const data = await fetchJson<Item[]>(`https://api.lever.co/v0/postings/${slug}?mode=json`);
    if (!Array.isArray(data)) return { reached: false, jobs: [] };

    const jobs = data
        .filter((j) => titleMatchesRoles(j.text, variants))
        .filter((j) => {
            const places = [j.categories?.location ?? '', ...(j.categories?.allLocations ?? [])];
            // A remote role is only open to us when its stated region does not exclude Nigeria.
            const prefix = j.workplaceType === 'remote' ? 'Remote ' : '';
            return places.some((p) => isEligibleLocation(`${prefix}${p}`.trim()));
        })
        .map((j) => ({
            ...base('Lever', slug, j.id),
            title: j.text,
            location: j.categories?.location || j.workplaceType || 'Not stated',
            url: j.hostedUrl,
            postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : '',
            rawText: `${j.descriptionPlain ?? ''}\n${j.additionalPlain ?? ''}`.trim().slice(0, 2500)
        }));
    return { reached: true, jobs };
}

async function ashby(slug: string, variants: string[]): Promise<BoardResult> {
    interface Item {
        id: string;
        title: string;
        location?: string;
        secondaryLocations?: { location?: string }[];
        isRemote?: boolean;
        isListed?: boolean;
        publishedAt?: string;
        jobUrl: string;
        descriptionPlain?: string;
    }
    const data = await fetchJson<{ jobs?: Item[] }>(
        `https://api.ashbyhq.com/posting-api/job-board/${slug}`
    );
    if (!Array.isArray(data.jobs)) return { reached: false, jobs: [] };

    const jobs = data.jobs
        .filter((j) => j.isListed !== false && titleMatchesRoles(j.title, variants))
        .filter((j) => {
            const places = [j.location ?? '', ...(j.secondaryLocations ?? []).map((s) => s.location ?? '')];
            return places.some(isEligibleLocation) || (j.isRemote === true && !j.location);
        })
        .map((j) => ({
            ...base('Ashby', slug, j.id),
            title: j.title.trim(),
            location: j.location || (j.isRemote ? 'Remote' : 'Not stated'),
            url: j.jobUrl,
            postedAt: parseDate(j.publishedAt)?.toISOString() ?? '',
            rawText: (j.descriptionPlain ?? '').slice(0, 2500)
        }));
    return { reached: true, jobs };
}

async function workable(slug: string, variants: string[]): Promise<BoardResult> {
    interface Item {
        title: string;
        shortcode?: string;
        url?: string;
        shortlink?: string;
        city?: string;
        state?: string;
        country?: string;
        telecommuting?: boolean;
        published_on?: string;
        created_at?: string;
        description?: string;
        employment_type?: string;
        department?: string;
    }
    const data = await fetchJson<{ jobs?: Item[] }>(
        `https://apply.workable.com/api/v1/widget/accounts/${slug}?details=true`
    );
    if (!Array.isArray(data.jobs)) return { reached: false, jobs: [] };

    const jobs = data.jobs
        .filter((j) => titleMatchesRoles(j.title, variants))
        .map((j) => {
            const place = [j.city, j.state, j.country].filter(Boolean).join(', ');
            return { j, place: j.telecommuting ? `Remote ${place}`.trim() : place };
        })
        .filter(({ place }) => isEligibleLocation(place))
        .map(({ j, place }) => ({
            ...base('Workable', slug, j.shortcode ?? j.title),
            title: j.title,
            location: place || 'Not stated',
            url: j.url || j.shortlink || `https://apply.workable.com/${slug}/`,
            postedAt: parseDate(j.published_on ?? j.created_at)?.toISOString() ?? '',
            rawText: (
                htmlToText(j.description ?? '') ||
                `Position: ${j.title}. Department: ${j.department ?? 'n/a'}. Type: ${j.employment_type ?? 'n/a'}.`
            ).slice(0, 2500)
        }));
    return { reached: true, jobs };
}

async function smartRecruiters(slug: string, variants: string[]): Promise<BoardResult> {
    interface Item {
        id: string;
        name: string;
        releasedDate?: string;
        location?: { city?: string; country?: string; remote?: boolean; fullLocation?: string };
        function?: { label?: string };
        typeOfEmployment?: { label?: string };
        ref?: string;
    }
    const data = await fetchJson<{ content?: Item[] }>(
        `https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=100`
    );
    if (!Array.isArray(data.content)) return { reached: false, jobs: [] };

    const matches = data.content
        .filter((j) => titleMatchesRoles(j.name, variants))
        .filter((j) => {
            const l = j.location;
            const place = `${l?.city ?? ''} ${l?.country ?? ''} ${l?.remote ? 'Remote' : ''}`;
            // SmartRecruiters reports country "xx" (OTHER) for open remote roles.
            return isEligibleLocation(place) || (l?.remote === true && (l.country ?? '') === 'xx');
        });

    const jobs = await mapLimit(matches, 3, async (j, index) => {
        let text = '';
        if (index < DETAIL_LIMIT && j.ref) {
            try {
                const d = await fetchJson<{
                    jobAd?: { sections?: Record<string, { text?: string } | undefined> };
                }>(j.ref);
                const s = d.jobAd?.sections ?? {};
                text = htmlToText(
                    [s.jobDescription?.text, s.qualifications?.text, s.additionalInformation?.text]
                        .filter(Boolean)
                        .join('\n')
                );
            } catch {
                // fall back to the summary
            }
        }
        const place = j.location?.fullLocation || j.location?.city || 'Not stated';
        return {
            ...base('SmartRecruiters', slug, j.id),
            title: j.name,
            location: place,
            url: `https://jobs.smartrecruiters.com/${slug}/${j.id}`,
            postedAt: parseDate(j.releasedDate)?.toISOString() ?? '',
            rawText: (
                text ||
                `Position: ${j.name}. Function: ${j.function?.label ?? 'n/a'}. Type: ${j.typeOfEmployment?.label ?? 'n/a'}. Location: ${place}.`
            ).slice(0, 2500)
        } satisfies JobPost;
    });
    return { reached: true, jobs };
}

async function bamboo(slug: string, variants: string[]): Promise<BoardResult> {
    interface Item {
        id: string | number;
        jobOpeningName: string;
        departmentLabel?: string;
        employmentStatusLabel?: string;
        location?: { city?: string; state?: string };
        atsLocation?: { country?: string; city?: string; state?: string };
        isRemote?: boolean | null;
        locationType?: string;
    }
    const data = await fetchJson<{ result?: Item[] }>(`https://${slug}.bamboohr.com/careers/list`);
    if (!Array.isArray(data.result)) return { reached: false, jobs: [] };

    const matches = data.result
        .filter((j) => titleMatchesRoles(j.jobOpeningName, variants))
        .map((j) => {
            const l = j.atsLocation ?? j.location ?? {};
            const country = j.atsLocation?.country ?? '';
            const place = [l.city, l.state, country].filter(Boolean).join(', ');
            return { j, place: j.isRemote ? `Remote ${place}`.trim() : place };
        })
        .filter(({ place }) => isEligibleLocation(place));

    const jobs = await mapLimit(matches, 3, async ({ j, place }, index) => {
        let text = '';
        let datePosted: string | undefined;
        if (index < DETAIL_LIMIT) {
            try {
                const d = await fetchJson<{ result?: { jobOpening?: { description?: string; datePosted?: string } } }>(
                    `https://${slug}.bamboohr.com/careers/${j.id}/detail`
                );
                text = htmlToText(d.result?.jobOpening?.description ?? '');
                datePosted = d.result?.jobOpening?.datePosted;
            } catch {
                // fall back to the summary
            }
        }
        return {
            ...base('BambooHR', slug, j.id),
            title: j.jobOpeningName,
            location: place || 'Not stated',
            url: `https://${slug}.bamboohr.com/careers/${j.id}`,
            postedAt: parseDate(datePosted)?.toISOString() ?? '',
            rawText: (
                text ||
                `Position: ${j.jobOpeningName} at ${prettyCompany(slug)}. Department: ${j.departmentLabel ?? 'n/a'}. ` +
                    `Type: ${j.employmentStatusLabel ?? 'n/a'}. Location: ${place || 'n/a'}.`
            ).slice(0, 2500)
        } satisfies JobPost;
    });
    return { reached: true, jobs };
}

const ADAPTERS: Record<AtsName, (slug: string, variants: string[]) => Promise<BoardResult>> = {
    Greenhouse: greenhouse,
    Lever: lever,
    Ashby: ashby,
    Workable: workable,
    SmartRecruiters: smartRecruiters,
    BambooHR: bamboo
};

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function fetchAtsBoards(variants: string[]): Promise<SourceOutput> {
    const tasks = (Object.keys(BOARDS) as AtsName[]).flatMap((ats) =>
        BOARDS[ats].map((board) => ({ ats, board }))
    );

    const reports = new Map<AtsName, SourceReport>(
        (Object.keys(BOARDS) as AtsName[]).map((ats) => [
            ats,
            {
                source: ats,
                category: 'ats',
                reached: false,
                attempted: BOARDS[ats].length,
                reachedCount: 0,
                found: 0
            }
        ])
    );
    const jobs: JobPost[] = [];

    await mapLimit(tasks, 8, async ({ ats, board }) => {
        const report = reports.get(ats)!;
        try {
            const result = await ADAPTERS[ats](board.slug, variants);
            if (result.reached) report.reachedCount!++;
            report.found += result.jobs.length;
            jobs.push(...result.jobs);
        } catch {
            // Board gone, rate limited or blocked: reflected in reachedCount.
        }
    });

    for (const report of reports.values()) report.reached = (report.reachedCount ?? 0) > 0;
    return { jobs, reports: [...reports.values()] };
}
