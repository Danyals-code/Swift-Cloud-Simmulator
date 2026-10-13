let symbolSprite: Promise<Document> | undefined
async function inlineSymbols(root: HTMLElement) {
  for (const use of root.querySelectorAll('svg use')) {
    const href = use.getAttribute('href') ?? use.getAttribute('xlink:href') ?? ''
    if (href.startsWith('#')) continue
    const url = new URL(href, window.location.href)
    if (url.origin !== window.location.origin || url.pathname !== '/ionicons-8.0.13.svg' || !url.hash) throw new Error('This symbol cannot be embedded in the image.')
    symbolSprite ??= fetch('/ionicons-8.0.13.svg').then(async response => { if (!response.ok) throw new Error('Bundled symbols could not be loaded. Try exporting again.'); return new DOMParser().parseFromString(await response.text(), 'image/svg+xml') }).catch(error => { symbolSprite = undefined; throw error })
    const sprite = await symbolSprite, definition = sprite.getElementById(url.hash.slice(1))
    if (!definition) throw new Error('The symbol is missing from the bundled image library.')
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    for (const attr of [...use.attributes]) if (attr.name !== 'href' && attr.name !== 'xlink:href') group.setAttribute(attr.name, attr.value)
    const content = definition.cloneNode(true) as Element; content.removeAttribute('id'); group.append(content); use.replaceWith(group)
  }
}

/** Browser-only export of the actual preview DOM, including bundled image data. */
export async function capturePreview(element: HTMLElement, width: number, height: number, scale = 2): Promise<HTMLCanvasElement> {
  if (!Number.isFinite(width * height * scale) || width <= 0 || height <= 0 || width * height * scale * scale > 20_000_000) throw new Error('This preview is too large to export. Choose a smaller device.')
  await document.fonts.ready
  await Promise.all(Array.from(element.querySelectorAll('img')).map(img => img.decode()))
  const clone = element.cloneNode(true) as HTMLElement
  const sources = [element, ...element.querySelectorAll('*')], copies = [clone, ...clone.querySelectorAll('*')]
  for (let i = 0; i < sources.length; i++) {
    const source = sources[i]!, copy = copies[i]!
    if (!(copy instanceof HTMLElement || copy instanceof SVGElement)) continue
    const computed = getComputedStyle(source)
    for (const property of computed) copy.style.setProperty(property, computed.getPropertyValue(property))
    copy.style.setProperty('animation', 'none'); copy.style.setProperty('transition', 'none')
    // Snapshots must not carry scripts, links, remote requests, or stale input attributes.
    for (const attr of [...copy.attributes]) if (/^on/i.test(attr.name)) copy.removeAttribute(attr.name)
    if (source instanceof HTMLInputElement && copy instanceof HTMLInputElement) { copy.setAttribute('value', source.value); if (source.checked) copy.setAttribute('checked', ''); else copy.removeAttribute('checked') }
    if (source instanceof HTMLTextAreaElement) copy.textContent = source.value
    // An empty field shows its placeholder in the colour of a style sheet the snapshot
    // leaves out, and inherits the copied text colour, black, in its place. So the
    // snapshot draws the placeholder as the field's text, in the placeholder's colour.
    if ((source instanceof HTMLInputElement || source instanceof HTMLTextAreaElement) && !source.value && source.placeholder && copy instanceof HTMLElement) {
      const color = getComputedStyle(source, '::placeholder').color
      copy.style.setProperty('color', color); copy.style.setProperty('-webkit-text-fill-color', color)
      if (copy instanceof HTMLInputElement) copy.setAttribute('value', source.placeholder); else copy.textContent = source.placeholder
      copy.removeAttribute('placeholder')
    }
    if (source instanceof HTMLSelectElement && copy instanceof HTMLSelectElement) for (let index = 0; index < source.options.length; index++) { if (source.options[index]!.selected) copy.options[index]!.setAttribute('selected', ''); else copy.options[index]!.removeAttribute('selected') }
    if (source instanceof HTMLImageElement) { if (!source.currentSrc.startsWith('data:')) throw new Error('This image is not bundled. Import it into Project resources before exporting.'); copy.setAttribute('src', source.currentSrc) }
  }
  await inlineSymbols(clone)
  clone.querySelectorAll('style, script, link').forEach(node => node.remove())
  clone.style.transform = 'none'; clone.style.margin = '0'; clone.style.position = 'relative'; clone.style.left = '0'; clone.style.top = '0'; clone.style.width = `${width}px`; clone.style.height = `${height}px`
  const xml = new XMLSerializer().serializeToString(clone)
  // Made at the page's own size and scaled as it is drawn: WebKit ignores an SVG's scale
  // for the HTML inside a foreignObject, so an image made at twice the size came out of
  // Safari with only its top-left quarter drawn.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${xml}</foreignObject></svg>`
  const image = new Image(); image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  await image.decode()
  const canvas = document.createElement('canvas'); canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale)
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('The browser could not create an image.')
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
  return canvas
}
export function exportName(name: string) { return name.replace(/[^a-z0-9 _-]/gi, '').trim().slice(0, 100) || 'Design' }
export async function downloadPNG(canvas: HTMLCanvasElement, name: string) {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('The preview could not be converted to PNG.')), 'image/png'))
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = `${exportName(name)}.png`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export async function contactSheet(items: readonly { element: HTMLElement; name: string; width: number; height: number }[], title: string, detail: string): Promise<HTMLCanvasElement> {
  if (!items.length || items.length > 12) throw new Error('Choose between one and twelve screens for a contact sheet.')
  const columns = Math.min(3, items.length), cardWidth = 380, gap = 28, header = 100
  const contentHeight = Math.max(...items.map(i => i.height * cardWidth / i.width)), rowHeight = Math.ceil(contentHeight) + 52
  const width = gap + columns * (cardWidth + gap), height = header + Math.ceil(items.length / columns) * (rowHeight + gap)
  const scale = Math.min(2, Math.sqrt(20_000_000 / (width * height)))
  const canvas = document.createElement('canvas'); canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale)
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('The browser could not create a contact sheet.')
  ctx.scale(scale, scale); ctx.fillStyle = '#f1f3f6'; ctx.fillRect(0, 0, width, height); ctx.fillStyle = '#111827'; ctx.font = 'bold 24px system-ui'; ctx.fillText(title, gap, 38, width - 2 * gap); ctx.font = '14px system-ui'; ctx.fillText(detail, gap, 65, width - 2 * gap)
  for (let index = 0; index < items.length; index++) {
    const item = items[index]!, image = await capturePreview(item.element, item.width, item.height, 1)
    const x = gap + (index % columns) * (cardWidth + gap), y = header + Math.floor(index / columns) * (rowHeight + gap)
    ctx.drawImage(image, x, y, cardWidth, item.height * cardWidth / item.width); ctx.font = 'bold 16px system-ui'; ctx.fillText(`${index + 1}. ${item.name}`, x, y + contentHeight + 30, cardWidth)
  }
  return canvas
}
