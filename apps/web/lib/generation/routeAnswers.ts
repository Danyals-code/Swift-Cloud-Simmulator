/** What the AI routes answer, which is for one request and never kept by a cache. */
const NO_STORE = { 'Cache-Control': 'no-store' }

/** The route's answer. */
export const answer = (body: Record<string, unknown>) => Response.json(body, { headers: NO_STORE })

/** A request the route turns down, and why, in words for the participant. */
export const fail = (error: string, status = 400) => Response.json({ error }, { status, headers: NO_STORE })

/** An answer that came back unusable: asking again may give a usable one (G2). */
export const unusable = (error: string) => Response.json({ error, retryable: true }, { status: 422, headers: NO_STORE })

/**
 * Whether a request comes from the studio's own page, the only one that may spend a
 * key here (G4). Browsers send Origin with every POST, so a request without one is not
 * the studio's.
 */
export const fromTheStudio = (request: Request) => request.headers.get('origin') === new URL(request.url).origin
