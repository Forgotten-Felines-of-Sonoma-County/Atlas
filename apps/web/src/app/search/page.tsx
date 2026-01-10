"use client";

import { useState, useEffect, useCallback } from "react";

interface SearchResult {
  entity_type: string;
  entity_id: string;
  display_name: string;
  subtitle: string | null;
  match_field: string;
  match_value: string;
  rank: number;
}

interface SearchResponse {
  results: SearchResult[];
  total: number;
  limit: number;
  offset: number;
  query: string;
}

export default function SearchPage() {
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [entityType, setEntityType] = useState("");
  const [page, setPage] = useState(0);
  const limit = 25;

  const search = useCallback(async () => {
    if (!query.trim()) {
      setData(null);
      return;
    }

    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    params.set("q", query);
    if (entityType) params.set("type", entityType);
    params.set("limit", String(limit));
    params.set("offset", String(page * limit));

    try {
      const response = await fetch(`/api/search?${params.toString()}`);
      if (!response.ok) {
        throw new Error("Search failed");
      }
      const result: SearchResponse = await response.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [query, entityType, page]);

  useEffect(() => {
    if (query.trim()) {
      search();
    }
  }, [page, entityType]); // Re-search on page/type change if query exists

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(0);
    search();
  };

  const getEntityLink = (result: SearchResult) => {
    switch (result.entity_type) {
      case "cat":
        return `/cats/${result.entity_id}`;
      default:
        return null;
    }
  };

  const getEntityBadgeClass = (type: string) => {
    switch (type) {
      case "cat":
        return "badge badge-primary";
      default:
        return "badge";
    }
  };

  const totalPages = data ? Math.ceil(data.total / limit) : 0;

  return (
    <div>
      <h1 style={{ marginBottom: "1.5rem" }}>Search</h1>

      <form onSubmit={handleSubmit} className="filters">
        <input
          type="text"
          placeholder="Search cats, people, places..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ minWidth: "300px" }}
          autoFocus
        />
        <select value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(0); }}>
          <option value="">All types</option>
          <option value="cat">Cats</option>
          <option value="person">People</option>
          <option value="place">Places</option>
        </select>
        <button type="submit">Search</button>
      </form>

      {loading && <div className="loading">Searching...</div>}

      {error && <div className="empty" style={{ color: "red" }}>{error}</div>}

      {!loading && !error && data && (
        <>
          <p className="text-muted text-sm mb-4">
            Found {data.total} result{data.total !== 1 ? "s" : ""} for &ldquo;{data.query}&rdquo;
          </p>

          {data.results.length === 0 ? (
            <div className="empty">No results found</div>
          ) : (
            <>
              {data.results.map((result) => {
                const link = getEntityLink(result);
                return (
                  <div key={`${result.entity_type}-${result.entity_id}`} className="search-result">
                    <div className="search-result-header">
                      <span className={getEntityBadgeClass(result.entity_type)}>
                        {result.entity_type}
                      </span>
                      {link ? (
                        <a href={link} className="search-result-title">
                          {result.display_name}
                        </a>
                      ) : (
                        <span className="search-result-title">
                          {result.display_name}
                        </span>
                      )}
                    </div>
                    {result.subtitle && (
                      <div className="search-result-subtitle">{result.subtitle}</div>
                    )}
                    <div className="search-result-match">
                      Matched on {result.match_field}: {result.match_value}
                    </div>
                  </div>
                );
              })}

              {totalPages > 1 && (
                <div className="pagination">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                  >
                    Previous
                  </button>
                  <span className="pagination-info">
                    Page {page + 1} of {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {!loading && !error && !data && (
        <div className="empty">
          Enter a search term to find cats, people, and places
        </div>
      )}
    </div>
  );
}
