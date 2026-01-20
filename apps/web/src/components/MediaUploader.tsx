"use client";

import { useState, useRef, useEffect, useCallback } from "react";

export interface MediaItem {
  media_id: string;
  media_type: string;
  original_filename: string;
  storage_path: string;
  caption: string | null;
  cat_description: string | null;
  uploaded_by: string;
  uploaded_at: string;
}

interface MediaUploaderProps {
  entityType: "cat" | "place" | "request";
  entityId: string;
  onUploadComplete?: (media: MediaItem) => void;
  onCancel?: () => void;
  allowedMediaTypes?: string[];
  showCatDescription?: boolean;
  defaultMediaType?: string;
}

export function MediaUploader({
  entityType,
  entityId,
  onUploadComplete,
  onCancel,
  allowedMediaTypes = ["cat_photo", "site_photo", "evidence"],
  showCatDescription = false,
  defaultMediaType = "site_photo",
}: MediaUploaderProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState(defaultMediaType);
  const [caption, setCaption] = useState("");
  const [catDescription, setCatDescription] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  // Handle file selection
  const handleFileSelect = useCallback((file: File) => {
    if (!file.type.startsWith("image/") && !file.type.startsWith("application/pdf")) {
      setError("Please select an image or PDF file");
      return;
    }

    setSelectedFile(file);
    setError(null);

    // Generate preview for images
    if (file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (e) => setPreviewUrl(e.target?.result as string);
      reader.readAsDataURL(file);
    } else {
      setPreviewUrl(null);
    }
  }, []);

  // Handle paste from clipboard (Cmd+V / Ctrl+V)
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            // Create a named file since clipboard files don't have names
            const namedFile = new File([file], `pasted-image-${Date.now()}.png`, {
              type: file.type,
            });
            handleFileSelect(namedFile);
          }
          break;
        }
      }
    };

    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [handleFileSelect]);

  // Handle drag and drop
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  // Handle upload
  const handleUpload = async () => {
    if (!selectedFile) return;

    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("entity_type", entityType);
      formData.append("entity_id", entityId);
      formData.append("media_type", mediaType);
      if (caption) formData.append("caption", caption);
      if (catDescription) formData.append("cat_description", catDescription);
      formData.append("uploaded_by", "app_user");

      const response = await fetch("/api/media/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Upload failed");
      }

      const result = await response.json();

      // Construct media item for callback
      const mediaItem: MediaItem = {
        media_id: result.media_id,
        media_type: mediaType,
        original_filename: selectedFile.name,
        storage_path: result.storage_path,
        caption: caption || null,
        cat_description: catDescription || null,
        uploaded_by: "app_user",
        uploaded_at: new Date().toISOString(),
      };

      // Reset form
      setSelectedFile(null);
      setPreviewUrl(null);
      setCaption("");
      setCatDescription("");
      if (fileInputRef.current) fileInputRef.current.value = "";

      onUploadComplete?.(mediaItem);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const mediaTypeLabels: Record<string, string> = {
    cat_photo: "Cat Photo",
    site_photo: "Site Photo",
    evidence: "Evidence",
    document: "Document",
    other: "Other",
  };

  return (
    <div style={{
      background: "#f8f9fa",
      borderRadius: "8px",
      padding: "1rem",
      border: "1px solid #dee2e6",
    }}>
      {/* Drop zone */}
      <div
        ref={dropZoneRef}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${isDragging ? "#0d6efd" : "#adb5bd"}`,
          borderRadius: "8px",
          padding: "2rem",
          textAlign: "center",
          cursor: "pointer",
          background: isDragging ? "#e7f1ff" : "white",
          transition: "all 0.2s ease",
          marginBottom: "1rem",
        }}
      >
        {previewUrl ? (
          <div>
            <img
              src={previewUrl}
              alt="Preview"
              style={{
                maxWidth: "200px",
                maxHeight: "200px",
                borderRadius: "4px",
                marginBottom: "0.5rem",
              }}
            />
            <div style={{ fontSize: "0.875rem", color: "#495057" }}>
              {selectedFile?.name}
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setSelectedFile(null);
                setPreviewUrl(null);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
              style={{
                marginTop: "0.5rem",
                padding: "0.25rem 0.5rem",
                fontSize: "0.75rem",
                background: "#dc3545",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              Remove
            </button>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>📷</div>
            <div style={{ fontWeight: 500, marginBottom: "0.25rem" }}>
              Drop image here, click to select, or paste (Cmd+V)
            </div>
            <div style={{ fontSize: "0.875rem", color: "#6c757d" }}>
              Supports JPG, PNG, GIF, WebP, HEIC
            </div>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.pdf"
          onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
          style={{ display: "none" }}
        />
      </div>

      {/* Media type selector */}
      {allowedMediaTypes.length > 1 && (
        <div style={{ marginBottom: "1rem" }}>
          <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.875rem", fontWeight: 500 }}>
            Photo Type
          </label>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {allowedMediaTypes.map((type) => (
              <button
                key={type}
                onClick={() => setMediaType(type)}
                style={{
                  padding: "0.375rem 0.75rem",
                  fontSize: "0.875rem",
                  border: "1px solid",
                  borderColor: mediaType === type ? "#0d6efd" : "#dee2e6",
                  borderRadius: "4px",
                  background: mediaType === type ? "#0d6efd" : "white",
                  color: mediaType === type ? "white" : "#495057",
                  cursor: "pointer",
                }}
              >
                {mediaTypeLabels[type] || type}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Cat description (for pre-identification) */}
      {(showCatDescription || mediaType === "cat_photo") && (
        <div style={{ marginBottom: "1rem" }}>
          <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.875rem", fontWeight: 500 }}>
            Cat Description (optional)
          </label>
          <input
            type="text"
            value={catDescription}
            onChange={(e) => setCatDescription(e.target.value)}
            placeholder="e.g., orange tabby, black male, calico female"
            style={{
              width: "100%",
              padding: "0.5rem",
              border: "1px solid #dee2e6",
              borderRadius: "4px",
              fontSize: "0.875rem",
            }}
          />
          <div style={{ fontSize: "0.75rem", color: "#6c757d", marginTop: "0.25rem" }}>
            Helps identify the cat later when microchip is known
          </div>
        </div>
      )}

      {/* Caption */}
      <div style={{ marginBottom: "1rem" }}>
        <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.875rem", fontWeight: 500 }}>
          Caption (optional)
        </label>
        <input
          type="text"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Add a description..."
          style={{
            width: "100%",
            padding: "0.5rem",
            border: "1px solid #dee2e6",
            borderRadius: "4px",
            fontSize: "0.875rem",
          }}
        />
      </div>

      {/* Error message */}
      {error && (
        <div style={{
          padding: "0.5rem",
          marginBottom: "1rem",
          background: "#f8d7da",
          color: "#842029",
          borderRadius: "4px",
          fontSize: "0.875rem",
        }}>
          {error}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
        {onCancel && (
          <button
            onClick={onCancel}
            disabled={uploading}
            style={{
              padding: "0.5rem 1rem",
              background: "#6c757d",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: uploading ? "not-allowed" : "pointer",
              opacity: uploading ? 0.7 : 1,
            }}
          >
            Cancel
          </button>
        )}
        <button
          onClick={handleUpload}
          disabled={!selectedFile || uploading}
          style={{
            padding: "0.5rem 1rem",
            background: !selectedFile || uploading ? "#6c757d" : "#0d6efd",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: !selectedFile || uploading ? "not-allowed" : "pointer",
          }}
        >
          {uploading ? "Uploading..." : "Upload"}
        </button>
      </div>
    </div>
  );
}
