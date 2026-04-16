import { useState } from 'react';
import { cn } from '@/lib/utils';

type GalleryImage = {
  src: string;
  alt: string;
};

type ProductImageGalleryProps = {
  images: GalleryImage[];
  className?: string;
};

export function ProductImageGallery({ images, className }: ProductImageGalleryProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  if (images.length === 0) {
    return null;
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div className="aspect-square overflow-hidden rounded-2xl bg-muted shadow-elevated-lg">
        <img
          src={images[activeIndex].src}
          alt={images[activeIndex].alt}
          decoding="async"
          className="h-full w-full object-contain p-3"
        />
      </div>
      {images.length > 1 && (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
          {images.map((image, index) => (
            <button
              key={image.src}
              type="button"
              onClick={() => setActiveIndex(index)}
              aria-label={`View image ${index + 1}: ${image.alt}`}
              aria-current={index === activeIndex ? 'true' : undefined}
              className={cn(
                'aspect-square overflow-hidden rounded-md border bg-muted transition-colors',
                index === activeIndex ? 'border-primary ring-1 ring-primary/30' : 'border-border hover:border-primary/40'
              )}
            >
              <img
                src={image.src}
                alt={image.alt}
                loading="lazy"
                decoding="async"
                className="h-full w-full object-contain p-1"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
