function parseAllowedOrigins() {
    return (process.env.ALLOWED_ORIGINS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}

function originAllowed(origin, hostHeader) {
    if (!origin) return true;

    const allowList = parseAllowedOrigins();
    if (allowList.includes(origin)) return true;

    if (allowList.length === 0 && hostHeader) {
        try {
            return new URL(origin).host === hostHeader;
        } catch {
            return false;
        }
    }
    return false;
}

export function requireSameOrigin(req, res, next) {
    const origin = req.headers.origin;

    if (!origin) {
        return res.status(403).json({ error: 'Missing Origin header.' });
    }
    if (!originAllowed(origin, req.headers.host)) {
        return res.status(403).json({ error: 'Cross-origin request rejected.' });
    }
    next();
}

export function verifyWsClient(info) {
    const origin = info.origin || info.req.headers.origin;
    const host = info.req.headers.host;
    return originAllowed(origin, host);
}
