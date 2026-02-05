# Setup Guide for AutoSpotifyDownloader

This guide will walk you through setting up the AutoSpotifyDownloader application on a new computer with your friend's Spotify and Google accounts.

## Prerequisites

- Windows, macOS, or Linux computer
- Internet connection
- Access to your friend's Spotify account (to create app credentials)
- Access to your friend's Google account (to create API credentials)

---

## Step 1: Install Python

1. **Download Python 3.8 or newer** from [python.org](https://www.python.org/downloads/)
2. **During installation:**
   - ✅ Check "Add Python to PATH" (important!)
   - Click "Install Now"
3. **Verify installation:**
   - Open Command Prompt (Windows) or Terminal (Mac/Linux)
   - Run: `python --version` or `python3 --version`
   - Should show Python 3.8 or higher

---

## Step 2: Get the Project Files

**Option A: Clone from Git (if using version control)**
```bash
git clone <your-repo-url>
cd AutoSpotifyDownloader
```

**Option B: Copy files manually**
- Copy all project files to a folder (e.g., `C:\Users\Friend\AutoSpotifyDownloader`)

---

## Step 3: Install Python Dependencies

1. **Open Command Prompt/Terminal** in the project directory
2. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```
   Or if that doesn't work:
   ```bash
   python -m pip install -r requirements.txt
   ```

This will install:
- `spotipy` - Spotify API client
- `google-api-python-client` - YouTube API client
- `google-auth-oauthlib` - Google authentication
- `rapidfuzz` - String matching for song matching
- `python-dotenv` - Environment variable management

---

## Step 4: Set Up Spotify API Credentials

### 4.1 Create a Spotify App

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. **Log in** with your friend's Spotify account
3. Click **"Create app"**
4. Fill in:
   - **App name:** `AutoSpotifyDownloader` (or any name)
   - **App description:** `Sync playlists to YouTube`
   - **Redirect URI:** `http://localhost:8888/callback`
   - ✅ Check "I understand and agree..."
5. Click **"Save"**

### 4.2 Get Credentials

1. Click on your newly created app
2. Note down:
   - **Client ID** (visible on the app page)
   - **Client Secret** (click "Show client secret" to reveal)

### 4.3 Create .env File

1. In the project directory, create a file named `.env` (no extension)
2. Add the following content:
   ```
   SPOTIPY_CLIENT_ID=your_client_id_here
   SPOTIPY_CLIENT_SECRET=your_client_secret_here
   SPOTIPY_REDIRECT_URI=http://localhost:8888/callback
   ```
3. Replace `your_client_id_here` and `your_client_secret_here` with the actual values from Step 4.2

**Example:**
```
SPOTIPY_CLIENT_ID=abc123def456ghi789
SPOTIPY_CLIENT_SECRET=xyz789uvw456rst123
SPOTIPY_REDIRECT_URI=http://localhost:8888/callback
```

---

## Step 5: Set Up Google/YouTube API Credentials

### 5.1 Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. **Log in** with your friend's Google account
3. Click the project dropdown at the top
4. Click **"New Project"**
5. Enter project name: `SpotifyToYouTubeSync` (or any name)
6. Click **"Create"**
7. Select the new project from the dropdown

### 5.2 Enable YouTube Data API v3

1. Go to [API Library](https://console.cloud.google.com/apis/library)
2. Search for **"YouTube Data API v3"**
3. Click on it
4. Click **"Enable"**

### 5.3 Create OAuth 2.0 Credentials

1. Go to [Credentials page](https://console.cloud.google.com/apis/credentials)
2. Click **"+ CREATE CREDENTIALS"** → **"OAuth client ID"**
3. If prompted, configure OAuth consent screen:
   - **User Type:** External (unless using Google Workspace)
   - Click **"Create"**
   - **App name:** `SpotifyToYouTubeSync`
   - **User support email:** Your friend's email
   - **Developer contact:** Your friend's email
   - Click **"Save and Continue"**
   - Click **"Save and Continue"** again (scopes)
   - Click **"Add users"** → Add your friend's email → **"Add"**
   - Click **"Save and Continue"**
4. **Application type:** Choose **"Desktop app"**
5. **Name:** `AutoSpotifyDownloader`
6. Click **"Create"**
7. **Download the credentials:**
   - Click the download icon (⬇️) next to your new OAuth client
   - Save the file as `client_secret.json`
   - **Move this file** to your project directory

### 5.4 Verify client_secret.json

The `client_secret.json` file should look like:
```json
{
  "installed": {
    "client_id": "...",
    "project_id": "...",
    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
    "token_uri": "https://oauth2.googleapis.com/token",
    "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
    "client_secret": "...",
    "redirect_uris": ["http://localhost"]
  }
}
```

---

## Step 6: Initial Authentication

### 6.1 First Run - Spotify Authentication

When you first run the app, Spotify will:
1. Open a browser window
2. Ask your friend to log in and authorize the app
3. Redirect back to the app
4. Store credentials automatically

### 6.2 First Run - YouTube Authentication

When you first use YouTube features, the app will:
1. Open a browser window
2. Ask your friend to log in and authorize the app
3. Grant permissions to manage YouTube playlists
4. Create `yt_token.pickle` file (stores the token)

**Note:** These authentication steps only happen once. After that, tokens are saved locally.

---

## Step 7: Run the Application

1. **Open Command Prompt/Terminal** in the project directory
2. **Run the GUI application:**
   ```bash
   python app.py
   ```
   Or:
   ```bash
   python3 app.py
   ```

3. The application window should open!

---

## Step 8: Add Playlists

1. Click **"Add Playlist"** button
2. Enter:
   - **Spotify Playlist URL** (required) - Get this from Spotify app/website
   - **YouTube Playlist URL** (optional) - Leave empty to auto-create
3. Click **"Add"**
4. The app will fetch the playlist name from Spotify automatically

---

## Files Created During Setup

These files will be created automatically:
- `.env` - Spotify credentials (you create this)
- `client_secret.json` - Google OAuth credentials (you download this)
- `yt_token.pickle` - YouTube authentication token (created on first use)
- `playlists.json` - Your playlist mappings (created when you add playlists)
- `synced.json` - Sync history/cache (created on first sync)
- `match_log.csv` - Song matching log (created during sync)

---

## Troubleshooting

### "Module not found" errors
- Make sure you ran `pip install -r requirements.txt`
- Try: `python -m pip install --upgrade pip` then reinstall

### Spotify authentication fails
- Check `.env` file exists and has correct credentials
- Verify redirect URI matches: `http://localhost:8888/callback`
- Make sure Spotify app is created and credentials are correct

### YouTube authentication fails
- Verify `client_secret.json` is in the project directory
- Check that YouTube Data API v3 is enabled in Google Cloud Console
- Make sure OAuth consent screen is configured

### "Permission denied" errors
- Make sure your friend's email is added to OAuth consent screen test users
- Verify the Google account has access to YouTube

### Port already in use
- If port 8888 is busy, SpotifyOAuth will try other ports automatically
- For YouTube, the port is chosen automatically

---

## Security Notes

⚠️ **Important:**
- Never commit `.env` or `client_secret.json` to version control
- Never share these credentials publicly
- `yt_token.pickle` contains sensitive tokens - keep it secure
- These credentials give access to your friend's Spotify and YouTube accounts

---

## Quick Checklist

- [ ] Python 3.8+ installed
- [ ] Project files copied/cloned
- [ ] Dependencies installed (`pip install -r requirements.txt`)
- [ ] Spotify app created and credentials obtained
- [ ] `.env` file created with Spotify credentials
- [ ] Google Cloud project created
- [ ] YouTube Data API v3 enabled
- [ ] OAuth credentials created and downloaded
- [ ] `client_secret.json` placed in project directory
- [ ] App runs successfully (`python app.py`)
- [ ] Spotify authentication completed
- [ ] YouTube authentication completed (on first sync)
- [ ] Playlist added successfully

---

## Need Help?

If you encounter issues:
1. Check the error messages in the app's log window
2. Verify all files are in the correct location
3. Ensure all credentials are correct
4. Check that APIs are enabled in Google Cloud Console
