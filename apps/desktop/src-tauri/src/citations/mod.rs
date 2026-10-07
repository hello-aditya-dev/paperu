#![allow(warnings)]
//! Citation Studio — deterministic citation formatting (Feature 1).
//! No AI. Pure string processing. Supports APA, MLA, Chicago, Harvard, BibTeX.
//! Source types: book, journal, website, thesis, report.

use crate::database::Database;
use crate::errors::{code, AppError, ErrorCategory, ErrorSeverity, Recoverability, Result};
use rusqlite::params;
use uuid::Uuid;

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Author {
    pub last: String,
    pub first: String,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CitationEntry {
    pub id: Option<String>,
    pub source_type: String, // book|journal|website|thesis|report
    pub authors: Vec<Author>,
    pub editors: Option<Vec<Author>>,
    pub year: Option<String>,
    pub title: String,
    pub publisher: Option<String>,
    pub volume: Option<String>,
    pub issue: Option<String>,
    pub pages: Option<String>,
    pub url: Option<String>,
    pub doi: Option<String>,
    pub isbn: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedCitation {
    pub id: String,
    pub source_type: String,
    pub authors_json: String,
    pub editors_json: Option<String>,
    pub year: Option<String>,
    pub title: String,
    pub publisher: Option<String>,
    pub volume: Option<String>,
    pub issue: Option<String>,
    pub pages: Option<String>,
    pub url: Option<String>,
    pub doi: Option<String>,
    pub isbn: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Format a citation in the specified style. Deterministic, no AI.
pub fn format_citation(entry: &CitationEntry, style: &str) -> String {
    match style {
        "apa" => format_apa(entry),
        "mla" => format_mla(entry),
        "chicago" => format_chicago(entry),
        "harvard" => format_harvard(entry),
        "bibtex" => format_bibtex(entry),
        _ => format_apa(entry),
    }
}

fn format_authors_apa(authors: &[Author]) -> String {
    if authors.is_empty() {
        return String::new();
    }
    let parts: Vec<String> = authors
        .iter()
        .map(|a| format!("{}, {}.", a.last, initials(&a.first)))
        .collect();
    join_authors(&parts)
}

fn initials(first: &str) -> String {
    first
        .split_whitespace()
        .filter_map(|w| w.chars().next())
        .map(|c| format!("{}. ", c.to_uppercase()))
        .collect::<String>()
        .trim_end()
        .to_string()
}

fn join_authors(parts: &[String]) -> String {
    match parts.len() {
        0 => String::new(),
        1 => parts[0].clone(),
        2 => format!("{} & {}", parts[0], parts[1]),
        _ => {
            let last = parts.len() - 1;
            format!("{}, & {}", parts[..last].join(", "), parts[last])
        }
    }
}

fn format_apa(e: &CitationEntry) -> String {
    let authors = format_authors_apa(&e.authors);
    let year = e.year.as_deref().unwrap_or("n.d.");
    let title = &e.title;
    match e.source_type.as_str() {
        "book" => {
            let pub_ = e.publisher.as_deref().unwrap_or("");
            format!("{} ({}). {}. {}.", authors, year, title, pub_)
        }
        "journal" => {
            let vol = e.volume.as_deref().unwrap_or("");
            let issue = e
                .issue
                .as_deref()
                .map(|i| format!("({})", i))
                .unwrap_or_default();
            let pages = e.pages.as_deref().unwrap_or("");
            let doi = e
                .doi
                .as_deref()
                .map(|d| format!(" https://doi.org/{}", d))
                .unwrap_or_default();
            format!(
                "{} ({}). {}, {}{}, {}–{}.{}",
                authors, year, title, vol, issue, "", pages, doi
            )
        }
        "website" => {
            let url = e.url.as_deref().unwrap_or("");
            format!("{} ({}). {}. {}", authors, year, title, url)
        }
        _ => format!("{} ({}). {}.", authors, year, title),
    }
}

fn format_mla(e: &CitationEntry) -> String {
    let author_name = if e.authors.is_empty() {
        String::new()
    } else {
        format!("{}. ", e.authors[0].last)
    };
    let title = &e.title;
    match e.source_type.as_str() {
        "book" => {
            let pub_ = e.publisher.as_deref().unwrap_or("");
            let year = e.year.as_deref().unwrap_or("");
            format!("{}{}. {}, {}.", author_name, title, year, pub_)
        }
        "journal" => {
            let vol = e.volume.as_deref().unwrap_or("");
            let issue = e.issue.as_deref().unwrap_or("");
            let year = e.year.as_deref().unwrap_or("");
            let pages = e.pages.as_deref().unwrap_or("");
            format!(
                "{}{}. {}, vol. {}, no. {}, {}, pp. {}.",
                author_name, title, "", vol, issue, year, pages
            )
        }
        "website" => {
            let url = e.url.as_deref().unwrap_or("");
            let year = e.year.as_deref().unwrap_or("");
            format!("{}{}. {}, {}.", author_name, title, year, url)
        }
        _ => format!("{}{}.", author_name, title),
    }
}

fn format_chicago(e: &CitationEntry) -> String {
    let authors: String = e
        .authors
        .iter()
        .map(|a| format!("{} {},", a.last, a.first))
        .collect::<Vec<_>>()
        .join(" ");
    let year = e.year.as_deref().unwrap_or("");
    let title = &e.title;
    let pub_ = e.publisher.as_deref().unwrap_or("");
    format!("{} {}. {}: {}, {}.", authors, title, pub_, year, "")
}

fn format_harvard(e: &CitationEntry) -> String {
    let authors = format_authors_apa(&e.authors);
    let year = e.year.as_deref().unwrap_or("n.d.");
    let title = &e.title;
    let pub_ = e.publisher.as_deref().unwrap_or("");
    format!("{} {} {}, {}.", authors, year, title, pub_)
}

fn format_bibtex(e: &CitationEntry) -> String {
    let entry_type = match e.source_type.as_str() {
        "book" => "book",
        "journal" => "article",
        "website" => "misc",
        "thesis" => "phdthesis",
        _ => "misc",
    };
    let key = e
        .authors
        .first()
        .map(|a| a.last.to_lowercase())
        .unwrap_or_else(|| "anon".to_string())
        + e.year.as_deref().unwrap_or("nd");
    let authors_str = e
        .authors
        .iter()
        .map(|a| format!("{} {}", a.last, a.first))
        .collect::<Vec<_>>()
        .join(" and ");
    let mut out = format!("@{}{{{key},\n", entry_type);
    out.push_str(&format!("  author = {{{}}},\n", authors_str));
    if let Some(y) = &e.year {
        out.push_str(&format!("  year = {{{}}},\n", y));
    }
    out.push_str(&format!("  title = {{{}}},\n", e.title));
    if let Some(p) = &e.publisher {
        out.push_str(&format!("  publisher = {{{}}},\n", p));
    }
    if let Some(v) = &e.volume {
        out.push_str(&format!("  volume = {{{}}},\n", v));
    }
    if let Some(i) = &e.issue {
        out.push_str(&format!("  number = {{{}}},\n", i));
    }
    if let Some(p) = &e.pages {
        out.push_str(&format!("  pages = {{{}}},\n", p));
    }
    if let Some(u) = &e.url {
        out.push_str(&format!("  url = {{{}}},\n", u));
    }
    if let Some(d) = &e.doi {
        out.push_str(&format!("  doi = {{{}}},\n", d));
    }
    if let Some(i) = &e.isbn {
        out.push_str(&format!("  isbn = {{{}}},\n", i));
    }
    out.push_str("}\n");
    out
}

// ── DB operations ───────────────────────────────────────────────

pub fn save(db: &Database, entry: &CitationEntry) -> Result<SavedCitation> {
    db.with_conn(|conn| {
        let id = entry
            .id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let now = now_iso(conn)?;
        let authors_json = serde_json::to_string(&entry.authors).map_err(AppError::from)?;
        let editors_json = entry
            .editors
            .as_ref()
            .map(|e| serde_json::to_string(e).unwrap_or_default());
        conn.execute(
            "INSERT OR REPLACE INTO citation
                (id, source_type, authors, editors, year, title, publisher,
                 volume, issue, pages, url, doi, isbn, notes, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15)",
            params![
                id,
                entry.source_type,
                authors_json,
                editors_json,
                entry.year,
                entry.title,
                entry.publisher,
                entry.volume,
                entry.issue,
                entry.pages,
                entry.url,
                entry.doi,
                entry.isbn,
                entry.notes,
                now
            ],
        )
        .map_err(map_sqlite)?;
        read_row(conn, &id)
    })
}

pub fn list(db: &Database) -> Result<Vec<SavedCitation>> {
    db.with_conn(|conn| {
        let mut stmt = conn
            .prepare(
                "SELECT id, source_type, authors, editors, year, title, publisher,
                    volume, issue, pages, url, doi, isbn, notes, created_at, updated_at
             FROM citation ORDER BY created_at DESC",
            )
            .map_err(map_sqlite)?;
        let rows = stmt
            .query_map([], |r| row_to_saved(r))
            .map_err(map_sqlite)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(map_sqlite)?);
        }
        Ok(out)
    })
}

pub fn delete(db: &Database, id: &str) -> Result<()> {
    db.with_conn(|conn| {
        conn.execute("DELETE FROM citation WHERE id = ?1", params![id])
            .map_err(map_sqlite)?;
        Ok(())
    })
}

fn read_row(conn: &rusqlite::Connection, id: &str) -> Result<SavedCitation> {
    conn.query_row(
        "SELECT id, source_type, authors, editors, year, title, publisher,
                volume, issue, pages, url, doi, isbn, notes, created_at, updated_at
         FROM citation WHERE id = ?1",
        params![id],
        row_to_saved,
    )
    .map_err(map_sqlite)
}

fn row_to_saved(row: &rusqlite::Row) -> rusqlite::Result<SavedCitation> {
    Ok(SavedCitation {
        id: row.get(0)?,
        source_type: row.get(1)?,
        authors_json: row.get(2)?,
        editors_json: row.get(3)?,
        year: row.get(4)?,
        title: row.get(5)?,
        publisher: row.get(6)?,
        volume: row.get(7)?,
        issue: row.get(8)?,
        pages: row.get(9)?,
        url: row.get(10)?,
        doi: row.get(11)?,
        isbn: row.get(12)?,
        notes: row.get(13)?,
        created_at: row.get(14)?,
        updated_at: row.get(15)?,
    })
}

fn now_iso(conn: &rusqlite::Connection) -> Result<String> {
    conn.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%SZ','now')", [], |r| {
        r.get(0)
    })
    .map_err(map_sqlite)
}

fn map_sqlite(err: rusqlite::Error) -> AppError {
    AppError::builder(
        code::DATABASE_UNAVAILABLE,
        ErrorCategory::Database,
        "Paperu could not read or write citations.",
    )
    .technical(err.to_string())
    .severity(ErrorSeverity::Error)
    .recoverability(Recoverability::Retryable)
    .build()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::Database;

    fn fresh_db() -> Database {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        crate::database::migrations::run(&conn).unwrap();
        Database::from_conn(conn)
    }

    fn sample_book() -> CitationEntry {
        CitationEntry {
            id: None,
            source_type: "book".to_string(),
            authors: vec![Author {
                last: "Sharma".to_string(),
                first: "Amit".to_string(),
            }],
            editors: None,
            year: Some("2024".to_string()),
            title: "Local-First Computing".to_string(),
            publisher: Some("Paperu Press".to_string()),
            volume: None,
            issue: None,
            pages: None,
            url: None,
            doi: None,
            isbn: Some("978-3-16-148410-0".to_string()),
            notes: None,
        }
    }

    #[test]
    fn apa_book_format() {
        let e = sample_book();
        let out = format_citation(&e, "apa");
        assert!(out.contains("Sharma, A."));
        assert!(out.contains("(2024)"));
        assert!(out.contains("Local-First Computing"));
        assert!(out.contains("Paperu Press"));
    }

    #[test]
    fn mla_book_format() {
        let e = sample_book();
        let out = format_citation(&e, "mla");
        assert!(out.contains("Sharma"));
        assert!(out.contains("Local-First Computing"));
    }

    #[test]
    fn bibtex_escaping() {
        let e = CitationEntry {
            id: None,
            source_type: "book".to_string(),
            authors: vec![Author {
                last: "O'Brien".to_string(),
                first: "Sean".to_string(),
            }],
            editors: None,
            year: Some("2023".to_string()),
            title: "The {Great} Adventure".to_string(),
            publisher: None,
            volume: None,
            issue: None,
            pages: None,
            url: None,
            doi: None,
            isbn: None,
            notes: None,
        };
        let out = format_citation(&e, "bibtex");
        assert!(out.starts_with("@book{"));
        assert!(out.contains("O'Brien Sean"));
    }

    #[test]
    fn multiple_authors_apa() {
        let e = CitationEntry {
            id: None,
            source_type: "book".to_string(),
            authors: vec![
                Author {
                    last: "Sharma".to_string(),
                    first: "A".to_string(),
                },
                Author {
                    last: "Patel".to_string(),
                    first: "B".to_string(),
                },
                Author {
                    last: "Kumar".to_string(),
                    first: "C".to_string(),
                },
            ],
            editors: None,
            year: Some("2024".to_string()),
            title: "Multi".to_string(),
            publisher: None,
            volume: None,
            issue: None,
            pages: None,
            url: None,
            doi: None,
            isbn: None,
            notes: None,
        };
        let out = format_citation(&e, "apa");
        assert!(out.contains("Sharma") && out.contains("Patel") && out.contains("Kumar"));
        assert!(out.contains("&"));
    }

    #[test]
    fn save_and_list() {
        let db = fresh_db();
        let e = sample_book();
        let saved = save(&db, &e).unwrap();
        assert_eq!(saved.title, "Local-First Computing");
        let list = list(&db).unwrap();
        assert_eq!(list.len(), 1);
    }

    #[test]
    fn delete_works() {
        let db = fresh_db();
        let saved = save(&db, &sample_book()).unwrap();
        delete(&db, &saved.id).unwrap();
        assert_eq!(list(&db).unwrap().len(), 0);
    }

    #[test]
    fn unicode_names() {
        let e = CitationEntry {
            id: None,
            source_type: "book".to_string(),
            authors: vec![Author {
                last: "Müller".to_string(),
                first: "Jörg".to_string(),
            }],
            editors: None,
            year: Some("2024".to_string()),
            title: "Über Alles".to_string(),
            publisher: None,
            volume: None,
            issue: None,
            pages: None,
            url: None,
            doi: None,
            isbn: None,
            notes: None,
        };
        let out = format_citation(&e, "apa");
        assert!(out.contains("Müller"));
        assert!(out.contains("Über Alles"));
    }

    #[test]
    fn missing_optional_data() {
        let e = CitationEntry {
            id: None,
            source_type: "book".to_string(),
            authors: vec![],
            editors: None,
            year: None,
            title: "No Author".to_string(),
            publisher: None,
            volume: None,
            issue: None,
            pages: None,
            url: None,
            doi: None,
            isbn: None,
            notes: None,
        };
        let out = format_citation(&e, "apa");
        assert!(out.contains("No Author"));
        assert!(out.contains("n.d."));
    }
}
