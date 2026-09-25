export interface CandidateInput {
    fullName: string;
    email?: string;
    targetRoles: string[];
    skills?: string[];
    locations?: string[];
    preferredLocations?: string[];
    cvText: string;
    minScore?: number;
    maxPacks?: number;
    resetMemory?: boolean;
    includeDemoListings?: boolean;
    /** Ignore listings older than this many days (when the post date is known). */
    maxJobAgeDays?: number;
    /** Scan public posts from verified X accounts for hiring signals (needs a token). */
    includeSocialSignals?: boolean;
    /** Official X API v2 bearer token. Never logged. Falls back to env X_BEARER_TOKEN. */
    xBearerToken?: string;
}

export type SourceCategory =
    | 'nigerian-board'
    | 'ats'
    | 'remote-board'
    | 'opportunity-blog'
    | 'startup-community'
    | 'gig'
    | 'aggregator'
    | 'social-signal';

export interface JobPost {
    id: string;
    title: string;
    company: string;
    location: string;
    url: string;
    postedAt: string;
    source: string;
    rawText: string;
    /** Which kind of source produced this record. */
    sourceCategory?: SourceCategory;
    /** 'social-signal' records are leads, not structured job listings. */
    postType?: 'listing' | 'social-signal';
    /** Social leads only: whether the posting account is verified. */
    verified?: boolean;
    /** Social leads only: they need a human check before anyone applies. */
    verifyManually?: boolean;
}

/** One line of the run report: did we actually reach this source, and what came back. */
export interface SourceReport {
    source: string;
    category: SourceCategory;
    /** True when the source answered with usable data (even if nothing matched). */
    reached: boolean;
    /** Boards or feeds attempted / reached, for multi-board sources such as ATS lists. */
    attempted?: number;
    reachedCount?: number;
    /** Jobs that matched the target roles and passed quality gates. */
    found: number;
    note?: string;
}

export interface EvaluationResult {
    isScam: boolean;
    scamReason: string | null;
    score: number;
    fitReasons: string[];
}

export interface ApplicationPack {
    reply: string;
    coverLetter: string;
    cvTips: string[];
    /** CV facts the drafts rely on, checked against the CV text. */
    factsUsed?: string[];
}

export interface ProcessedJob extends JobPost {
    score: number;
    isScam: boolean;
    scamReason: string | null;
    fitReasons: string[];
    applicationPack?: ApplicationPack;
    status: 'MATCHED' | 'REJECTED' | 'SCAM';
    processedAt: string;
}
