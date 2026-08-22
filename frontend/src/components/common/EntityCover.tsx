"use client";

import React, { useState } from "react";
import { ProceduralCover } from "./ProceduralCover";

interface EntityCoverProps {
  src?: string | null;
  alt?: string;
  title?: string;
  originalTitle?: string;
  id?: string;
  className?: string;
  imgClassName?: string;
  loading?: "lazy" | "eager";
  onLoad?: (e: React.SyntheticEvent<HTMLImageElement>) => void;
}

export function EntityCover({
  src,
  alt = "",
  title = "Untitled",
  originalTitle,
  id = "",
  className = "",
  imgClassName,
  loading = "lazy",
  onLoad,
}: EntityCoverProps) {
  const [hasError, setHasError] = useState(false);

  if (!src || hasError) {
    return (
      <ProceduralCover
        title={title}
        originalTitle={originalTitle}
        id={id}
        className={className}
      />
    );
  }

  return (
    <img
      src={src}
      alt={alt || title}
      className={imgClassName ?? "w-full h-full object-cover"}
      loading={loading}
      onError={() => setHasError(true)}
      onLoad={onLoad}
    />
  );
}
