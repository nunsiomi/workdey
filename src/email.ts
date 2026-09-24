import { Actor } from 'apify';

export async function sendApplicationEmail(
    email: string,
    subject: string,
    html: string
): Promise<void> {
    await Actor.call('apify/send-mail', {
        to: email,
        subject,
        html
    });
}