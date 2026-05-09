#!/usr/bin/env python3
"""
Desktop GUI application for Spotify to YouTube sync and download.
"""

import tkinter as tk
from tkinter import ttk, scrolledtext, messagebox
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


class SpotifyYouTubeApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Spotify to YouTube Sync & Download")
        self.root.geometry("900x700")
        
        # Load playlists
        self.playlists = self.load_playlists()
        
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
    
    def create_widgets(self):
        """Create the GUI widgets."""
        # Main container
        main_frame = ttk.Frame(self.root, padding="10")
        main_frame.grid(row=0, column=0, sticky=(tk.W, tk.E, tk.N, tk.S))
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(0, weight=1)
        
        # Title
        title_label = ttk.Label(main_frame, text="Spotify to YouTube Sync & Download", 
                                font=("Arial", 16, "bold"))
        title_label.grid(row=0, column=0, columnspan=2, pady=(0, 20))
        
        # Playlist selection frame
        selection_frame = ttk.LabelFrame(main_frame, text="Select Playlists", padding="10")
        selection_frame.grid(row=1, column=0, columnspan=2, sticky=(tk.W, tk.E), pady=(0, 10))
        selection_frame.columnconfigure(0, weight=1)
        
        self.playlist_vars = {}
        for idx, (name, _) in enumerate(self.playlists.items()):
            var = tk.BooleanVar(value=True)
            self.playlist_vars[name] = var
            cb = ttk.Checkbutton(selection_frame, text=name, variable=var)
            cb.grid(row=idx, column=0, sticky=tk.W, pady=2)
        
        # Select all/none and add/remove buttons
        button_frame = ttk.Frame(selection_frame)
        button_frame.grid(row=len(self.playlists), column=0, pady=(10, 0))
        ttk.Button(button_frame, text="Select All", command=self.select_all).pack(side=tk.LEFT, padx=5)
        ttk.Button(button_frame, text="Select None", command=self.select_none).pack(side=tk.LEFT, padx=5)
        ttk.Separator(button_frame, orient=tk.VERTICAL).pack(side=tk.LEFT, padx=10, fill=tk.Y)
        ttk.Button(button_frame, text="Add Playlist", command=self.show_add_playlist_dialog).pack(side=tk.LEFT, padx=5)
        ttk.Button(button_frame, text="Remove Selected", command=self.remove_selected_playlists).pack(side=tk.LEFT, padx=5)
        
        # Action buttons frame
        action_frame = ttk.Frame(main_frame)
        action_frame.grid(row=2, column=0, columnspan=2, pady=10)
        
        self.sync_button = ttk.Button(action_frame, text="Sync Playlists", 
                                      command=self.start_sync, width=20)
        self.sync_button.pack(side=tk.LEFT, padx=5)
        
        self.download_button = ttk.Button(action_frame, text="Download Playlists", 
                                         command=self.start_download, width=20)
        self.download_button.pack(side=tk.LEFT, padx=5)
        
        self.stop_button = ttk.Button(action_frame, text="Stop", 
                                      command=self.stop_operation, state=tk.DISABLED, width=20)
        self.stop_button.pack(side=tk.LEFT, padx=5)
        
        # Status label
        self.status_label = ttk.Label(main_frame, text="Ready", foreground="green")
        self.status_label.grid(row=3, column=0, columnspan=2, pady=(0, 10))
        
        # Log viewer
        log_frame = ttk.LabelFrame(main_frame, text="Logs & Output", padding="10")
        log_frame.grid(row=4, column=0, columnspan=2, sticky=(tk.W, tk.E, tk.N, tk.S), pady=(0, 10))
        log_frame.columnconfigure(0, weight=1)
        log_frame.rowconfigure(0, weight=1)
        main_frame.rowconfigure(4, weight=1)
        
        self.log_text = scrolledtext.ScrolledText(log_frame, height=20, width=80, wrap=tk.WORD)
        self.log_text.grid(row=0, column=0, sticky=(tk.W, tk.E, tk.N, tk.S))
        
        # Clear log button
        ttk.Button(log_frame, text="Clear Logs", command=self.clear_logs).grid(row=1, column=0, pady=(5, 0))
        
        # View logs/history buttons
        history_frame = ttk.Frame(main_frame)
        history_frame.grid(row=5, column=0, columnspan=2)
        
        ttk.Button(history_frame, text="View Match Log", command=self.view_match_log).pack(side=tk.LEFT, padx=5)
        ttk.Button(history_frame, text="View Archive Log", command=self.view_archive_log).pack(side=tk.LEFT, padx=5)
        ttk.Button(history_frame, text="View Download Log", command=self.view_download_log).pack(side=tk.LEFT, padx=5)
        ttk.Button(history_frame, text="View Synced Data", command=self.view_synced_data).pack(side=tk.LEFT, padx=5)
    
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
        dialog = tk.Toplevel(self.root)
        dialog.title("Add Playlist")
        dialog.geometry("500x250")
        dialog.transient(self.root)
        dialog.grab_set()
        
        # Center the dialog
        dialog.update_idletasks()
        x = self.root.winfo_x() + (self.root.winfo_width() - 500) // 2
        y = self.root.winfo_y() + (self.root.winfo_height() - 250) // 2
        dialog.geometry(f"+{x}+{y}")
        
        frame = ttk.Frame(dialog, padding="20")
        frame.pack(fill=tk.BOTH, expand=True)
        
        # Spotify URL input
        ttk.Label(frame, text="Spotify Playlist URL (required):").grid(row=0, column=0, sticky=tk.W, pady=(0, 5))
        spotify_entry = ttk.Entry(frame, width=60)
        spotify_entry.grid(row=1, column=0, sticky=(tk.W, tk.E), pady=(0, 15))
        
        # YouTube URL input
        ttk.Label(frame, text="YouTube Playlist URL (optional):").grid(row=2, column=0, sticky=tk.W, pady=(0, 5))
        youtube_entry = ttk.Entry(frame, width=60)
        youtube_entry.grid(row=3, column=0, sticky=(tk.W, tk.E), pady=(0, 15))
        
        # Info label
        info_label = ttk.Label(
            frame,
            text="If no YouTube URL is provided, an existing channel playlist with the same name is reused when possible; otherwise a new public playlist is created.",
            foreground="gray",
            wraplength=460,
        )
        info_label.grid(row=4, column=0, sticky=tk.W, pady=(0, 15))
        
        # Status label
        status_label = ttk.Label(frame, text="")
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
            
            status_label.config(text="Fetching playlist name from Spotify...", foreground="blue")
            dialog.update_idletasks()
            
            # Get playlist name from Spotify
            try:
                playlist_name = get_spotify_playlist_name(spotify_id)
            except Exception as e:
                messagebox.showerror("Spotify Error", str(e), parent=dialog)
                status_label.config(text="Failed to fetch playlist name.", foreground="red")
                return
            
            if not playlist_name:
                status_label.config(text="Failed to fetch playlist name.", foreground="red")
                return
            
            # Extract YouTube playlist ID if provided
            youtube_id = None
            if youtube_url:
                youtube_id = extract_youtube_playlist_id(youtube_url)
                if not youtube_id:
                    messagebox.showerror("Invalid URL", "Could not extract playlist ID from YouTube URL.", parent=dialog)
                    status_label.config(text="", foreground="black")
                    return
            
            # Add to playlists using the sync module function
            try:
                add_playlist_to_config(playlist_name, spotify_id, youtube_id)
            except ValueError as e:
                messagebox.showwarning("Duplicate", str(e), parent=dialog)
                status_label.config(text="", foreground="black")
                return
            except Exception as e:
                messagebox.showerror("Error", f"Failed to add playlist: {e}", parent=dialog)
                status_label.config(text="", foreground="black")
                return
            
            # Reload playlists and refresh the UI
            self.playlists = self.load_playlists()
            self.refresh_playlist_list()
            
            messagebox.showinfo("Success", f"Playlist '{playlist_name}' added successfully!", parent=dialog)
            dialog.destroy()
        
        # Buttons
        button_frame = ttk.Frame(frame)
        button_frame.grid(row=6, column=0, pady=(10, 0))
        ttk.Button(button_frame, text="Add", command=add_playlist).pack(side=tk.LEFT, padx=5)
        ttk.Button(button_frame, text="Cancel", command=dialog.destroy).pack(side=tk.LEFT, padx=5)
        
        frame.columnconfigure(0, weight=1)
    
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
        # Find the selection frame
        for widget in self.root.winfo_children():
            if isinstance(widget, ttk.Frame):
                for child in widget.winfo_children():
                    if isinstance(child, ttk.LabelFrame) and child.cget("text") == "Select Playlists":
                        selection_frame = child
                        break
                else:
                    continue
                break
        
        # Remove all existing checkboxes and button frame
        for widget in selection_frame.winfo_children():
            widget.destroy()
        
        # Recreate checkboxes
        self.playlist_vars = {}
        for idx, (name, _) in enumerate(self.playlists.items()):
            var = tk.BooleanVar(value=True)
            self.playlist_vars[name] = var
            cb = ttk.Checkbutton(selection_frame, text=name, variable=var)
            cb.grid(row=idx, column=0, sticky=tk.W, pady=2)
        
        # Recreate button frame
        button_frame = ttk.Frame(selection_frame)
        button_frame.grid(row=len(self.playlists), column=0, pady=(10, 0))
        ttk.Button(button_frame, text="Select All", command=self.select_all).pack(side=tk.LEFT, padx=5)
        ttk.Button(button_frame, text="Select None", command=self.select_none).pack(side=tk.LEFT, padx=5)
        ttk.Separator(button_frame, orient=tk.VERTICAL).pack(side=tk.LEFT, padx=10, fill=tk.Y)
        ttk.Button(button_frame, text="Add Playlist", command=self.show_add_playlist_dialog).pack(side=tk.LEFT, padx=5)
        ttk.Button(button_frame, text="Remove Selected", command=self.remove_selected_playlists).pack(side=tk.LEFT, padx=5)
    
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
        self.status_label.config(text=text, foreground=color)
    
    def set_buttons_state(self, running):
        """Enable/disable buttons based on running state."""
        state = tk.DISABLED if running else tk.NORMAL
        self.sync_button.config(state=state)
        self.download_button.config(state=state)
        self.stop_button.config(state=tk.NORMAL if running else tk.DISABLED)
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
        
        window = tk.Toplevel(self.root)
        window.title(title)
        window.geometry("800x600")
        
        text_widget = scrolledtext.ScrolledText(window, wrap=tk.WORD)
        text_widget.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)
        
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

