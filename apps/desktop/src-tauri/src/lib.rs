//! Paperu — Tauri 2 application library.
//!
//! This crate is the native side of Paperu. It exposes typed IPC
//! commands over a Tauri boundary, backed by a local-first filesystem
//! layer, a SQLite state store, a structured logging sink and a task
//! engine. See `docs/architecture/` for the full design.
//!
//! Product identity: "Paperu" everywhere user-facing.
//! Identifier: app.paperu.desktop
//!
//! The `tauri-runtime` feature gates the Tauri shell. Without it, the
//! core modules (errors, contracts, filesystem, database, settings,
//! tasks, logging, security, licensing) compile and test on any
//! platform — this is how CI verifies core logic without GTK deps.

#![forbid(unsafe_code)]
#![warn(clippy::all, clippy::pedantic, clippy::cargo)]
#![allow(
    clippy::module_name_repetitions,
    clippy::needless_doctest_main,
    clippy::must_use_candidate,
    clippy::doc_markdown,
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::result_large_err,
    clippy::too_many_lines,
    clippy::struct_excessive_bools,
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss,
    clippy::cast_sign_loss,
    clippy::cast_possible_wrap,
    clippy::default_trait_access,
    clippy::explicit_iter_loop,
    clippy::manual_string_new,
    clippy::redundant_closure_for_method_calls,
    clippy::unnecessary_wraps,
    clippy::if_not_else,
    clippy::semicolon_if_nothing_returned,
    clippy::match_same_arms,
    clippy::unnested_or_patterns,
    clippy::uninlined_format_args,
    clippy::assigning_clones,
    clippy::needless_pass_by_value,
    clippy::derivable_impls,
    clippy::return_self_not_must_use
)]
#![allow(clippy::multiple_crate_versions)]

pub mod analytics;
pub mod application_kit;
#[allow(clippy::all)]
pub mod archive_studio;
pub mod backup_recipes;
#[allow(clippy::all)]
pub mod citations;
pub mod clipboard_history;
pub mod commands;
pub mod contracts;
pub mod database;
#[allow(clippy::all)]
pub mod downloads_cleaner;
#[allow(clippy::all)]
pub mod duplicate_finder;
pub mod engines;
pub mod errors;
#[allow(clippy::all)]
pub mod file_rescue;
pub mod filesystem;
pub mod forms_vault;
pub mod licensing;
pub mod logging;
pub mod notes;
#[allow(clippy::all)]
pub mod organizer;
pub mod pdf_native;
pub mod product;
pub mod reading_history;
pub mod recent_work;
#[allow(clippy::all)]
pub mod rename;
pub mod security;
pub mod settings;
pub mod signature_vault;
pub mod study_packs;
pub mod tasks;
pub mod timer_jobs;
pub mod watch;

#[cfg(feature = "tauri-runtime")]
pub mod state;

// ── Tauri runtime (only compiled with the `tauri-runtime` feature) ─

#[cfg(feature = "tauri-runtime")]
mod runtime {
    use crate::state::AppState;
    use tauri::Manager;

    /// Resolve the per-user app data directory for Paperu.
    fn resolve_app_data_dir(app: &tauri::AppHandle) -> std::path::PathBuf {
        app.path()
            .app_local_data_dir()
            .unwrap_or_else(|_| std::env::temp_dir().join("paperu"))
    }

    /// Build and run the Paperu Tauri application.
    pub fn run() {
        use tauri::Emitter;
        tauri::Builder::default()
            .plugin(tauri_plugin_dialog::init())
            .plugin(tauri_plugin_window_state::Builder::default().build())
            .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
                // 90% §16-17 + P0-E: second launch — focus existing
                // window + validate + emit any file argument for the
                // frontend to stage + navigate.
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
                // If a file path was passed as an argument (Open With),
                // validate it server-side (defence in depth — the OS
                // shell hands us arbitrary strings) and only emit when
                // it passes. Invalid paths are logged + dropped (no
                // crash, no surface to the user as a broken event).
                if let Some(path) = args.iter().find(|a| !a.starts_with('-')) {
                    match crate::commands::open_with::validate_open_with_path(path) {
                        Ok(validated) => {
                            let payload = validated.to_string_lossy().into_owned();
                            let _ = app.emit("paperu://open-file", payload);
                        }
                        Err(err) => {
                            tracing::warn!(
                                error = %err,
                                raw = %path,
                                "open-with: rejected second-instance arg"
                            );
                        }
                    }
                }
            }))
            .setup(|app| {
                let app_data_dir = resolve_app_data_dir(app.handle());
                std::fs::create_dir_all(&app_data_dir).ok();

                // Initialise structured local logging (no remote logging).
                let log_dir = crate::logging::default_log_dir(&app_data_dir);
                std::fs::create_dir_all(&log_dir).ok();
                crate::logging::init(&log_dir);

                // Open / migrate the local SQLite database.
                let db_path = crate::database::default_db_path(&app_data_dir);
                let db = match crate::database::Database::open(&db_path) {
                    Ok(db) => db,
                    Err(err) => {
                        tracing::error!(error = %err, "database open failed");
                        return Err(Box::new(err) as Box<dyn std::error::Error>);
                    }
                };

                // Startup recovery: clean stale temp outputs.
                if let Ok(ws) = crate::filesystem::temp::TempWorkspace::ensure() {
                    if let Err(err) = ws.startup_cleanup() {
                        tracing::warn!(error = %err, "temp cleanup failed");
                    }
                }

                // P5: purge expired clipboard history on startup.
                // (7-day retention default; pinned entries survive.)
                if let Err(err) = crate::clipboard_history::purge_old(&db, 7) {
                    tracing::warn!(error = %err, "clipboard purge failed");
                }

                let state = AppState {
                    db: db.clone(),
                    tasks: crate::tasks::TaskRegistry::new(),
                    app_data_dir,
                    open_with_queue: std::sync::Arc::new(std::sync::Mutex::new(Vec::new())),
                };
                app.manage(state);

                // P0-E: parse the initial-launch CLI args for an Open
                // With file path. The first non-flag argument is treated
                // as a candidate file path. If it validates, push it to
                // the queue; the frontend pops it via the
                // `consume_open_with_event` command on its first ready
                // tick. Invalid paths are logged + dropped (no crash).
                //
                // Second-instance args are handled by the
                // `tauri-plugin-single-instance` callback above, which
                // emits `paperu://open-file` directly.
                if let Some(raw_arg) = std::env::args().skip(1).find(|a| !a.starts_with('-')) {
                    match crate::commands::open_with::validate_open_with_path(&raw_arg) {
                        Ok(validated) => {
                            let payload = validated.to_string_lossy().into_owned();
                            // Clone the Arc handle out of the Tauri-managed
                            // State guard (breaks the lifetime chain from
                            // `app`) + lock independently.
                            let q = app.state::<AppState>().open_with_queue.clone();
                            if let Ok(mut guard) = q.lock() {
                                guard.push(payload);
                            }
                        }
                        Err(err) => {
                            tracing::warn!(
                                error = %err,
                                raw = %raw_arg,
                                "open-with: rejected startup arg"
                            );
                        }
                    }
                }
                // Watch Folders state (notify-debouncer watcher).
                app.manage(crate::commands::watch::WatchState::default());

                // P0-02: start the Timer Jobs scheduler. Runs in a
                // background thread, ticks every 30s, dispatches due
                // backup/organizer actions independent of whether the
                // /timer route is open.
                let scheduler = crate::timer_jobs::Scheduler::production(db.clone());
                let _sched_handle = scheduler.spawn();
                // Run one immediate tick on startup so missed runs
                // (Paperu was closed during the scheduled time) are
                // dispatched on the next launch.
                let _ = crate::timer_jobs::Scheduler::production(db.clone()).tick();

                tracing::info!(version = env!("CARGO_PKG_VERSION"), "Paperu started");
                Ok(())
            })
            .invoke_handler(tauri::generate_handler![
                crate::commands::open_with::consume_open_with_event,
                crate::commands::inspect::inspect_file,
                crate::commands::finalize::finalize_output,
                crate::commands::read_file::read_file_bytes,
                crate::commands::pdf_info::pdf_page_count,
                crate::commands::shell::reveal_path,
                crate::commands::shell::open_path,
                crate::commands::settings::read_settings,
                crate::commands::settings::write_settings,
                crate::commands::read_app_info,
                crate::commands::save_as::save_file_as,
                crate::commands::application_kit::add_application_kit_item,
                crate::commands::application_kit::list_application_kit_items,
                crate::commands::application_kit::update_application_kit_item,
                crate::commands::application_kit::remove_application_kit_item,
                crate::commands::application_kit::replace_application_kit_item,
                crate::commands::notes::create_note,
                crate::commands::notes::list_notes,
                crate::commands::notes::get_note,
                crate::commands::notes::update_note,
                crate::commands::notes::soft_delete_note,
                crate::commands::notes::restore_note,
                crate::commands::notes::purge_deleted_notes,
                crate::commands::notes::create_note_folder,
                crate::commands::notes::list_note_folders,
                crate::commands::notes::search_notes,
                crate::commands::reading_history::upsert_reading_history,
                crate::commands::reading_history::get_reading_history,
                crate::commands::reading_history::list_reading_history,
                crate::commands::reading_history::remove_reading_history,
                crate::commands::reading_history::clear_reading_history,
                crate::commands::recent_work::add_recent_work,
                crate::commands::recent_work::list_recent_work,
                crate::commands::recent_work::remove_recent_work,
                crate::commands::recent_work::clear_recent_work,
                crate::commands::rename::preview_rename,
                crate::commands::rename::execute_rename,
                crate::commands::citations::save_citation,
                crate::commands::citations::list_citations,
                crate::commands::citations::delete_citation,
                crate::commands::citations::format_citation,
                crate::commands::duplicate_finder::find_exact_duplicates,
                crate::commands::downloads_cleaner::scan_downloads_folder,
                crate::commands::organizer::save_organizer_rule,
                crate::commands::organizer::list_organizer_rules,
                crate::commands::organizer::delete_organizer_rule,
                crate::commands::organizer::dry_run_organizer,
                crate::commands::organizer::execute_organizer,
                crate::commands::file_rescue::diagnose_file,
                crate::commands::archive_studio::validate_zip_entry,
                crate::commands::archive_studio::check_suspicious_ratio,
                crate::commands::archive_studio::check_destination_contained,
                crate::commands::archive_studio::list_archive,
                crate::commands::archive_studio::extract_archive,
                crate::commands::archive_studio::create_archive,
                crate::commands::pdf_native::rotate_pdf_pages,
                crate::commands::pdf_native::delete_pdf_pages,
                crate::commands::pdf_native::extract_pdf_pages,
                crate::commands::pdf_native::pdf_native_page_count,
                crate::commands::pdf_native::inspect_pdf_metadata,
                crate::commands::pdf_native::remove_pdf_metadata,
                crate::commands::pdf_native::set_pdf_page_size,
                crate::commands::pdf_native::reorder_pdf_pages,
                crate::commands::pdf_native::reverse_pdf_pages,
                crate::commands::pdf_native::crop_pdf_pages,
                crate::commands::watch::start_watch_folder,
                crate::commands::watch::stop_watch_folder,
                crate::commands::watch::current_watch_folder,
                crate::commands::signature_vault::add_signature_item,
                crate::commands::signature_vault::list_signature_items,
                crate::commands::signature_vault::update_signature_item,
                crate::commands::signature_vault::replace_signature_item,
                crate::commands::signature_vault::remove_signature_item,
                crate::commands::forms_vault::upsert_forms_field,
                crate::commands::forms_vault::list_forms_fields,
                crate::commands::forms_vault::remove_forms_field,
                crate::commands::forms_vault::clear_forms_fields,
                crate::commands::study_packs::create_study_pack,
                crate::commands::study_packs::list_study_packs,
                crate::commands::study_packs::delete_study_pack,
                crate::commands::study_packs::add_study_pack_item,
                crate::commands::study_packs::list_study_pack_items,
                crate::commands::study_packs::remove_study_pack_item,
                crate::commands::backup_recipes::create_backup_recipe,
                crate::commands::backup_recipes::list_backup_recipes,
                crate::commands::backup_recipes::delete_backup_recipe,
                crate::commands::backup_recipes::run_backup_recipe,
                crate::commands::timer_jobs::create_timer_job,
                crate::commands::timer_jobs::list_timer_jobs,
                crate::commands::timer_jobs::delete_timer_job,
                crate::commands::timer_jobs::toggle_timer_job,
                crate::commands::timer_jobs::update_timer_job,
                crate::commands::timer_jobs::get_timer_job_history,
                crate::commands::timer_jobs::trigger_timer_job_now,
                crate::commands::clipboard_history::add_clipboard_entry,
                crate::commands::clipboard_history::list_clipboard_entries,
                crate::commands::clipboard_history::set_clipboard_entry_pinned,
                crate::commands::clipboard_history::delete_clipboard_entry,
                crate::commands::clipboard_history::clear_clipboard_history,
                crate::commands::clipboard_history::clipboard_entry_count,
                crate::commands::analytics::log_analytics_event,
                crate::commands::analytics::list_analytics_events,
                crate::commands::analytics::clear_analytics_events,
                crate::commands::analytics::analytics_event_count,
                crate::commands::usb_toolbox::copy_and_verify_file,
            ])
            .run(tauri::generate_context!())
            .expect("Paperu failed to start");
    }
}

/// Build and run the Paperu desktop application.
/// Only available with the `tauri-runtime` feature.
#[cfg(feature = "tauri-runtime")]
pub fn run() {
    runtime::run();
}
