import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'SwiftUI Web Studio',
  description:
    'Write real Swift and SwiftUI in the browser, preview it live, and export an Xcode project.',
}

export const viewport: Viewport = {
  themeColor: '#0d0d10',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
