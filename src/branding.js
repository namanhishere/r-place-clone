import { readFile } from 'fs/promises';

function brandValues() {
    const name = process.env.BRAND_NAME || 'lẩu/Place';
    const siteUrl = process.env.BRAND_URL || '';
    const image = process.env.BRAND_IMAGE || (siteUrl ? `${siteUrl.replace(/\/$/, '')}/banner.png` : '/banner.png');
    return {
        BRAND_NAME: name,
        BRAND_NAME_LOWER: process.env.BRAND_NAME_LOWER || name.toLowerCase(),
        BRAND_ADMIN_NAME: process.env.BRAND_ADMIN_NAME || `${name} Admin`,
        BRAND_DESCRIPTION: process.env.BRAND_DESCRIPTION || 'Place thập cẩm',
        BRAND_SESSION_LABEL: process.env.BRAND_SESSION_LABEL || 'Beta Session',
        BRAND_URL: siteUrl,
        BRAND_IMAGE: image,
    };
}

function applyTokens(html, values) {
    return html.replace(/\{\{(\w+)\}\}/g, (match, token) =>
        Object.prototype.hasOwnProperty.call(values, token) ? values[token] : match
    );
}

const cache = new Map();

export async function renderTemplate(filePath) {
    let raw = cache.get(filePath);
    if (raw === undefined) {
        raw = await readFile(filePath, 'utf8');
        if (process.env.NODE_ENV === 'production') cache.set(filePath, raw);
    }
    return applyTokens(raw, brandValues());
}
