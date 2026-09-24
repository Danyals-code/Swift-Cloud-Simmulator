/** What the AI routes answer, which is for one request and never kept by a cache. */
const NO_STORE = { 'Cache-Control': 'no-store' }

/** The route's answer. */
export const answer = (body: Record<string, unknown>) => Response.json(body, { headers: NO_STORE })

/** A request the route turns down, and why, in words for the participant. */
export const fail = (error: string, status = 400) => Response.json({ error }, { status, headers: NO_STORE })

/** An answer that came back unusable: asking again may give a usable one (G2). */
export const unusable = (error: string) => Response.json({ error, retryable: true }, { status: 422, headers: NO_STORE })
