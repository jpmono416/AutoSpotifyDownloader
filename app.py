#!/usr/bin/env python3
"""
Desktop GUI application for Spotify to YouTube sync and download.
"""

import tkinter as tk
import tkinter.font as tkfont
from tkinter import scrolledtext, messagebox
import threading
import json
from pathlib import Path
from datetime import datetime

from spotify_to_youtube_sync import (
    sync_playlists,
    extract_spotify_playlist_id,
    extract_youtube_playlist_id,
    get_spotify_playlist_name,
    load_playlists,
    save_playlists,
    add_playlist_to_config,
    remove_playlists_from_config
)
from download_playlists import download_playlists, DOWNLOAD_LOG_FILE

_PROJECT_DIR = Path(__file__).resolve().parent

# Dark UI palette (GitHub-inspired)
_UI = {
    "bg": "#0d1117",
    "surface": "#161b22",
    "surface_2": "#21262d",
    "border": "#30363d",
    "text": "#e6edf3",
    "muted": "#8b949e",
    "accent_sync": "#238636",
    "accent_sync_hover": "#2ea043",
    "accent_download": "#1f6feb",
    "accent_download_hover": "#388bfd",
    "accent_stop": "#da3633",
    "accent_stop_hover": "#f85149",
    "accent_secondary": "#8957e5",
    "accent_secondary_hover": "#a371f7",
    "log_bg": "#010409",
    "log_fg": "#c9d1d9",
    "disabled_fg": "#6e7681",
}


class _RoundedButton(tk.Canvas):
    """Rounded control: muted fill + accent outline idle; fill and border strengthen on hover."""

    def __init__(
        self,
        parent,
        *,
        text,
        command,
        font,
        padx,
        pady,
        canvas_bg,
        idle,
        hover,
        disabled,
        radius=10,
    ):
        super().__init__(
            parent,
            highlightthickness=0,
            bd=0,
            bg=canvas_bg,
            cursor="hand2",
        )
        self._text = text
        self._command = command
        self._font = font
        self._padx = padx
        self._pady = pady
        self._radius = radius
        self._idle = idle
        self._hover_pal = hover
        self._disabled = disabled
        self._hovering = False
        self._enabled = True

        top = parent.winfo_toplevel()
        family, size = font[0], font[1]
        weight = "bold" if len(font) > 2 and font[2] == "bold" else "normal"
        self._meas_font = tkfont.Font(root=top, family=family, size=abs(size), weight=weight)

        tw = self._meas_font.measure(text) + 2 * padx + 10
        lh = self._meas_font.metrics("linespace")
        th = lh + 2 * pady + 10
        self.configure(width=max(int(tw), 44), height=max(int(th), 28))

        self.bind("<Enter>", self._on_enter)
        self.bind("<Leave>", self._on_leave)
        self.bind("<Button-1>", self._on_click)
        self._redraw()

    @staticmethod
    def _rounded_polygon_points(x1, y1, x2, y2, r):
        r = min(max(2, r), (x2 - x1) // 2, (y2 - y1) // 2, 20)
        return [
            x1 + r,
            y1,
            x2 - r,
            y1,
            x2,
            y1,
            x2,
            y1 + r,
            x2,
            y2 - r,
            x2,
            y2,
            x2 - r,
            y2,
            x1 + r,
            y2,
            x1,
            y2,
            x1,
            y2 - r,
            x1,
            y1 + r,
            x1,
            y1,
        ]

    def _active_palette(self):
        if not self._enabled:
            return self._disabled
        return self._hover_pal if self._hovering else self._idle

    def _redraw(self):
        self.delete("all")
        w = int(self.cget("width"))
        h = int(self.cget("height"))
        inset = 3
        x1, y1, x2, y2 = inset, inset, w - inset, h - inset
        pal = self._active_palette()
        ow = pal.get("outline_w", 2 if self._hovering and self._enabled else 1)
        pts = self._rounded_polygon_points(x1, y1, x2, y2, self._radius)
        self.create_polygon(
            pts,
            smooth=True,
            fill=pal["fill"],
            outline=pal["outline"],
            width=ow,
        )
        self.create_text(w // 2, h // 2, text=self._text, fill=pal["fg"], font=self._font)

    def _on_enter(self, _event):
        if self._enabled:
            self._hovering = True
            self._redraw()

    def _on_leave(self, _event):
        self._hovering = False
        self._redraw()

    def _on_click(self, _event):
        if self._enabled and self._command:
            self._command()

    def set_state(self, state):
        self._enabled = state != tk.DISABLED
        if not self._enabled:
            self._hovering = False
        self.configure(cursor="hand2" if self._enabled else "arrow")
        self._redraw()


class SpotifyYouTubeApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Spotify to YouTube Sync & Download")
        self.root.geometry("960x760")
        self.root.minsize(820, 620)
        self._apply_root_theme()

        # Load playlists
        self.playlists = self.load_playlists()

        self.selection_frame = None

        # Create UI
        self.create_widgets()
        
        # Status tracking
        self.is_running = False
        
    def load_playlists(self):
        """Load playlist configuration."""
        try:
            return load_playlists()
        except Exception as e:
            messagebox.showerror("Error", f"Failed to load playlists.json: {e}")
            return {}

    def _apply_root_theme(self):
        u = _UI
        self.root.configure(bg=u["bg"])

    def _primary_button(self, parent, text, command, bg, active_bg, **kw):
        u = _UI
        canvas_bg = kw.pop("canvas_bg", parent.cget("bg"))
        idle = {
            "fill": u["surface"],
            "outline": bg,
            "fg": active_bg,
            "outline_w": 1,
        }
        hover = {
            "fill": bg,
            "outline": active_bg,
            "fg": "#f6f8fa",
            "outline_w": 2,
        }
        disabled = {
            "fill": u["surface_2"],
            "outline": u["border"],
            "fg": u["disabled_fg"],
            "outline_w": 1,
        }
        return _RoundedButton(
            parent,
            text=text,
            command=command,
            font=("Segoe UI", 13, "bold"),
            padx=28,
            pady=16,
            canvas_bg=canvas_bg,
            idle=idle,
            hover=hover,
            disabled=disabled,
            radius=10,
        )

    def _secondary_button(self, parent, text, command, **kw):
        u = _UI
        canvas_bg = kw.pop("canvas_bg", parent.cget("bg"))
        idle = {
            "fill": u["surface_2"],
            "outline": u["border"],
            "fg": u["text"],
            "outline_w": 1,
        }
        hover = {
            "fill": u["surface"],
            "outline": "#6e7681",
            "fg": u["text"],
            "outline_w": 2,
        }
        disabled = {
            "fill": u["surface_2"],
            "outline": u["border"],
            "fg": u["disabled_fg"],
            "outline_w": 1,
        }
        return _RoundedButton(
            parent,
            text=text,
            command=command,
            font=("Segoe UI", 11, "bold"),
            padx=18,
            pady=11,
            canvas_bg=canvas_bg,
            idle=idle,
            hover=hover,
            disabled=disabled,
            radius=10,
        )

    def _row_accent_button(self, parent, text, command, bg, active_bg, **kw):
        """Same footprint as secondary row buttons; red outline / hover fill."""
        u = _UI
        canvas_bg = kw.pop("canvas_bg", parent.cget("bg"))
        idle = {
            "fill": u["surface_2"],
            "outline": bg,
            "fg": "#fecaca",
            "outline_w": 1,
        }
        hover = {
            "fill": "#3d1f1f",
            "outline": active_bg,
            "fg": "#f6f8fa",
            "outline_w": 2,
        }
        disabled = {
            "fill": u["surface_2"],
            "outline": u["border"],
            "fg": u["disabled_fg"],
            "outline_w": 1,
        }
        return _RoundedButton(
            parent,
            text=text,
            command=command,
            font=("Segoe UI", 11, "bold"),
            padx=18,
            pady=11,
            canvas_bg=canvas_bg,
            idle=idle,
            hover=hover,
            disabled=disabled,
            radius=10,
        )

    def _muted_button(self, parent, text, command, **kw):
        u = _UI
        canvas_bg = kw.pop("canvas_bg", parent.cget("bg"))
        idle = {
            "fill": u["surface"],
            "outline": u["border"],
            "fg": u["muted"],
            "outline_w": 1,
        }
        hover = {
            "fill": u["surface_2"],
            "outline": "#6e7681",
            "fg": u["text"],
            "outline_w": 2,
        }
        disabled = {
            "fill": u["surface"],
            "outline": u["border"],
            "fg": u["disabled_fg"],
            "outline_w": 1,
        }
        return _RoundedButton(
            parent,
            text=text,
            command=command,
            font=("Segoe UI", 10, "bold"),
            padx=14,
            pady=9,
            canvas_bg=canvas_bg,
            idle=idle,
            hover=hover,
            disabled=disabled,
            radius=8,
        )

    def _checkbutton(self, parent, text, variable):
        u = _UI
        return tk.Checkbutton(
            parent,
            text=text,
            variable=variable,
            font=("Segoe UI", 11, "bold"),
            bg=u["surface"],
            fg=u["text"],
            activebackground=u["surface"],
            activeforeground=u["text"],
            selectcolor=u["surface_2"],
            highlightthickness=0,
            anchor=tk.W,
        )

    def create_widgets(self):
        """Create the GUI widgets."""
        u = _UI
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(0, weight=1)

        main_frame = tk.Frame(self.root, bg=u["bg"], padx=20, pady=18)
        main_frame.grid(row=0, column=0, sticky=(tk.W, tk.E, tk.N, tk.S))
        main_frame.columnconfigure(0, weight=1)
        self.main_frame = main_frame

        title_label = tk.Label(
            main_frame,
            text="Spotify → YouTube",
            font=("Segoe UI", 24, "bold"),
            bg=u["bg"],
            fg=u["text"],
        )
        title_label.grid(row=0, column=0, sticky=tk.W, pady=(0, 4))
        subtitle = tk.Label(
            main_frame,
            text="Sync playlists to YouTube, then download with yt-dlp",
            font=("Segoe UI", 11, "bold"),
            bg=u["bg"],
            fg=u["muted"],
        )
        subtitle.grid(row=1, column=0, sticky=tk.W, pady=(0, 18))

        section_outer = tk.Frame(main_frame, bg=u["bg"])
        section_outer.grid(row=2, column=0, sticky=(tk.W, tk.E), pady=(0, 12))
        section_outer.columnconfigure(0, weight=1)

        tk.Label(
            section_outer,
            text="Playlists",
            font=("Segoe UI", 12, "bold"),
            bg=u["bg"],
            fg=u["text"],
        ).grid(row=0, column=0, sticky=tk.W, pady=(0, 8))

        selection_frame = tk.Frame(
            section_outer,
            bg=u["surface"],
            highlightbackground=u["border"],
            highlightthickness=1,
            padx=14,
            pady=12,
        )
        selection_frame.grid(row=1, column=0, sticky=(tk.W, tk.E))
        selection_frame.columnconfigure(0, weight=1)
        self.selection_frame = selection_frame

        self.playlist_vars = {}
        for idx, (name, _) in enumerate(self.playlists.items()):
            var = tk.BooleanVar(value=True)
            self.playlist_vars[name] = var
            cb = self._checkbutton(selection_frame, name, var)
            cb.grid(row=idx, column=0, sticky=tk.W, pady=3)

        button_frame = tk.Frame(selection_frame, bg=u["surface"])
        button_frame.grid(row=len(self.playlists), column=0, pady=(14, 0), sticky=tk.W)
        self._secondary_button(button_frame, text="Select All", command=self.select_all).pack(
            side=tk.LEFT, padx=(0, 8)
        )
        self._secondary_button(button_frame, text="Select None", command=self.select_none).pack(
            side=tk.LEFT, padx=(0, 14)
        )
        tk.Frame(button_frame, width=1, bg=u["border"]).pack(
            side=tk.LEFT, padx=(0, 14), fill=tk.Y, pady=4
        )
        self._secondary_button(
            button_frame, text="Add playlist", command=self.show_add_playlist_dialog
        ).pack(side=tk.LEFT, padx=(0, 8))
        self._row_accent_button(
            button_frame,
            text="Remove selected",
            command=self.remove_selected_playlists,
            bg=u["accent_stop"],
            active_bg=u["accent_stop_hover"],
        ).pack(side=tk.LEFT, padx=(0, 0))

        self.action_frame = tk.Frame(main_frame, bg=u["bg"])
        self.action_frame.grid(row=3, column=0, sticky=tk.W, pady=(4, 14))
        action_frame = self.action_frame

        self.sync_button = self._primary_button(
            action_frame,
            text="Sync playlists",
            command=self.start_sync,
            bg=u["accent_sync"],
            active_bg=u["accent_sync_hover"],
        )
        self.sync_button.pack(side=tk.LEFT, padx=(0, 12))

        self.download_button = self._primary_button(
            action_frame,
            text="Download playlists",
            command=self.start_download,
            bg=u["accent_download"],
            active_bg=u["accent_download_hover"],
        )
        self.download_button.pack(side=tk.LEFT, padx=(0, 12))

        self.stop_button = self._primary_button(
            action_frame,
            text="Stop",
            command=self.stop_operation,
            bg=u["accent_stop"],
            active_bg=u["accent_stop_hover"],
        )

        self.status_label = tk.Label(
            main_frame,
            text="Ready",
            font=("Segoe UI", 12, "bold"),
            bg=u["bg"],
            fg="#3fb950",
        )
        self.status_label.grid(row=4, column=0, sticky=tk.W, pady=(0, 12))

        log_header = tk.Frame(main_frame, bg=u["bg"])
        log_header.grid(row=5, column=0, sticky=(tk.W, tk.E), pady=(0, 8))
        tk.Label(
            log_header,
            text="Logs & output",
            font=("Segoe UI", 12, "bold"),
            bg=u["bg"],
            fg=u["text"],
        ).pack(side=tk.LEFT)

        log_frame = tk.Frame(
            main_frame,
            bg=u["surface"],
            highlightbackground=u["border"],
            highlightthickness=1,
            padx=12,
            pady=12,
        )
        log_frame.grid(row=6, column=0, sticky=(tk.W, tk.E, tk.N, tk.S), pady=(0, 14))
        log_frame.columnconfigure(0, weight=1)
        log_frame.rowconfigure(0, weight=1)
        main_frame.rowconfigure(6, weight=1)

        self.log_text = scrolledtext.ScrolledText(
            log_frame,
            height=18,
            width=80,
            wrap=tk.WORD,
            font=("Consolas", 11),
            bg=u["log_bg"],
            fg=u["log_fg"],
            insertbackground=u["text"],
            relief=tk.FLAT,
            borderwidth=0,
            highlightthickness=0,
            padx=10,
            pady=10,
        )
        self.log_text.grid(row=0, column=0, sticky=(tk.W, tk.E, tk.N, tk.S))

        log_btn_row = tk.Frame(log_frame, bg=u["surface"])
        log_btn_row.grid(row=1, column=0, sticky=tk.E, pady=(10, 0))
        self._secondary_button(log_btn_row, text="Clear logs", command=self.clear_logs).pack(
            side=tk.RIGHT
        )

        history_frame = tk.Frame(main_frame, bg=u["bg"])
        history_frame.grid(row=7, column=0, sticky=tk.W)
        for label, cmd in (
            ("Match log", self.view_match_log),
            ("Archive log", self.view_archive_log),
            ("Download log", self.view_download_log),
            ("Synced data", self.view_synced_data),
        ):
            self._muted_button(history_frame, text=label, command=cmd).pack(side=tk.LEFT, padx=(0, 8))
    
    def select_all(self):
        """Select all playlists."""
        for var in self.playlist_vars.values():
            var.set(True)
    
    def select_none(self):
        """Deselect all playlists."""
        for var in self.playlist_vars.values():
            var.set(False)
    
    def show_add_playlist_dialog(self):
        """Show dialog to add a new playlist."""
        u = _UI
        dialog = tk.Toplevel(self.root)
        dialog.title("Add playlist")
        dialog.geometry("520x300")
        dialog.configure(bg=u["bg"])
        dialog.transient(self.root)
        dialog.grab_set()

        dialog.update_idletasks()
        x = self.root.winfo_x() + (self.root.winfo_width() - 520) // 2
        y = self.root.winfo_y() + (self.root.winfo_height() - 300) // 2
        dialog.geometry(f"+{x}+{y}")

        frame = tk.Frame(dialog, bg=u["bg"], padx=22, pady=20)
        frame.pack(fill=tk.BOTH, expand=True)
        frame.columnconfigure(0, weight=1)

        def _entry(parent):
            return tk.Entry(
                parent,
                width=60,
                font=("Segoe UI", 11, "bold"),
                bg=u["surface_2"],
                fg=u["text"],
                insertbackground=u["text"],
                relief=tk.FLAT,
                borderwidth=0,
                highlightthickness=1,
                highlightbackground=u["border"],
                highlightcolor=u["accent_download"],
            )

        tk.Label(
            frame,
            text="Spotify playlist URL (required)",
            font=("Segoe UI", 11, "bold"),
            bg=u["bg"],
            fg=u["text"],
        ).grid(row=0, column=0, sticky=tk.W, pady=(0, 6))
        spotify_entry = _entry(frame)
        spotify_entry.grid(row=1, column=0, sticky=(tk.W, tk.E), pady=(0, 14))

        tk.Label(
            frame,
            text="YouTube playlist URL (optional)",
            font=("Segoe UI", 11, "bold"),
            bg=u["bg"],
            fg=u["text"],
        ).grid(row=2, column=0, sticky=tk.W, pady=(0, 6))
        youtube_entry = _entry(frame)
        youtube_entry.grid(row=3, column=0, sticky=(tk.W, tk.E), pady=(0, 12))

        info_label = tk.Label(
            frame,
            text="If no YouTube URL is provided, an existing channel playlist with the same name is reused when possible; otherwise a new public playlist is created.",
            font=("Segoe UI", 10, "bold"),
            bg=u["bg"],
            fg=u["muted"],
            wraplength=470,
            justify=tk.LEFT,
        )
        info_label.grid(row=4, column=0, sticky=tk.W, pady=(0, 12))

        status_label = tk.Label(frame, text="", font=("Segoe UI", 10, "bold"), bg=u["bg"], fg=u["muted"])
        status_label.grid(row=5, column=0, sticky=tk.W)
        
        def add_playlist():
            spotify_url = spotify_entry.get().strip()
            youtube_url = youtube_entry.get().strip()
            
            if not spotify_url:
                messagebox.showwarning("Missing URL", "Please enter a Spotify playlist URL.", parent=dialog)
                return
            
            # Extract Spotify playlist ID
            spotify_id = extract_spotify_playlist_id(spotify_url)
            if not spotify_id:
                messagebox.showerror("Invalid URL", "Could not extract playlist ID from Spotify URL.", parent=dialog)
                return
            
            status_label.config(text="Fetching playlist name from Spotify...", fg="#58a6ff")
            dialog.update_idletasks()
            
            # Get playlist name from Spotify
            try:
                playlist_name = get_spotify_playlist_name(spotify_id)
            except Exception as e:
                messagebox.showerror("Spotify Error", str(e), parent=dialog)
                status_label.config(text="Failed to fetch playlist name.", fg="#f85149")
                return

            if not playlist_name:
                status_label.config(text="Failed to fetch playlist name.", fg="#f85149")
                return
            
            # Extract YouTube playlist ID if provided
            youtube_id = None
            if youtube_url:
                youtube_id = extract_youtube_playlist_id(youtube_url)
                if not youtube_id:
                    messagebox.showerror("Invalid URL", "Could not extract playlist ID from YouTube URL.", parent=dialog)
                    status_label.config(text="", fg=u["muted"])
                    return

            # Add to playlists using the sync module function
            try:
                add_playlist_to_config(playlist_name, spotify_id, youtube_id)
            except ValueError as e:
                messagebox.showwarning("Duplicate", str(e), parent=dialog)
                status_label.config(text="", fg=u["muted"])
                return
            except Exception as e:
                messagebox.showerror("Error", f"Failed to add playlist: {e}", parent=dialog)
                status_label.config(text="", fg=u["muted"])
                return
            
            # Reload playlists and refresh the UI
            self.playlists = self.load_playlists()
            self.refresh_playlist_list()
            
            messagebox.showinfo("Success", f"Playlist '{playlist_name}' added successfully!", parent=dialog)
            dialog.destroy()
        
        button_frame = tk.Frame(frame, bg=u["bg"])
        button_frame.grid(row=6, column=0, pady=(16, 0), sticky=tk.W)
        self._primary_button(
            button_frame,
            text="Add playlist",
            command=add_playlist,
            bg=u["accent_sync"],
            active_bg=u["accent_sync_hover"],
        ).pack(side=tk.LEFT, padx=(0, 10))
        self._secondary_button(button_frame, text="Cancel", command=dialog.destroy).pack(
            side=tk.LEFT, padx=(0, 0)
        )
    
    def remove_selected_playlists(self):
        """Remove selected playlists from the configuration."""
        selected = self.get_selected_playlists()
        if not selected:
            messagebox.showwarning("No Selection", "Please select at least one playlist to remove.")
            return
        
        # Confirm deletion
        if len(selected) == 1:
            msg = f"Are you sure you want to remove '{selected[0]}'?"
        else:
            msg = f"Are you sure you want to remove {len(selected)} playlists?\n\n" + "\n".join(f"• {name}" for name in selected)
        
        if not messagebox.askyesno("Confirm Removal", msg):
            return
        
        # Remove playlists using the sync module function
        try:
            removed_count = remove_playlists_from_config(selected)
            if removed_count == 0:
                messagebox.showwarning("No Changes", "No playlists were removed.")
                return
            
            # Reload playlists and refresh the UI
            self.playlists = self.load_playlists()
            self.refresh_playlist_list()
            
            messagebox.showinfo("Success", f"Removed {removed_count} playlist(s).")
        except Exception as e:
            messagebox.showerror("Error", f"Failed to remove playlists: {e}")
    
    def refresh_playlist_list(self):
        """Refresh the playlist checkboxes in the UI."""
        u = _UI
        selection_frame = self.selection_frame
        if selection_frame is None:
            return

        for widget in selection_frame.winfo_children():
            widget.destroy()

        self.playlist_vars = {}
        for idx, (name, _) in enumerate(self.playlists.items()):
            var = tk.BooleanVar(value=True)
            self.playlist_vars[name] = var
            cb = self._checkbutton(selection_frame, name, var)
            cb.grid(row=idx, column=0, sticky=tk.W, pady=3)

        button_frame = tk.Frame(selection_frame, bg=u["surface"])
        button_frame.grid(row=len(self.playlists), column=0, pady=(14, 0), sticky=tk.W)
        self._secondary_button(button_frame, text="Select All", command=self.select_all).pack(
            side=tk.LEFT, padx=(0, 8)
        )
        self._secondary_button(button_frame, text="Select None", command=self.select_none).pack(
            side=tk.LEFT, padx=(0, 14)
        )
        tk.Frame(button_frame, width=1, bg=u["border"]).pack(
            side=tk.LEFT, padx=(0, 14), fill=tk.Y, pady=4
        )
        self._secondary_button(
            button_frame, text="Add playlist", command=self.show_add_playlist_dialog
        ).pack(side=tk.LEFT, padx=(0, 8))
        self._row_accent_button(
            button_frame,
            text="Remove selected",
            command=self.remove_selected_playlists,
            bg=u["accent_stop"],
            active_bg=u["accent_stop_hover"],
        ).pack(side=tk.LEFT, padx=(0, 0))

    def get_selected_playlists(self):
        """Get list of selected playlist names."""
        return [name for name, var in self.playlist_vars.items() if var.get()]
    
    def log(self, message):
        """Append message to log viewer."""
        timestamp = datetime.now().strftime("%H:%M:%S")
        self.log_text.insert(tk.END, f"[{timestamp}] {message}\n")
        self.log_text.see(tk.END)
        self.root.update_idletasks()
    
    def clear_logs(self):
        """Clear the log viewer."""
        self.log_text.delete(1.0, tk.END)
    
    def update_status(self, text, color="black"):
        """Update status label."""
        u = _UI
        fg_map = {
            "black": u["muted"],
            "green": "#3fb950",
            "blue": "#58a6ff",
            "orange": "#d29922",
            "red": "#f85149",
        }
        fg = fg_map.get(color, color)
        self.status_label.config(text=text, fg=fg)
    
    def set_buttons_state(self, running):
        """Enable/disable buttons based on running state."""
        state = tk.DISABLED if running else tk.NORMAL
        self.sync_button.set_state(state)
        self.download_button.set_state(state)
        if running:
            self.stop_button.pack(side=tk.LEFT, padx=(12, 0))
        else:
            self.stop_button.pack_forget()
        self.is_running = running
    
    def start_sync(self):
        """Start sync operation in a separate thread."""
        selected = self.get_selected_playlists()
        if not selected:
            messagebox.showwarning("No Selection", "Please select at least one playlist to sync.")
            return
        
        self.set_buttons_state(True)
        self.update_status("Syncing...", "blue")
        self.log(f"Starting sync for playlists: {', '.join(selected)}")
        
        thread = threading.Thread(target=self.run_sync, args=(selected,), daemon=True)
        thread.start()
    
    def run_sync(self, playlist_names):
        """Run sync operation (called in thread)."""
        try:
            result = sync_playlists(playlist_names=playlist_names, log_callback=self.log)
            if result["success"]:
                self.log("✓ Sync completed successfully!")
                self.update_status("Sync completed", "green")
            else:
                reason = result.get("abort_reason", "unknown")
                self.log(f"⚠ Sync stopped: {reason}")
                self.update_status(f"Sync stopped: {reason}", "orange")
        except Exception as e:
            self.log(f"✗ Error during sync: {e}")
            self.update_status("Sync error", "red")
        finally:
            self.set_buttons_state(False)
    
    def start_download(self):
        """Start download operation in a separate thread."""
        selected = self.get_selected_playlists()
        if not selected:
            messagebox.showwarning("No Selection", "Please select at least one playlist to download.")
            return
        
        self.set_buttons_state(True)
        self.update_status("Downloading...", "blue")
        self.log(f"Starting download for playlists: {', '.join(selected)}")
        
        thread = threading.Thread(target=self.run_download, args=(selected,), daemon=True)
        thread.start()
    
    def run_download(self, playlist_names):
        """Run download operation (called in thread)."""
        try:
            result = download_playlists(
                playlist_names=playlist_names,
                log_callback=self.log,
                concise_ui=True,
            )
            if result["success"]:
                self.log("✓ Download completed successfully!")
                self.update_status("Download completed", "green")
            else:
                self.log("⚠ Download completed with errors")
                self.update_status("Download completed with errors", "orange")
        except Exception as e:
            self.log(f"✗ Error during download: {e}")
            self.update_status("Download error", "red")
        finally:
            self.set_buttons_state(False)
    
    def stop_operation(self):
        """Stop current operation."""
        # Note: This is a simple implementation. For full control, you'd need
        # to track the running thread and terminate it properly.
        self.log("⚠ Stop requested (operation may continue until current task completes)")
        self.update_status("Stopping...", "orange")
        # The operation will finish naturally and buttons will be re-enabled
    
    def view_match_log(self):
        """Open match log in a new window."""
        self.view_file("match_log.csv", "Match Log")
    
    def view_archive_log(self):
        """Open archive log in a new window."""
        self.view_file("yt_archive.log", "Archive Log")
    
    def view_download_log(self):
        """Open yt-dlp download log in a new window."""
        self.view_file(DOWNLOAD_LOG_FILE, "Download Log (yt-dlp)")
    
    def view_synced_data(self):
        """Open synced data in a new window."""
        self.view_file("synced.json", "Synced Data")
    
    def view_file(self, filename, title):
        """View a file in a new window."""
        filepath = Path(filename)
        if not filepath.is_file():
            alt = _PROJECT_DIR / Path(filename).name
            if alt.is_file():
                filepath = alt
        if not filepath.is_file():
            messagebox.showinfo("File Not Found", f"{filename} does not exist yet.")
            return
        
        u = _UI
        window = tk.Toplevel(self.root)
        window.title(title)
        window.geometry("800x600")
        window.configure(bg=u["bg"])
        window.minsize(480, 320)

        outer = tk.Frame(window, bg=u["bg"], padx=12, pady=12)
        outer.pack(fill=tk.BOTH, expand=True)
        outer.rowconfigure(0, weight=1)
        outer.columnconfigure(0, weight=1)

        text_widget = scrolledtext.ScrolledText(
            outer,
            wrap=tk.WORD,
            font=("Consolas", 11),
            bg=u["log_bg"],
            fg=u["log_fg"],
            insertbackground=u["text"],
            relief=tk.FLAT,
            borderwidth=0,
            highlightthickness=1,
            highlightbackground=u["border"],
            padx=10,
            pady=10,
        )
        text_widget.grid(row=0, column=0, sticky=(tk.N, tk.S, tk.W, tk.E))

        btn_row = tk.Frame(outer, bg=u["bg"])
        btn_row.grid(row=1, column=0, sticky=tk.E, pady=(10, 0))
        self._secondary_button(btn_row, text="Close", command=window.destroy).pack(side=tk.RIGHT)

        try:
            content = filepath.read_text(encoding="utf-8")
            text_widget.insert(1.0, content)
            text_widget.config(state=tk.DISABLED)
        except Exception as e:
            text_widget.insert(1.0, f"Error reading file: {e}")
            text_widget.config(state=tk.DISABLED)


def main():
    root = tk.Tk()
    app = SpotifyYouTubeApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()

