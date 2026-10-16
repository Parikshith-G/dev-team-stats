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

// In-memory runtime config fallback if not in env
let runtimeConfig = {
  githubToken: process.env.GITHUB_TOKEN || '',
  gistId: process.env.GIST_ID || ''
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

// Helper: Calculate start and end of current week (Monday to Sunday)
function getCurrentWeekRange() {
  const now = new Date();
  const day = now.getDay(); // 0 is Sunday, 1 is Monday, ...
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
  // keep queue alive even on errors
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
  const gistId = runtimeConfig.gistId || process.env.GIST_ID;

  if (!gistId) {
    return {
      connected: false,
      reason: 'Gist ID is not configured',
      stats: memoryStats
    };
  }

  const headers = token ? getHeaders(token) : { 'User-Agent': 'Render-Dev-Team-Stats-App' };
  
  const response = await fetch(`https://api.github.com/gists/${gistId}?t=${Date.now()}`, {
    headers: {
      ...headers,
      'Cache-Control': 'no-cache'
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GitHub API error (${response.status}): ${errorText}`);
  }

  const gistData = await response.json();
  const file = gistData.files && gistData.files[GIST_FILENAME];

  if (!file || !file.content) {
    return {
      connected: true,
      gistId,
      gistUrl: gistData.html_url,
      stats: memoryStats
    };
  }

  try {
    const parsed = JSON.parse(file.content);
    const stats = {};
    DEFAULT_USE_CASES.forEach(key => {
      stats[key] = typeof parsed[key] === 'number' ? parsed[key] : (parsed[key] ? Number(parsed[key]) : 0);
    });
    Object.keys(parsed).forEach(k => {
      if (stats[k] === undefined) {
        stats[k] = parsed[k];
      }
    });
    memoryStats = stats;
    return {
      connected: true,
      gistId,
      gistUrl: gistData.html_url,
      stats
    };
  } catch (err) {
    console.error('Failed to parse Gist content JSON:', err);
    return {
      connected: true,
      gistId,
      gistUrl: gistData.html_url,
      stats: memoryStats
    };
  }
}

// Write stats to Gist
async function writeGistStats(newStats) {
  const token = runtimeConfig.githubToken || process.env.GITHUB_TOKEN;
  const gistId = runtimeConfig.gistId || process.env.GIST_ID;

  if (!token) {
    throw new Error('GitHub Token is missing. A token with "gist" scope is required.');
  }
  if (!gistId) {
    throw new Error('Gist ID is missing. Please configure GIST_ID.');
  }

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

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to update Gist (${response.status}): ${errorText}`);
  }

  memoryStats = newStats;
  const data = await response.json();
  return {
    gistId,
    gistUrl: data.html_url,
    stats: newStats
  };
}

// Fetch Weekly Hours from Gist
async function fetchGistHours() {
  const token = runtimeConfig.githubToken || process.env.GITHUB_TOKEN;
  const gistId = runtimeConfig.gistId || process.env.GIST_ID;
  const weekInfo = getCurrentWeekRange();

  if (!gistId) {
    return {
      connected: false,
      reason: 'Gist ID is not configured',
      week: weekInfo,
      entries: memoryHours.entries || []
    };
  }

  const headers = token ? getHeaders(token) : { 'User-Agent': 'Render-Dev-Team-Stats-App' };

  const response = await fetch(`https://api.github.com/gists/${gistId}?t=${Date.now()}`, {
    headers: {
      ...headers,
      'Cache-Control': 'no-cache'
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GitHub API error (${response.status}): ${errorText}`);
  }

  const gistData = await response.json();
  const file = gistData.files && gistData.files[GIST_HOURS_FILENAME];

  if (!file || !file.content) {
    return {
      connected: true,
      gistId,
      gistUrl: gistData.html_url,
      week: weekInfo,
      entries: memoryHours.entries || []
    };
  }

  try {
    const parsed = JSON.parse(file.content);
    memoryHours = parsed;
    return {
      connected: true,
      gistId,
      gistUrl: gistData.html_url,
      week: parsed.week || weekInfo,
      entries: parsed.entries || []
    };
  } catch (err) {
    console.error('Failed to parse weekly-hours.json:', err);
    return {
      connected: true,
      gistId,
      gistUrl: gistData.html_url,
      week: weekInfo,
      entries: memoryHours.entries || []
    };
  }
}

// Write Weekly Hours to Gist
async function writeGistHours(hoursData) {
  const token = runtimeConfig.githubToken || process.env.GITHUB_TOKEN;
  const gistId = runtimeConfig.gistId || process.env.GIST_ID;

  if (!token) {
    throw new Error('GitHub Token is missing.');
  }
  if (!gistId) {
    throw new Error('Gist ID is missing.');
  }

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

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to update weekly hours in Gist (${response.status}): ${errorText}`);
  }

  memoryHours = hoursData;
  const data = await response.json();
  return {
    gistId,
    gistUrl: data.html_url,
    hours: hoursData
  };
}

// Routes

// Path requested: /ai-stats
app.get('/ai-stats', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// New Page requested: /hours
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
      hasToken: Boolean(runtimeConfig.githubToken || process.env.GITHUB_TOKEN),
      gistId: runtimeConfig.gistId || process.env.GIST_ID || null,
      ...result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      stats: memoryStats,
      hasToken: Boolean(runtimeConfig.githubToken || process.env.GITHUB_TOKEN),
      gistId: runtimeConfig.gistId || process.env.GIST_ID || null
    });
  }
});

// POST /api/stats/update (Serialized queue)
app.post('/api/stats/update', async (req, res) => {
  const { useCase, delta } = req.body;

  if (!useCase || (delta !== 1 && delta !== -1)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid request: "useCase" string and "delta" (+1 or -1) are required.'
    });
  }

  try {
    const updatedResult = await enqueueUpdate(async () => {
      let currentStats = { ...memoryStats };
      const token = runtimeConfig.githubToken || process.env.GITHUB_TOKEN;
      const gistId = runtimeConfig.gistId || process.env.GIST_ID;

      if (gistId) {
        try {
          const fetched = await fetchGistStats();
          currentStats = { ...fetched.stats };
        } catch (fetchErr) {
          console.warn('Could not fetch latest before update, using cached stats:', fetchErr.message);
        }
      }

      const currentCount = typeof currentStats[useCase] === 'number' ? currentStats[useCase] : 0;
      const newCount = Math.max(0, currentCount + delta);
      currentStats[useCase] = newCount;

      if (token && gistId) {
        await writeGistStats(currentStats);
      } else {
        memoryStats = currentStats;
      }

      return {
        stats: currentStats,
        connected: Boolean(token && gistId),
        gistId
      };
    });

    res.json({
      success: true,
      ...updatedResult
    });
  } catch (error) {
    console.error('Update error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stats: memoryStats
    });
  }
});

// GET /api/hours
app.get('/api/hours', async (req, res) => {
  try {
    const result = await fetchGistHours();
    res.json({
      success: true,
      hasToken: Boolean(runtimeConfig.githubToken || process.env.GITHUB_TOKEN),
      gistId: runtimeConfig.gistId || process.env.GIST_ID || null,
      ...result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      week: getCurrentWeekRange(),
      entries: memoryHours.entries || []
    });
  }
});

// POST /api/hours (Add or update member's hours for current week)
app.post('/api/hours', async (req, res) => {
  const { name, jettHours, fieldglassHours } = req.body;

  if (!name || name.trim() === '') {
    return res.status(400).json({ success: false, error: 'Name is required' });
  }

  const parsedJett = parseFloat(jettHours) || 0;
  const parsedFieldglass = parseFloat(fieldglassHours) || 0;

  try {
    const updated = await enqueueUpdate(async () => {
      let currentData = { week: getCurrentWeekRange(), entries: [] };
      const token = runtimeConfig.githubToken || process.env.GITHUB_TOKEN;
      const gistId = runtimeConfig.gistId || process.env.GIST_ID;

      if (gistId) {
        try {
          const fetched = await fetchGistHours();
          currentData = {
            week: fetched.week || getCurrentWeekRange(),
            entries: fetched.entries || []
          };
        } catch (e) {
          currentData = { week: getCurrentWeekRange(), entries: memoryHours.entries || [] };
        }
      } else {
        currentData = { week: getCurrentWeekRange(), entries: memoryHours.entries || [] };
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

      if (token && gistId) {
        await writeGistHours(currentData);
      } else {
        memoryHours = currentData;
      }

      return {
        success: true,
        week: currentData.week,
        entries: currentData.entries
      };
    });

    res.json(updated);
  } catch (error) {
    console.error('Failed to save hours:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/hours/:id
app.delete('/api/hours/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const updated = await enqueueUpdate(async () => {
      let currentData = { week: getCurrentWeekRange(), entries: [] };
      const token = runtimeConfig.githubToken || process.env.GITHUB_TOKEN;
      const gistId = runtimeConfig.gistId || process.env.GIST_ID;

      if (gistId) {
        const fetched = await fetchGistHours();
        currentData = {
          week: fetched.week || getCurrentWeekRange(),
          entries: (fetched.entries || []).filter(e => e.id !== id)
        };
        await writeGistHours(currentData);
      } else {
        memoryHours.entries = (memoryHours.entries || []).filter(e => e.id !== id);
        currentData = { week: getCurrentWeekRange(), entries: memoryHours.entries };
      }

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

// POST /api/config
app.post('/api/config', async (req, res) => {
  const { githubToken, gistId } = req.body;

  if (githubToken !== undefined) runtimeConfig.githubToken = githubToken.trim();
  if (gistId !== undefined) runtimeConfig.gistId = gistId.trim();

  try {
    const result = await fetchGistStats();
    res.json({
      success: true,
      message: 'Configuration updated successfully',
      ...result
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// POST /api/create-gist
app.post('/api/create-gist', async (req, res) => {
  const token = req.body.githubToken || runtimeConfig.githubToken || process.env.GITHUB_TOKEN;

  if (!token) {
    return res.status(400).json({
      success: false,
      error: 'GitHub Personal Access Token is required to create a Gist.'
    });
  }

  try {
    const initialStats = JSON.stringify(memoryStats, null, 2);
    const initialHours = JSON.stringify({ week: getCurrentWeekRange(), entries: [] }, null, 2);

    const response = await fetch('https://api.github.com/gists', {
      method: 'POST',
      headers: getHeaders(token),
      body: JSON.stringify({
        description: 'Dev Team Stats (AI Use Cases & Weekly Hours)',
        public: false,
        files: {
          [GIST_FILENAME]: { content: initialStats },
          [GIST_HOURS_FILENAME]: { content: initialHours }
        }
      })
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Failed to create Gist: ${err}`);
    }

    const gistData = await response.json();
    runtimeConfig.githubToken = token;
    runtimeConfig.gistId = gistData.id;

    res.json({
      success: true,
      gistId: gistData.id,
      gistUrl: gistData.html_url,
      stats: memoryStats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}/ai-stats`);
  console.log(`Hours Tracker page at http://localhost:${PORT}/hours`);
});
