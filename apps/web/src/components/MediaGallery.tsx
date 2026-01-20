"use client";

import { useState, useEffect, useCallback } from "react";
import { MediaUploader, MediaItem } from "./MediaUploader";
import { MediaLightbox } from "./MediaLightbox";

interface MediaGalleryProps {
  entityType: "cat" | "place" | "request";
  entityId: string;
  allowUpload?: boolean;
  maxDisplay?: number;
  showCatDescription?: boolean;
  defaultMediaType?: string;
  allowedMediaTypes?: string[];
}

export function MediaGallery({
  entityType,
  entityId,
  allowUpload = true,
  maxDisplay,
  showCatDescription = false,
  defaultMediaType,
  allowedMediaTypes,
}: MediaGalleryProps) {
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showUploader, setShowUploader] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Fetch media for this entity
  const fetchMedia = useCallback(async () => {
    if (!entityId) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/${entityType}s/${entityId}/media`);
      if (!response.ok) {
        throw new Error("Failed to fetch media");
      }
      const data = await response.json();
      setMedia(data.media || []);
    } catch (err) {
      console.error("Error fetching media:", err);
      setError("Failed to load photos");
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  useEffect(() => {
    fetchMedia();
  }, [fetchMedia]);

  // Handle upload complete
  const handleUploadComplete = (newMedia: MediaItem) => {
    setMedia((prev) => [newMedia, ...prev]);
    setShowUploader(false);
  };

  // Determine which media to display
  const displayMedia = maxDisplay ? media.slice(0, maxDisplay) : media;
  const hasMore = maxDisplay && media.length > maxDisplay;

  // Format date for display
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  // Get media type label
  const getMediaTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      cat_photo: "Cat",
      site_photo: "Site",
      evidence: "Evidence",
      document: "Doc",
      other: "Other",
    };
    return labels[type] || type;
  };

  if (loading) {
    return (
      <div style={{ padding: "1rem", textAlign: "center", color: "#6c757d" }}>
        Loading photos...
      </div>
    );
  }

  return (
    <div>
      {/* Header with Add Photo button */}
      {allowUpload && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
          <span style={{ fontWeight: 500, color: "#495057" }}>
            {media.length} {media.length === 1 ? "Photo" : "Photos"}
          </span>
          <button
            onClick={() => setShowUploader(true)}
            style={{
              padding: "0.375rem 0.75rem",
              fontSize: "0.875rem",
              background: "#0d6efd",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "0.25rem",
            }}
          >
            <span>+</span> Add Photo
          </button>
        </div>
      )}

      {/* Upload form */}
      {showUploader && (
        <div style={{ marginBottom: "1rem" }}>
          <MediaUploader
            entityType={entityType}
            entityId={entityId}
            onUploadComplete={handleUploadComplete}
            onCancel={() => setShowUploader(false)}
            showCatDescription={showCatDescription || entityType === "request"}
            defaultMediaType={defaultMediaType || (entityType === "cat" ? "cat_photo" : "site_photo")}
            allowedMediaTypes={allowedMediaTypes || ["cat_photo", "site_photo", "evidence"]}
          />
        </div>
      )}

      {/* Error state */}
      {error && (
        <div style={{
          padding: "0.5rem",
          background: "#f8d7da",
          color: "#842029",
          borderRadius: "4px",
          fontSize: "0.875rem",
          marginBottom: "0.5rem",
        }}>
          {error}
        </div>
      )}

      {/* Empty state */}
      {!showUploader && media.length === 0 && (
        <div
          onClick={() => allowUpload && setShowUploader(true)}
          style={{
            padding: "2rem",
            textAlign: "center",
            background: "#f8f9fa",
            borderRadius: "8px",
            border: "2px dashed #dee2e6",
            cursor: allowUpload ? "pointer" : "default",
          }}
        >
          <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>📷</div>
          <div style={{ color: "#6c757d" }}>
            {allowUpload ? "Click to add first photo" : "No photos yet"}
          </div>
          {allowUpload && (
            <div style={{ fontSize: "0.75rem", color: "#adb5bd", marginTop: "0.25rem" }}>
              or paste from clipboard (Cmd+V)
            </div>
          )}
        </div>
      )}

      {/* Photo grid */}
      {displayMedia.length > 0 && (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
          gap: "0.5rem",
        }}>
          {displayMedia.map((item, index) => (
            <div
              key={item.media_id}
              onClick={() => setLightboxIndex(index)}
              style={{
                position: "relative",
                aspectRatio: "1",
                borderRadius: "8px",
                overflow: "hidden",
                cursor: "pointer",
                background: "#e9ecef",
              }}
            >
              <img
                src={item.storage_path}
                alt={item.caption || item.original_filename}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                }}
                loading="lazy"
              />
              {/* Media type badge */}
              <div style={{
                position: "absolute",
                top: "4px",
                left: "4px",
                padding: "2px 6px",
                background: "rgba(0,0,0,0.6)",
                color: "white",
                fontSize: "0.625rem",
                borderRadius: "4px",
                textTransform: "uppercase",
              }}>
                {getMediaTypeLabel(item.media_type)}
              </div>
              {/* Cat description if present */}
              {item.cat_description && (
                <div style={{
                  position: "absolute",
                  bottom: "0",
                  left: "0",
                  right: "0",
                  padding: "4px 6px",
                  background: "linear-gradient(transparent, rgba(0,0,0,0.7))",
                  color: "white",
                  fontSize: "0.625rem",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}>
                  {item.cat_description}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Show more link */}
      {hasMore && (
        <div style={{ textAlign: "center", marginTop: "0.5rem" }}>
          <button
            onClick={() => {
              // Could expand to show all, or navigate to a media page
              // For now, just show all by removing maxDisplay limit
            }}
            style={{
              padding: "0.25rem 0.5rem",
              fontSize: "0.75rem",
              background: "none",
              border: "1px solid #dee2e6",
              borderRadius: "4px",
              color: "#0d6efd",
              cursor: "pointer",
            }}
          >
            View all {media.length} photos
          </button>
        </div>
      )}

      {/* Lightbox */}
      {lightboxIndex !== null && (
        <MediaLightbox
          media={media}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  );
}
