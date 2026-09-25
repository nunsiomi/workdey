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
}

export interface JobPost {
    id: string;
    title: string;
    company: string;
    location: string;
    url: string;
    postedAt: string;
    source: string;
    rawText: string;
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