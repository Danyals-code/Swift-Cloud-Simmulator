'use client'

import dynamic from 'next/dynamic'

/**
 * Client-only.
 *
 * CodeMirror and the compiler worker both need real browser globals at module
 * scope, so there is nothing meaningful to server-render here - and attempting it
 * only buys hydration mismatches. The app shell is a tool, not a document; SEO
 * lives on the marketing routes added later.
 */
const Studio = dynamic(() => import('../components/Studio').then((m) => m.Studio), {
  ssr: false,
  loading: () => (
    <main className="grid h-dvh place-items-center bg-xc-editor text-sm text-xc-text-3">
      Loading studio…
    </main>
  ),
})

export default function Page() {
  return <Studio />
}
