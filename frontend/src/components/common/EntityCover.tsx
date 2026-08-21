"use client";

import React, { useState } from "react";
import { ProceduralCover } from "./ProceduralCover";

interface EntityCoverProps {
  src?: string | null;
  alt?: string;
  title?: string;
  originalTitle?: string;
  mediaType?: string;
  id?: string;
  className?: string;
  imgClassName?: string;
  loading?: "lazy" | "eager";
}

export function EntityCover({
  src,
  alt = "",
  title = "Untitled",
  originalTitle,
  mediaType = "movie",
  id = "",
  className = "",
  imgClassName = "w-full h-full object-cover",
  loading = "lazy",
}: EntityCoverProps) {
  const [hasError, setHasError] = useState(false);

  if (!src || hasError) {
    return (
      <ProceduralCover
        title={title}
        originalTitle={originalTitle}
        mediaType={mediaType}
        id={id}
        className={className}
      />
    );
  }

  return (
    <img
      src={src}
      alt={alt || title}
      className={imgClassName}
      loading={loading}
      onError={() => setHasError(true)}
    />
  );
}
