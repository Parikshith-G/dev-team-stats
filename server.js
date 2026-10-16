const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Favicon route (prevent 404)
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Default AI Use Cases requested by user
const DEFAULT_USE_CASES = [
  "No of deployment requests raised using kiro",
  "No of bugs analyuzed using bug analyzer",
  "No of orders raised using order creation tool for unit testing",
  "Java upgrade agent use cases",
  "AI-SDLC use cases"
];

const GIST_FILENAME = 'ai-stats.json';
const GIST_HOURS_FILENAME = 'weekly-hours.json';

// Target Gist ID containing user's counts
const LOCKED_GIST_ID = '9b4fe954cde921ca9bd378be5cb79cf5';

function getGistId() {
  return (process.env.GIST_ID && process.env.GIST_ID.trim()) || runtimeConfig.gistId || LOCKED_GIST_ID;
}

// Runtime config fallback
let runtimeConfig = {
  githubToken: (process.env.GITHUB_TOKEN && process.env.GITHUB_TOKEN.trim()) || '',
  gistId: getGistId()
};

// In-memory cache & fallback stats
let memoryStats = DEFAULT_USE_CASES.reduce((acc, curr) => {
  acc[curr] = 0;
  return acc;
}, {});

// In-memory cache & fallback weekly hours
let memoryHours = {
  entries: []
};

// Local disk persistence fallback
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
}
const STATS_FILE = path.join(DATA_DIR, 'stats.json');
const HOURS_FILE = path.join(DATA_DIR, 'hours.json');

if (fs.existsSync(STATS_FILE)) {
  try {
    const saved = JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8'));
    memoryStats = { ...memoryStats, ...saved };
  } catch (e) {}
}

if (fs.existsSync(HOURS_FILE)) {
  try {
    const saved = JSON.parse(fs.readFileSync(HOURS_FILE, 'utf-8'));
    memoryHours = { ...memoryHours, ...saved };
  } catch (e) {}
}

function persistToDisk() {
  try {
    fs.writeFileSync(STATS_FILE, JSON.stringify(memoryStats, null, 2));
    fs.writeFileSync(HOURS_FILE, JSON.stringify(memoryHours, null, 2));
  } catch (e) {}
}

// Calculate start and end of current week (Monday to Sunday)
function getCurrentWeekRange() {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = (day === 0 ? -6 : 1) - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const options = { month: 'short', day: 'numeric', year: 'numeric' };
  const startStr = monday.toLocaleDateString('en-US', options);
  const endStr = sunday.toLocaleDateString('en-US', options);

  return {
    startDate: startStr,
    endDate: endStr,
    fullTitle: `Current Week: ${startStr} – ${endStr}`
  };
}

// Sequential Mutex Queue to guarantee updates are NEVER lost or corrupted
let updateQueue = Promise.resolve();

function enqueueUpdate(taskFn) {
  const resultPromise = updateQueue.then(() => taskFn());
  updateQueue = resultPromise.catch(() => {});
  return resultPromise;
}

// Helper: Get GitHub headers
function getHeaders(token) {
  return {
    'Accept': 'application/vnd.github+json',
    'Authorization': `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Render-Dev-Team-Stats-App'
  };
}

// Fetch stats from Gist
async function fetchGistStats() {
  const token = runtimeConfig.githubToken || process.env.GITHUB_TOKEN;
  const gistId = getGistId();

  if (!gistId) {
    return { connected: false, stats: memoryStats };
  }

  const headers = token ? getHeaders(token) : { 'User-Agent': 'Render-Dev-Team-Stats-App' };

  try {
    const response = await fetch(`https://api.github.com/gists/${gistId}?t=${Date.now()}`, {
      headers: {
        ...headers,
        'Cache-Control': 'no-cache'
      }
    });

    if (!response.ok) {
      console.warn(`[Gist Fetch] HTTP ${response.status} reading Gist ${gistId}`);
      return { connected: false, gistId, stats: memoryStats };
    }

    const gistData = await response.json();
    const file = gistData.files && (gistData.files[GIST_FILENAME] || Object.values(gistData.files)[0]);

    if (!file || !file.content) {
      return { connected: true, gistId, stats: memoryStats };
    }

    const parsed = JSON.parse(file.content);
    const stats = {};
    DEFAULT_USE_CASES.forEach(key => {
      stats[key] = typeof parsed[key] === 'number' ? parsed[key] : (parsed[key] ? Number(parsed[key]) : 0);
    });

    memoryStats = stats;
    persistToDisk();

    return {
      connected: true,
      gistId,
      stats
    };
  } catch (err) {
    console.error('[Gist Fetch] Error:', err.message);
    return {
      connected: false,
      gistId,
      stats: memoryStats
    };
  }
}

// Write stats to Gist
async function writeGistStats(newStats) {
  const token = runtimeConfig.githubToken || process.env.GITHUB_TOKEN;
  const gistId = getGistId();

  memoryStats = newStats;
  persistToDisk();

  if (!token) {
    return { gistId, stats: newStats, connected: false };
  }

  try {
    const content = JSON.stringify(newStats, null, 2);
    const response = await fetch(`https://api.github.com/gists/${gistId}`, {
      method: 'PATCH',
      headers: getHeaders(token),
      body: JSON.stringify({
        description: 'Dev Team AI Stats and Weekly Hours',
        files: {
          [GIST_FILENAME]: {
            content
          }
        }
      })
    });

    if (response.ok) {
      return {
        gistId,
        stats: newStats,
        connected: true
      };
    } else {
      console.warn(`[Gist Write] HTTP ${response.status} writing to Gist`);
      return { gistId, stats: newStats, connected: false };
    }
  } catch (err) {
    console.error('[Gist Write] Error:', err.message);
    return { gistId, stats: newStats, connected: false };
  }
}

// Fetch Weekly Hours from Gist
async function fetchGistHours() {
  const token = runtimeConfig.githubToken || process.env.GITHUB_TOKEN;
  const gistId = getGistId();
  const weekInfo = getCurrentWeekRange();

  if (!gistId) {
    return { connected: false, week: weekInfo, entries: memoryHours.entries || [] };
  }

  const headers = token ? getHeaders(token) : { 'User-Agent': 'Render-Dev-Team-Stats-App' };

  try {
    const response = await fetch(`https://api.github.com/gists/${gistId}?t=${Date.now()}`, {
      headers: {
        ...headers,
        'Cache-Control': 'no-cache'
      }
    });

    if (!response.ok) {
      return { connected: false, week: weekInfo, entries: memoryHours.entries || [] };
    }

    const gistData = await response.json();
    const file = gistData.files && gistData.files[GIST_HOURS_FILENAME];

    if (!file || !file.content) {
      return { connected: true, week: weekInfo, entries: memoryHours.entries || [] };
    }

    const parsed = JSON.parse(file.content);
    memoryHours = parsed;
    persistToDisk();

    return {
      connected: true,
      gistId,
      week: parsed.week || weekInfo,
      entries: parsed.entries || []
    };
  } catch (err) {
    return {
      connected: false,
      week: weekInfo,
      entries: memoryHours.entries || []
    };
  }
}

// Write Weekly Hours to Gist
async function writeGistHours(hoursData) {
  const token = runtimeConfig.githubToken || process.env.GITHUB_TOKEN;
  const gistId = getGistId();

  memoryHours = hoursData;
  persistToDisk();

  if (!token) {
    return { gistId, hours: hoursData, connected: false };
  }

  try {
    const content = JSON.stringify(hoursData, null, 2);
    const response = await fetch(`https://api.github.com/gists/${gistId}`, {
      method: 'PATCH',
      headers: getHeaders(token),
      body: JSON.stringify({
        files: {
          [GIST_HOURS_FILENAME]: {
            content
          }
        }
      })
    });

    if (response.ok) {
      return { gistId, hours: hoursData, connected: true };
    } else {
      return { gistId, hours: hoursData, connected: false };
    }
  } catch (err) {
    return { gistId, hours: hoursData, connected: false };
  }
}

// Routes

// Path: /ai-stats
app.get('/ai-stats', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Path: /hours
app.get('/hours', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'hours.html'));
});

// Root redirects to /ai-stats
app.get('/', (req, res) => {
  res.redirect('/ai-stats');
});

// GET /api/stats
app.get('/api/stats', async (req, res) => {
  try {
    const result = await fetchGistStats();
    res.json({
      success: true,
      gistId: getGistId(),
      ...result
    });
  } catch (error) {
    res.json({
      success: true,
      connected: false,
      stats: memoryStats,
      gistId: getGistId()
    });
  }
});

// POST /api/stats/update (Supports both delta +1/-1 and direct number setting)
app.post('/api/stats/update', async (req, res) => {
  const { useCase, delta, value } = req.body;

  if (!useCase) {
    return res.status(400).json({ success: false, error: 'useCase is required' });
  }

  try {
    const updatedResult = await enqueueUpdate(async () => {
      let currentStats = { ...memoryStats };
      const gistId = getGistId();

      // Read latest
      if (gistId) {
        try {
          const fetched = await fetchGistStats();
          if (fetched && fetched.stats) {
            currentStats = { ...fetched.stats };
          }
        } catch (e) {}
      }

      const currentCount = typeof currentStats[useCase] === 'number' ? currentStats[useCase] : 0;
      let newCount = currentCount;

      if (value !== undefined) {
        newCount = Math.max(0, parseInt(value, 10) || 0);
      } else if (delta !== undefined) {
        newCount = Math.max(0, currentCount + delta);
      }

      currentStats[useCase] = newCount;
      const writeResult = await writeGistStats(currentStats);

      return {
        stats: currentStats,
        connected: Boolean(writeResult.connected),
        gistId: getGistId()
      };
    });

    res.json({ success: true, ...updatedResult });
  } catch (error) {
    res.json({ success: true, stats: memoryStats, connected: false });
  }
});

// GET /api/hours
app.get('/api/hours', async (req, res) => {
  try {
    const result = await fetchGistHours();
    res.json({
      success: true,
      gistId: getGistId(),
      ...result
    });
  } catch (error) {
    res.json({
      success: true,
      connected: false,
      week: getCurrentWeekRange(),
      entries: memoryHours.entries || []
    });
  }
});

// POST /api/hours
app.post('/api/hours', async (req, res) => {
  const { name, jettHours, fieldglassHours } = req.body;
  if (!name || name.trim() === '') {
    return res.status(400).json({ success: false, error: 'Name is required' });
  }

  const parsedJett = parseFloat(jettHours) || 0;
  const parsedFieldglass = parseFloat(fieldglassHours) || 0;

  try {
    const updated = await enqueueUpdate(async () => {
      let currentData = { week: getCurrentWeekRange(), entries: memoryHours.entries || [] };
      const gistId = getGistId();

      if (gistId) {
        try {
          const fetched = await fetchGistHours();
          if (fetched && fetched.entries) {
            currentData = {
              week: fetched.week || getCurrentWeekRange(),
              entries: fetched.entries || []
            };
          }
        } catch (e) {}
      }

      const cleanName = name.trim();
      const existingIndex = currentData.entries.findIndex(
        e => e.name.toLowerCase() === cleanName.toLowerCase()
      );

      const entry = {
        id: existingIndex >= 0 ? currentData.entries[existingIndex].id : Date.now().toString(),
        name: cleanName,
        jettHours: parsedJett,
        fieldglassHours: parsedFieldglass,
        updatedAt: new Date().toISOString()
      };

      if (existingIndex >= 0) {
        currentData.entries[existingIndex] = entry;
      } else {
        currentData.entries.push(entry);
      }

      await writeGistHours(currentData);

      return {
        success: true,
        week: currentData.week,
        entries: currentData.entries
      };
    });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/hours/:id
app.delete('/api/hours/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const updated = await enqueueUpdate(async () => {
      let currentData = { week: getCurrentWeekRange(), entries: memoryHours.entries || [] };
      const gistId = getGistId();

      if (gistId) {
        try {
          const fetched = await fetchGistHours();
          if (fetched && fetched.entries) {
            currentData = {
              week: fetched.week || getCurrentWeekRange(),
              entries: fetched.entries || []
            };
          }
        } catch (e) {}
      }

      currentData.entries = (currentData.entries || []).filter(e => e.id !== id);
      await writeGistHours(currentData);

      return {
        success: true,
        week: currentData.week,
        entries: currentData.entries
      };
    });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}/ai-stats (Gist ID: ${getGistId()})`);
});
