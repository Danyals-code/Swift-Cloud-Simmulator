import type { PreviewImageAsset } from '@studio/shared'
import { previewImages } from '../../apps/web/lib/library'

/**
 * The library's images as the studio's page sends them with every compile (Wave 7b), for
 * tests that compile a template or a project that draws a library image by name. Without
 * them `Image("snowy-peak")` draws the missing-image placeholder, as a remote image would.
 */
export const libraryPreviewImages = (): PreviewImageAsset[] => previewImages({})
