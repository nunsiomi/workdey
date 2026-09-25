import { JobPost } from './types.js';

interface Signal {
    label: string;
    pattern: RegExp;
    strong: boolean;
}

/**
 * STRONG signals: one is enough to flag the listing (no LLM call needed).
 * WEAK signals: common in scams but also in honest small-business posts,
 * so they are only hints for the LLM (3 or more together also flags it).
 */
const SIGNALS: Signal[] = [
    // ---- STRONG ----
    {
        label: 'Asks the applicant to pay a fee',
        strong: true,
        pattern:
            /\b(registration|training|application|processing|interview|admin(?:istrative)?|onboarding|verification|documentation|clearance|starter[- ]?kit|uniform|equipment|software|background[- ]check)\s+(fee|fees|charge|charges|payment|deposit|cost)\b/i
    },
    {
        label: 'Wants a deposit or payment before you start',
        strong: true,
        pattern:
            /\brefundable\s+(deposit|fee|payment)\b|\bpay\b[^.\n]{0,30}\b(to|before)\b[^.\n]{0,30}\b(start|begin|interview|get the job|secure (?:the|your) (?:job|position|slot))/i
    },
    {
        label: 'Asks for BVN, NIN or other sensitive details up front',
        strong: true,
        pattern: /\b(BVN|NIN)\b/
    },
    {
        label: 'Asks for bank, card or ID details up front',
        strong: true,
        pattern:
            /\b(atm (?:pin|card)|card details|bank (?:login|password|details|account (?:number|details))|social security|ssn)\b/i
    },
    {
        label: 'Fake-cheque or buy-equipment-then-reimburse pattern',
        strong: true,
        pattern:
            /\b(cashier'?s?|certified) cheque?s?\b|\bwe (?:will|'ll) send you a (?:check|cheque)\b|\bpurchase\b[^.\n]{0,40}\b(equipment|laptop|gift cards?)\b[^.\n]{0,60}\b(reimburs|refund)/i
    },
    {
        label: 'Looks like MLM or an investment scheme',
        strong: true,
        pattern:
            /\b(network marketing|downline|multi[- ]level|mlm|binary options|forex signals? (?:group|vip)|crypto (?:doubling|investment)|recruit(?:ing)? (?:others|friends|members) (?:to|and) earn)\b/i
    },

    // ---- WEAK ----
    {
        label: 'Promises unrealistic earnings',
        strong: false,
        pattern:
            /\b(guaranteed (?:income|salary|earnings)|earn (?:up to )?[$₦#]?\s?\d[\d,]*\s*(?:daily|per day|a day|weekly|per week)|make [$₦]\s?\d[\d,]*\s*(?:daily|per day|a day)|easy money|get rich)\b/i
    },
    {
        label: 'Says no experience or skills are needed',
        strong: false,
        pattern: /\bno (?:experience|skills?|qualifications?) (?:needed|required|necessary)\b/i
    },
    {
        label: 'Pushes contact to WhatsApp or Telegram',
        strong: false,
        pattern:
            /\b(?:contact|dm|message|reach|apply)\b[^.\n]{0,40}\b(?:whatsapp|telegram)\b/i
    },
    {
        label: 'Uses a free email address instead of a company domain',
        strong: false,
        pattern: /[\w.+-]+@(?:gmail|yahoo|ymail|hotmail|outlook|aol)\.com/i
    },
    {
        label: 'Uses high-pressure urgency',
        strong: false,
        pattern:
            /\b(limited (?:slots|spots|vacancies)|apply (?:now|immediately)|hurry|act fast)\b/i
    }
];

/** Words shortly before a match that turn it into a reassurance, e.g. "there is NO registration fee". */
const NEGATION_BEFORE =
    /\b(no|never|without|zero|not|free of|don'?t|do not|doesn'?t|does not|won'?t|will not)\b[^.!?\n]{0,25}$/i;

function hasUnnegatedMatch(pattern: RegExp, text: string): boolean {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
    const re = new RegExp(pattern.source, flags);
    let match: RegExpExecArray | null;

    while ((match = re.exec(text)) !== null) {
        const before = text.slice(Math.max(0, match.index - 40), match.index);
        if (!NEGATION_BEFORE.test(before)) return true;
        if (match[0].length === 0) re.lastIndex++;
    }
    return false;
}

export interface ScamScan {
    strong: string[];
    weak: string[];
}

/** Scan a job post and return human-readable reasons, split into strong and weak signals. */
export function scanForScamSignals(post: JobPost): ScamScan {
    const text = `${post.title}\n${post.company}\n${post.rawText ?? ''}`;
    const result: ScamScan = { strong: [], weak: [] };

    for (const signal of SIGNALS) {
        if (hasUnnegatedMatch(signal.pattern, text)) {
            (signal.strong ? result.strong : result.weak).push(signal.label);
        }
    }
    return result;
}