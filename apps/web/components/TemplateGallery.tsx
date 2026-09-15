'use client'

import { useEffect, useRef, useState } from 'react'
import { TEMPLATES, type Template } from '@studio/project-model'
import { Icon } from './ui/Icon'
import { PushButton } from './ui/Control'

export interface TemplateGalleryProps {
  onChoose: (templateId: string) => void
  onClose: () => void
}

/**
 * "Choose a template for your new project."
 *
 * This was a `<select>` in the corner of the file list, above the words "Replaces
 * the current project." - which is a destructive action behind a control whose
 * whole affordance says it is not one. A sheet is the honest shape: it takes over,
 * it says what each option is before you pick it, and it has a Cancel button.
 *
 * Xcode shows the same thing for the same reason, and it is the one dialog in
 * Xcode everybody has seen.
 */
export function TemplateGallery({ onChoose, onClose }: TemplateGalleryProps) {
  const [selected, setSelected] = useState<string>(TEMPLATES[0]?.id ?? '')
  const panelRef = useRef<HTMLDivElement | null>(null)
  const template = TEMPLATES.find((t) => t.id === selected)

  useEffect(() => {
    panelRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[950] flex items-start justify-center bg-black/55 pt-[8vh] backdrop-blur-[2px]"
      onPointerDown={onClose}
      data-testid="template-gallery"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Choose a template"
        onPointerDown={(event) => event.stopPropagation()}
        className="flex h-[min(560px,78vh)] w-[min(760px,92vw)] flex-col overflow-hidden rounded-[10px] border border-black/60 bg-xc-bar shadow-[0_28px_80px_rgb(0_0_0/0.6)]"
      >
        <header className="shrink-0 border-b border-black/40 px-5 py-3.5">
          <h2 className="text-[13px] font-semibold text-xc-text">
            Choose a template for your new project
          </h2>
          <p className="mt-0.5 text-[11px] text-xc-text-3">
            Every template renders with nothing missing - that is the gate they have to pass
            to be in here.
          </p>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[1fr_232px]">
          <div className="min-h-0 overflow-auto p-4">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(124px,1fr))] gap-3">
              {TEMPLATES.map((item) => (
                <TemplateCard
                  key={item.id}
                  template={item}
                  selected={item.id === selected}
                  onSelect={() => setSelected(item.id)}
                  onConfirm={() => onChoose(item.id)}
                />
              ))}
            </div>
          </div>

          <aside className="min-h-0 overflow-auto border-l border-black/40 bg-black/15 p-4">
            {template ? (
              <>
                <h3 className="text-[12px] font-semibold text-xc-text">{template.name}</h3>
                <p className="mt-1.5 text-[11px] leading-relaxed text-xc-text-2">
                  {template.description}
                </p>

                <h4 className="mt-4 text-[10px] font-semibold uppercase tracking-wider text-xc-text-3">
                  {template.files.length} {template.files.length === 1 ? 'file' : 'files'}
                </h4>
                <ul className="mt-1.5 space-y-0.5">
                  {template.files.map((file) => (
                    <li
                      key={file.id}
                      className="truncate font-mono text-[10.5px] text-xc-text-3"
                      title={file.id}
                    >
                      {file.id.replace(/^Sources\//, '')}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </aside>
        </div>

        <footer className="flex shrink-0 items-center gap-2 border-t border-black/40 px-5 py-3">
          <span className="text-[11px] text-xc-text-3">
            This replaces everything currently in the project.
          </span>
          <span className="ml-auto flex items-center gap-2">
            <PushButton onClick={onClose}>Cancel</PushButton>
            <PushButton
              onClick={() => selected && onChoose(selected)}
              active
              testId="template-confirm"
            >
              Create
            </PushButton>
          </span>
        </footer>
      </div>
    </div>
  )
}

function TemplateCard({
  template,
  selected,
  onSelect,
  onConfirm,
}: {
  template: Template
  selected: boolean
  onSelect: () => void
  onConfirm: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      onDoubleClick={onConfirm}
      aria-pressed={selected}
      data-testid={`template-${template.id}`}
      className={`flex flex-col items-center gap-2 rounded-[8px] border p-3 text-center transition-colors ${
        selected
          ? 'border-xc-accent bg-xc-accent/15'
          : 'border-transparent hover:border-white/10 hover:bg-white/[0.05]'
      }`}
    >
      {/*
        A stand-in for the screen the template draws rather than a real thumbnail:
        rendering seventeen previews to make a picker would mean running the whole
        pipeline seventeen times before anyone has chosen anything.
      */}
      <span className="grid h-[52px] w-[40px] place-items-center rounded-[6px] border border-white/10 bg-gradient-to-b from-white/[0.12] to-white/[0.03]">
        <Icon name="disclosure-closed" size={14} className="text-xc-text-3" />
      </span>
      <span className="w-full truncate text-[11.5px] text-xc-text">{template.name}</span>
      {template.files.length > 1 ? (
        <span className="text-[10px] text-xc-text-3">{template.files.length} files</span>
      ) : null}
    </button>
  )
}
