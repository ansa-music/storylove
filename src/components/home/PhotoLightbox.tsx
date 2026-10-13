import { useEffect, useRef } from 'react';

export interface LightboxPhoto {
  id: string;
  url: string;
  /** Подпись снимка («он», «она»); может быть пустой. */
  label: string;
}

interface PhotoLightboxProps {
  photos: readonly LightboxPhoto[];
  currentId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}

/**
 * Увеличенный просмотр фото поверх страницы. Закрывается крестиком, клавишей Esc
 * и нажатием мимо снимка; между двумя фото — кнопками под снимком или стрелками ← →.
 */
export function PhotoLightbox({ photos, currentId, onSelect, onClose }: PhotoLightboxProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    // Страница под окном не должна прокручиваться.
    const previous = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.documentElement.style.overflow = previous;
      if (dialog.open) dialog.close();
    };
  }, []);

  const index = photos.findIndex((item) => item.id === currentId);
  const photo = photos[index];
  if (!photo) return null;

  const step = (delta: number): void => {
    const next = photos[(index + delta + photos.length) % photos.length];
    if (next && next.id !== photo.id) onSelect(next.id);
  };

  return (
    <dialog
      ref={dialogRef}
      aria-label={photo.label ? `Фото: ${photo.label}` : 'Фото'}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // Нажатие мимо снимка и кнопок закрывает окно.
        if (event.target instanceof Element && !event.target.closest('[data-lightbox-keep]')) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') step(-1);
        if (event.key === 'ArrowRight') step(1);
      }}
      className="m-0 h-dvh max-h-none w-screen max-w-none cursor-zoom-out bg-ink-950/95 p-0 text-pearl backdrop:bg-black/80"
    >
      <div className="flex h-full flex-col items-center justify-center gap-4 px-3 py-4 sm:px-6">
        <button
          type="button"
          data-lightbox-keep
          onClick={onClose}
          aria-label="Закрыть"
          className="absolute top-3 right-3 flex size-12 items-center justify-center rounded-full border border-pearl/20 bg-ink-950/60 text-pearl transition-colors duration-300 hover:border-gold hover:text-gold-bright sm:top-5 sm:right-5"
        >
          <svg
            viewBox="0 0 24 24"
            className="size-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <path d="M5 5l14 14M19 5L5 19" strokeLinecap="round" />
          </svg>
        </button>

        {/* Снимок не растягивается больше своего размера и целиком помещается на экране. */}
        <img
          key={photo.id}
          data-lightbox-keep
          src={photo.url}
          alt={photo.label ? `Фото: ${photo.label}` : 'Фото'}
          className="h-auto max-h-[calc(100dvh-9.5rem)] w-auto max-w-full shrink-0 animate-[fade-in_0.35s_ease-out_both] cursor-default rounded-md shadow-card"
        />

        {photos.length > 1 ? (
          <div data-lightbox-keep className="flex shrink-0 cursor-default items-center gap-2">
            {photos.map((item, itemIndex) => {
              const current = item.id === photo.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={current}
                  onClick={() => onSelect(item.id)}
                  className={`label flex min-h-12 min-w-24 items-center justify-center rounded-full border px-5 text-[0.72rem] transition-colors duration-300 ${
                    current
                      ? 'border-gold bg-gold/15 text-gold-bright'
                      : 'border-pearl/20 text-pearl/85 hover:border-gold/60 hover:text-pearl'
                  }`}
                >
                  {item.label || `Фото ${String(itemIndex + 1)}`}
                </button>
              );
            })}
          </div>
        ) : (
          photo.label && (
            <p data-lightbox-keep className="shrink-0 cursor-default font-display text-2xl text-pearl italic">
              {photo.label}
            </p>
          )
        )}
      </div>
    </dialog>
  );
}
