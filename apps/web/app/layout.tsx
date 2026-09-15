import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

/**
 * The simulated app's typeface.
 *
 * The font stack has always named Inter first and nothing ever loaded it, so every
 * simulated iOS screen was drawn in whatever the browser fell back to - Segoe UI on
 * Windows, DejaVu Sans on most Linux. That is the single loudest "this is not an
 * Apple device" cue there is, ahead of any amount of bezel work: every glyph, every
 * advance width and every line break was the wrong typeface's.
 *
 * `-apple-system` still comes first in the stack, so a Mac or an iPad renders the
 * real SF Pro. Inter is the substitute for everyone else - the nearest widely
 * licensable face, and not a pretender: SF Pro is not redistributable to a browser
 * (risk R2), and the studio says so rather than shipping something that looks close
 * and is not.
 *
 * Self-hosted by `next/font`, so there is no request to Google when anyone opens
 * the studio and no third party learns who is using it.
 */
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-ui',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'SwiftUI Web Studio',
  description:
    'Write real Swift and SwiftUI in the browser, preview it live, and export an Xcode project.',
}

export const viewport: Viewport = {
  themeColor: '#1f1f24',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  )
}
